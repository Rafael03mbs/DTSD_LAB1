#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>
#include <Wire.h>
#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <SD.h>
#include <SPI.h>
#include <time.h>
#include "secrets.h"

// --- Configurações de Rede (Wi-Fi) ---
const char* ssid = SECRET_SSID;
const char* password = SECRET_PASS;
const char* serverName = "https://dtsd-lab-1.vercel.app/api/data";

// --- Configurações NTP ---
// O Supabase/PostgreSQL armazena em UTC — enviamos sempre UTC puro (sufixo Z).
// A conversão para hora local é feita pelo cliente (dashboard, app, etc.)
const char* ntpServer          = "pool.ntp.org";
const long  gmtOffset_sec      = 0;  // UTC
const int   daylightOffset_sec = 0;  // Sem offset — UTC puro

// --- Configurações do OLED SH1107 ---
#define i2c_Address 0x3c
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define pinoSDA 6
#define pinoSCL 7

Adafruit_SH1107 oled = Adafruit_SH1107(64, 128, &Wire);
String displayString;

// --- Configurações do SD Card (SPI) ---
#define SD_CS   18   // Chip Select do SD — ajusta ao teu pin
#define SD_MOSI 19
#define SD_MISO 20
#define SD_SCK  21
#define FICHEIRO_FILA "/fila.csv"
bool sdDisponivel = false;

// --- Buffer em RAM (fallback quando o SD card não está disponível) ---
// Guarda até 60 leituras (~3 minutos a cada 3s) na memória do ESP32.
// Cada JSON tem ~200 bytes → ~12KB de RAM usados no pior caso.
#define RAM_BUFFER_MAX 60
String ramBuffer[RAM_BUFFER_MAX];
int ramBufferCount = 0;

// --- Configurações do Fotorresistor (LDR) ---
const int pinoLDR = 1;
const float voltagemPlaca = 3.3;
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
// FUNÇÕES AUXILIARES
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

// Guarda dados no buffer RAM (fallback quando SD não está disponível).
// Buffer circular: quando cheio, descarta os mais antigos.
void guardarNoRAM(String jsonPayload) {
  if (ramBufferCount < RAM_BUFFER_MAX) {
    ramBuffer[ramBufferCount] = jsonPayload;
    ramBufferCount++;
  } else {
    // Buffer cheio — descartar o mais antigo (shift left)
    for (int i = 0; i < RAM_BUFFER_MAX - 1; i++) {
      ramBuffer[i] = ramBuffer[i + 1];
    }
    ramBuffer[RAM_BUFFER_MAX - 1] = jsonPayload;
  }
  Serial.printf("Dados guardados em RAM (%d/%d).\n", ramBufferCount, RAM_BUFFER_MAX);
}

// Envia todos os dados acumulados no buffer RAM para o servidor.
void enviarFilaDoRAM() {
  if (ramBufferCount == 0) return;

  Serial.printf("A enviar fila RAM: %d itens pendentes...\n", ramBufferCount);
  int enviados = 0;

  while (enviados < ramBufferCount && enviados < 5) {
    if (enviarJSON(ramBuffer[enviados])) {
      enviados++;
    } else {
      break;
    }
  }

  if (enviados > 0) {
    int restantes = ramBufferCount - enviados;
    for (int i = 0; i < restantes; i++) {
      ramBuffer[i] = ramBuffer[i + enviados];
    }
    for (int i = restantes; i < ramBufferCount; i++) {
      ramBuffer[i] = "";
    }
    ramBufferCount = restantes;
    Serial.printf("RAM: %d enviados, %d restantes.\n", enviados, ramBufferCount);
  }
}

void guardarNoSD(String jsonPayload) {
  if (!sdDisponivel) {
    guardarNoRAM(jsonPayload);
    return;
  }
  File f = SD.open(FICHEIRO_FILA, FILE_APPEND);
  if (f) {
    f.println(jsonPayload);
    f.close();
    Serial.println("Dados guardados no SD.");
  } else {
    Serial.println("ERRO: Escrita SD falhou — a guardar em RAM.");
    guardarNoRAM(jsonPayload);
  }
}

bool enviarJSON(String json) {
  HTTPClient http;
  http.begin(serverName);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_SECRET_KEY); 
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
  // Se estiver vazio, limpa o ficheiro falso e sai para não gastar tempo
  if (!f || f.size() == 0) {
    if (f) f.close();
    SD.remove(FICHEIRO_FILA); 
    return;
  }

  // Usamos ficheiro temporário para reescrever o que sobrou sem esgotar a RAM
  File fw = SD.open("/fila_temp.csv", FILE_WRITE);
  if (!fw) {
    f.close();
    return;
  }

  int enviados = 0;
  bool abortar = false; // Se a internet estiver fraca, paramos e guardamos logo o resto

  while (f.available()) {
    if (!abortar && enviados < 2) { 
      // Lê 1 item. Só enviamos no máximo 2 para não bloquear o ESP32 (OLED e loop)
      String linha = f.readStringUntil('\n');
      linha.trim();
      if (linha.length() == 0) continue;

      if (enviarJSON(linha)) {
        enviados++;
      } else {
        abortar = true; // Falhou, assume erro e pára de tentar o resto
        fw.println(linha);
      }
    } else {
      // Cópia ultra-rápida do resto do ficheiro em bloco em vez de Strings linha a linha
      uint8_t buffer[512];
      while (f.available()) {
        int lidos = f.read(buffer, sizeof(buffer));
        fw.write(buffer, lidos);
      }
      break; // Sai do while pq o ficheiro f foi lido todo
    }
  }
  
  f.close();
  fw.close();

  // Deletar o antigo
  SD.remove(FICHEIRO_FILA);

  // Verifica se o temp ficou com alguma coisa lá dentro
  File checkFile = SD.open("/fila_temp.csv", FILE_READ);
  bool aindaTemDados = (checkFile && checkFile.size() > 0);
  if (checkFile) checkFile.close();

  if (aindaTemDados) {
    SD.rename("/fila_temp.csv", FICHEIRO_FILA); // Ficheiro assumido como nova fila
  } else {
    SD.remove("/fila_temp.csv"); // Destrói vestígios se tudo foi esvaziado
  }
}

// ==========================================
// SETUP
// ==========================================

void setup() {
  Serial.begin(115200);
  displayString.reserve(128);

  dht.begin();
  pinMode(pinoTrig, OUTPUT);
  pinMode(pinoEcho, INPUT);
  pinMode(pinoLED, OUTPUT);

  Wire.begin(pinoSDA, pinoSCL);

  if (!oled.begin(i2c_Address, true)) {
    Serial.println(F("ERRO: SH1107 não encontrado."));
    for (;;);
  }

  oled.display();
  delay(2000);
  oled.clearDisplay();
  oled.setRotation(1);
  oled.setTextSize(1);
  oled.setTextColor(SH110X_WHITE);
  oled.setCursor(0, 0);
  oled.println("A iniciar...");
  oled.display();

  // Iniciar SD
  iniciarSD();

  // Ligar ao Wi-Fi
  oled.clearDisplay();
  oled.setCursor(0, 0);
  oled.println("A ligar Wi-Fi...");
  oled.display();

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

    oled.clearDisplay();
    oled.setCursor(0, 0);
    oled.println("Wi-Fi OK!");
    oled.println(WiFi.localIP());
    oled.println(obterTimestamp());
    oled.display();
    delay(2000);

    // Tentar enviar filas acumuladas (SD e/ou RAM)
    enviarFilaDoSD();
    enviarFilaDoRAM();
  } else {
    Serial.println("\nWi-Fi falhou. Modo offline.");
    oled.clearDisplay();
    oled.setCursor(0, 0);
    oled.println("Sem Wi-Fi!");
    oled.println("Modo offline");
    oled.display();
    delay(2000);
  }
}

// ==========================================
// LOOP
// ==========================================

void loop() {
  unsigned long inicioLoop = millis(); // Marcar o início do ciclo

  // 1. LER LUZ
  int valorADC = analogRead(pinoLDR);
  if (valorADC <= 0) valorADC = 1; // Prevenir divisoes por zero
  if (valorADC >= 4095) valorADC = 4094;
  
  float voltagemLida = valorADC * (voltagemPlaca / 4095.0);
  float resistenciaLDR = resistenciaFixa * ((voltagemPlaca / voltagemLida) - 1.0);
  float valorLux = 500.0 / (resistenciaLDR / 1000.0);

  // 2. LER DISTÂNCIA
  digitalWrite(pinoTrig, LOW);
  delayMicroseconds(2);
  digitalWrite(pinoTrig, HIGH);
  delayMicroseconds(10);
  digitalWrite(pinoTrig, LOW);
  long duracao = pulseIn(pinoEcho, HIGH);
  float distancia_cm = duracao * 0.034 / 2;

  // 3. LER TEMPERATURA E HUMIDADE
  float humidade = dht.readHumidity();
  float temperatura = dht.readTemperature();

  // Cooldown das primeiras medições
  static int medicoesIgnoradas = 0;
  if (medicoesIgnoradas < 3) {
    medicoesIgnoradas++;
    Serial.println("Cooldown...");
    delay(2000); // 2000 em vez de 3000 para cooldown mais liso
    return;
  }

  if (isnan(temperatura) || isnan(humidade)) {
    Serial.println("Aviso: Falha DHT22.");
    oled.clearDisplay();
    oled.setCursor(0, 0);
    oled.println("Erro no DHT22!");
    oled.display();
    delay(2000);
    return;
  }

  // 4. LED
  if ((valorLux < 500) || (distancia_cm < 50)) {
    digitalWrite(pinoLED, HIGH);
  } else {
    digitalWrite(pinoLED, LOW);
  }

  // 5. OLED - Atualiza PRIMEIRO antes da rede para manter o ecrã instantâneo
  String ts = obterTimestamp();
  displayString = "Temp: " + String(temperatura, 1) + " C\n";
  displayString += "Hum: " + String(humidade, 1) + " %\n";
  displayString += "Luz: " + String(valorLux, 0) + " Lux\n";
  displayString += "Dist: " + String(distancia_cm, 0) + " cm\n";
  displayString += (WiFi.status() == WL_CONNECTED) ? "WiFi: OK" : "WiFi: OFF";

  oled.clearDisplay();
  oled.setCursor(0, 0);
  oled.println(displayString);
  oled.display();

  // 6. CONSTRUIR JSON (com timestamp)
  String jsonPayload = "{";
  jsonPayload += "\"device_id\":\"ESP32_RafaelS\",";
  jsonPayload += "\"timestamp\":\"" + ts + "\",";
  jsonPayload += "\"temperature\":" + String(temperatura, 2) + ",";
  jsonPayload += "\"humidity\":" + String(humidade, 2) + ",";
  jsonPayload += "\"light_level\":" + String(valorLux, 2) + ",";
  jsonPayload += "\"distance\":" + String(distancia_cm, 2) + ",";
  jsonPayload += "\"flame_detected\":false";
  jsonPayload += "}";

  // 7. ENVIAR PARA O SERVIDOR (se online) ou GUARDAR NO SD (se offline)
  if (WiFi.status() == WL_CONNECTED) {
    enviarFilaDoSD();
    enviarFilaDoRAM();

    if (enviarJSON(jsonPayload)) {
      Serial.println("Dados enviados com sucesso.");
    } else {
      Serial.println("Falha no envio — a guardar para retry.");
      guardarNoSD(jsonPayload);
    }
  } else {
    Serial.println("Offline — a guardar para envio posterior.");
    guardarNoSD(jsonPayload);
    WiFi.reconnect();
  }

  // 8. DELAY INTELIGENTE — desconta o tempo já gasto no loop (HTTP, SD, etc.)
  unsigned long tempoGasto = millis() - inicioLoop;
  long tempoRestante = 3000 - (long)tempoGasto;
  
  Serial.printf("Ciclo: %lums | Delay: %ldms\n", tempoGasto, tempoRestante > 0 ? tempoRestante : 0);
  
  if (tempoRestante > 0) {
    delay(tempoRestante);
  }
}