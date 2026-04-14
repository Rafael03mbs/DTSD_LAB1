// ============================================================
//  ESP_lcd.ino — Versão LCD do ESP_oled
//  Lógica idêntica ao ESP_oled.cpp (SD card, NTP, fila
//  offline, LED, timestamps) mas com display LCD I2C 16x2.
// ============================================================

#include <LiquidCrystal_I2C.h>
#include <Wire.h>
#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <SD.h>
#include <SPI.h>
#include <time.h>

// --- Configurações de Rede (Wi-Fi) ---
#include "secrets.h"           // Define SECRET_SSID e SECRET_PASS
const char* ssid       = SECRET_SSID;
const char* password   = SECRET_PASS;
const char* serverName = "https://dtsd-lab-1.vercel.app/api/data";

// --- Configurações NTP ---
// O Supabase/PostgreSQL armazena em UTC — enviamos sempre UTC puro (sufixo Z).
// A conversão para hora local é feita pelo cliente (dashboard, app, etc.)
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = 0;  // UTC
const int   daylightOffset_sec = 0;  // Sem offset — UTC puro

// --- Configurações do LCD I2C 16×2 ---
// Endereço mais comum: 0x27 — se não funcionar, tenta 0x3F
LiquidCrystal_I2C lcd(0x27, 16, 2);

// --- Configurações do SD Card (SPI) ---
#define SD_CS   18
#define SD_MOSI 19
#define SD_MISO 20
#define SD_SCK  21
#define FICHEIRO_FILA "/fila.csv"
bool sdDisponivel = false;

// --- Configurações do Fotorresistor (LDR) ---
const int   pinoLDR         = 1;
const float voltagemPlaca   = 3.3;
const float resistenciaFixa = 10000.0;

// --- Configurações do DHT22 ---
#define pinoDHT 4
DHT dht(pinoDHT, DHT22);

// --- Configurações do HC-SR04 ---
const int pinoTrig = 15;
const int pinoEcho = 2;

// --- Configurações do LED ---
const int pinoLED = 12;

// ==========================================
// FUNÇÕES AUXILIARES — LCD
// ==========================================

// Escreve uma mensagem de 1 ou 2 linhas no LCD (máx. 16 chars por linha).
// Se msg2 for vazio, a linha de baixo é limpa.
void lcdMsg(const char* msg1, const char* msg2 = "") {
  char buf[17];
  lcd.setCursor(0, 0);
  snprintf(buf, sizeof(buf), "%-16s", msg1);
  lcd.print(buf);
  lcd.setCursor(0, 1);
  snprintf(buf, sizeof(buf), "%-16s", msg2);
  lcd.print(buf);
}

// ==========================================
// FUNÇÕES AUXILIARES — LÓGICA
// ==========================================

String obterTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return "1970-01-01T00:00:00Z"; // fallback se NTP falhar
  }
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

void iniciarSD() {
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS)) {
    Serial.println("ERRO: Cartão SD não encontrado!");
    sdDisponivel = false;
    return;
  }
  sdDisponivel = true;
  Serial.println("Cartão SD iniciado com sucesso.");
}

void guardarNoSD(String jsonPayload) {
  if (!sdDisponivel) return;
  File f = SD.open(FICHEIRO_FILA, FILE_APPEND);
  if (f) {
    f.println(jsonPayload);
    f.close();
    Serial.println("Dados guardados no SD.");
  } else {
    Serial.println("ERRO: Não foi possível escrever no SD.");
  }
}

bool enviarJSON(String json) {
  HTTPClient http;
  http.begin(serverName);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(json);
  http.end();
  Serial.print("HTTP Response: ");
  Serial.println(code);
  return (code >= 200 && code < 300);
}

void enviarFilaDoSD() {
  if (!sdDisponivel) return;
  if (!SD.exists(FICHEIRO_FILA)) return;

  File f = SD.open(FICHEIRO_FILA, FILE_READ);
  if (!f || f.size() == 0) {
    if (f) f.close();
    return;
  }

  Serial.println("A enviar fila do SD...");

  // Processa no maximo 10 registos por ciclo para nao bloquear o loop
  const int MAX_BATCH = 10;
  int enviados = 0;
  int falhados = 0;
  std::vector<String> porEnviar; // apenas os que falharam neste batch
  std::vector<String> restantes; // os que nem foram tentados

  while (f.available()) {
    String linha = f.readStringUntil('\n');
    linha.trim();
    if (linha.length() == 0) continue;

    if (enviados + falhados < MAX_BATCH) {
      // Tenta enviar
      if (enviarJSON(linha)) {
        enviados++;
      } else {
        falhados++;
        porEnviar.push_back(linha);
      }
      delay(200);
    } else {
      // Ja atingiu o limite do batch — manter para o proximo ciclo
      restantes.push_back(linha);
    }
  }
  f.close();

  // Reescrever ficheiro apenas com os falhados + restantes
  SD.remove(FICHEIRO_FILA);
  if (!porEnviar.empty() || !restantes.empty()) {
    File fw = SD.open(FICHEIRO_FILA, FILE_WRITE);
    if (fw) {
      for (auto& l : porEnviar)  fw.println(l);
      for (auto& l : restantes) fw.println(l);
      fw.close();
    }
    Serial.printf("Fila SD: %d enviados, %d falhados, %d pendentes.\n",
                  enviados, falhados, (int)restantes.size());
  } else {
    Serial.println("Fila do SD enviada com sucesso e limpa.");
  }
}

// ==========================================
// SETUP
// ==========================================

void setup() {
  Serial.begin(115200);

  dht.begin();
  pinMode(pinoTrig, OUTPUT);
  pinMode(pinoEcho, INPUT);
  pinMode(pinoLED, OUTPUT);

  // Iniciar LCD
  lcd.init();
  lcd.backlight();
  lcdMsg("A iniciar...");
  delay(1500);

  // Iniciar SD
  iniciarSD();

  // Ligar ao Wi-Fi
  lcdMsg("A ligar Wi-Fi..");
  WiFi.begin(ssid, password);
  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 20) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWi-Fi ligado!");

    // Aguardar sincronização NTP real (max 10s)
    configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
    Serial.print("A sincronizar hora NTP");
    struct tm timeinfo;
    int ntpTentativas = 0;
    while (!getLocalTime(&timeinfo) && ntpTentativas < 20) {
      delay(500);
      Serial.print(".");
      ntpTentativas++;
    }
    Serial.println();
    if (ntpTentativas < 20) {
      Serial.println("NTP sincronizado: " + obterTimestamp());
    } else {
      Serial.println("Aviso: NTP nao sincronizou. Timestamps serao invalidos.");
    }

    // Mostrar IP no LCD (linha 0) e estado (linha 1)
    char ipBuf[17];
    snprintf(ipBuf, sizeof(ipBuf), "%-16s", WiFi.localIP().toString().c_str());
    lcdMsg("Wi-Fi OK!", ipBuf);
    delay(2000);

    // Tentar enviar fila acumulada no SD
    enviarFilaDoSD();
  } else {
    Serial.println("\nWi-Fi falhou. Modo offline.");
    lcdMsg("Sem Wi-Fi!", "Modo offline");
    delay(2000);
  }
}

// ==========================================
// LOOP
// ==========================================

void loop() {
  // 1. LER LUZ
  int valorADC = analogRead(pinoLDR);
  if (valorADC == 0) valorADC = 1;
  float voltagemLida  = valorADC * (voltagemPlaca / 4095.0);
  float resistenciaLDR = resistenciaFixa * ((voltagemPlaca / voltagemLida) - 1.0);
  float valorLux      = 500.0 / (resistenciaLDR / 1000.0);

  // 2. LER DISTÂNCIA
  digitalWrite(pinoTrig, LOW);
  delayMicroseconds(2);
  digitalWrite(pinoTrig, HIGH);
  delayMicroseconds(10);
  digitalWrite(pinoTrig, LOW);
  long  duracao     = pulseIn(pinoEcho, HIGH);
  float distancia_cm = duracao * 0.034 / 2;

  // 3. LER TEMPERATURA E HUMIDADE
  float humidade    = dht.readHumidity();
  float temperatura = dht.readTemperature();

  // Cooldown das primeiras medições
  static int medicoesIgnoradas = 0;
  if (medicoesIgnoradas < 3) {
    medicoesIgnoradas++;
    Serial.println("Cooldown...");
    delay(3000);
    return;
  }

  if (isnan(temperatura) || isnan(humidade)) {
    Serial.println("Aviso: Falha DHT22.");
    lcdMsg("Erro no DHT22!", "A tentar...");
    delay(2000);
    return;
  }

  // 4. LED
  if ((valorLux < 500) || (distancia_cm < 50)) {
    digitalWrite(pinoLED, HIGH);
  } else {
    digitalWrite(pinoLED, LOW);
  }

  // 5. LCD — 2 linhas de 16 caracteres
  //    Linha 0: Temperatura e Humidade
  //    Linha 1: Luz e Distância
  char linha0[17];
  char linha1[17];
  snprintf(linha0, sizeof(linha0), "T:%4.1fC H:%3.0f%%  ", temperatura, humidade);
  snprintf(linha1, sizeof(linha1), "L:%3.0fLx D:%3.0fcm", valorLux, distancia_cm);

  // Limpa o LCD 1x a cada 20 ciclos (~1 min) para evitar píxeis presos
  static int cicloLCD = 0;
  if (++cicloLCD >= 20) {
    lcd.clear();
    cicloLCD = 0;
  }

  lcd.setCursor(0, 0);
  lcd.print(linha0);
  lcd.setCursor(0, 1);
  lcd.print(linha1);

  // 6. CONSTRUIR JSON (com timestamp NTP)
  String ts = obterTimestamp();
  String jsonPayload = "{";
  jsonPayload += "\"device_id\":\"ESP32_RafaelS\",";
  jsonPayload += "\"timestamp\":\"" + ts + "\",";
  jsonPayload += "\"temperature\":"  + String(temperatura, 2) + ",";
  jsonPayload += "\"humidity\":"     + String(humidade, 2)    + ",";
  jsonPayload += "\"light_level\":"  + String(valorLux, 2)    + ",";
  jsonPayload += "\"distance\":"     + String(distancia_cm, 2) + ",";
  jsonPayload += "\"flame_detected\":false";
  jsonPayload += "}";

  // 7. ENVIAR PARA O SERVIDOR (se online) ou GUARDAR NO SD (se offline)
  if (WiFi.status() == WL_CONNECTED) {
    // Tenta enviar fila de leituras offline acumuladas no SD
    enviarFilaDoSD();

    // Envia a leitura atual diretamente
    if (enviarJSON(jsonPayload)) {
      Serial.println("Dados enviados com sucesso.");
    } else {
      // Só guarda no SD se o envio falhar
      Serial.println("Falha no envio — a guardar no SD para retry.");
      guardarNoSD(jsonPayload);
    }
  } else {
    // Sem Wi-Fi: guarda no SD para envio posterior
    Serial.println("Offline — a guardar no SD para envio posterior.");
    guardarNoSD(jsonPayload);
    WiFi.reconnect(); // Tenta reconectar em background
  }

  delay(3000);
}