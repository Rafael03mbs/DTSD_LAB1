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
#define pinoSDA 6
#define pinoSCL 7
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

// Tenta inicializar o cartão SD com diagnóstico completo.
// Faz até 'maxTentativas' tentativas com delay crescente entre elas.
// Verifica tipo de cartão, tamanho, e faz um teste de escrita/leitura.
void iniciarSD() {
  const int maxTentativas = 3;
  sdDisponivel = false;

  Serial.println("========== DIAGNÓSTICO SD CARD ==========");
  Serial.printf("  Pinos SPI → SCK:%d  MISO:%d  MOSI:%d  CS:%d\n", SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  // Configurar pino CS como OUTPUT para garantir que o SPI funciona
  pinMode(SD_CS, OUTPUT);
  digitalWrite(SD_CS, HIGH);  // Desactivar CS antes de iniciar o SPI

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  // --- Tentativas de inicialização ---
  for (int tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    Serial.printf("  Tentativa %d/%d ...\n", tentativa, maxTentativas);
    lcdMsg("SD Card...", tentativa == 1 ? "A verificar" : "A re-tentar");

    if (SD.begin(SD_CS)) {
      Serial.println("  SD.begin() → OK");

      // --- Tipo de cartão ---
      uint8_t tipo = SD.cardType();
      const char* tipoNome;
      switch (tipo) {
        case CARD_MMC:  tipoNome = "MMC";     break;
        case CARD_SD:   tipoNome = "SD";      break;
        case CARD_SDHC: tipoNome = "SDHC";    break;
        default:        tipoNome = "DESCONHECIDO"; break;
      }

      if (tipo == CARD_NONE) {
        Serial.println("  ERRO: SD.begin() OK mas cardType = NONE");
        Serial.println("  → O módulo SD responde mas não detecta cartão.");
        Serial.println("  → Verifica se o cartão está bem inserido no slot.");
        lcdMsg("SD: sem cartao!", "Insere o cartao");
        SD.end();
        delay(1000 * tentativa);  // delay crescente
        continue;  // Tentar outra vez
      }

      Serial.printf("  Tipo de cartão: %s\n", tipoNome);

      // --- Tamanho do cartão ---
      uint64_t cardSize  = SD.cardSize() / (1024 * 1024);   // MB
      uint64_t totalBytes = SD.totalBytes() / (1024 * 1024); // MB
      uint64_t usedBytes  = SD.usedBytes()  / (1024 * 1024); // MB
      Serial.printf("  Tamanho total: %llu MB\n", cardSize);
      Serial.printf("  Espaço total (FS): %llu MB\n", totalBytes);
      Serial.printf("  Espaço usado: %llu MB\n", usedBytes);

      if (cardSize == 0) {
        Serial.println("  AVISO: Tamanho = 0 MB. O cartão pode não estar formatado.");
        lcdMsg("SD: formato?", "Formata FAT32");
        SD.end();
        delay(1000 * tentativa);
        continue;
      }

      // --- Teste de escrita e leitura ---
      Serial.println("  A fazer teste de escrita/leitura...");
      const char* ficheiroTeste = "/_sd_test.tmp";
      const char* dadosTeste = "SD_OK_12345";
      bool testeOK = false;

      // Escrever
      File fw = SD.open(ficheiroTeste, FILE_WRITE);
      if (fw) {
        fw.print(dadosTeste);
        fw.close();

        // Ler de volta
        File fr = SD.open(ficheiroTeste, FILE_READ);
        if (fr) {
          String lido = fr.readString();
          fr.close();
          SD.remove(ficheiroTeste);  // limpar ficheiro de teste

          if (lido == dadosTeste) {
            testeOK = true;
            Serial.println("  Teste escrita/leitura → PASSOU ✓");
          } else {
            Serial.println("  ERRO: Teste leitura falhou — dados corrompidos!");
            Serial.printf("  Esperado: '%s' | Lido: '%s'\n", dadosTeste, lido.c_str());
          }
        } else {
          Serial.println("  ERRO: Conseguiu escrever mas não conseguiu ler o ficheiro de teste.");
          SD.remove(ficheiroTeste);
        }
      } else {
        Serial.println("  ERRO: Não conseguiu criar ficheiro de teste.");
        Serial.println("  → O cartão pode estar protegido contra escrita (write-protect).");
        Serial.println("  → Ou o sistema de ficheiros está corrompido.");
      }

      if (testeOK) {
        sdDisponivel = true;
        Serial.println("  ✓ Cartão SD pronto e funcional!");
        Serial.printf("  Resumo: %s %lluMB (usado: %lluMB)\n", tipoNome, cardSize, usedBytes);

        // Mostrar resumo no LCD
        char lcdL1[17];
        snprintf(lcdL1, sizeof(lcdL1), "SD OK %s %lluMB", tipoNome, cardSize);
        lcdMsg(lcdL1, "");
        delay(1500);

        Serial.println("=========================================");
        return;  // Sucesso — sair da função
      }

      // Se o teste falhou, desmontar e tentar outra vez
      SD.end();
      Serial.printf("  A aguardar %ds antes de tentar novamente...\n", tentativa);
      delay(1000 * tentativa);

    } else {
      // SD.begin() falhou completamente
      Serial.println("  SD.begin() → FALHOU");
      Serial.println("  Possíveis causas:");
      Serial.println("   1. Cartão SD não inserido");
      Serial.println("   2. Pinos SPI mal ligados (verifica a fiação)");
      Serial.println("   3. Cartão SD danificado ou incompatível");
      Serial.println("   4. Cartão não formatado em FAT32");
      Serial.println("   5. Problema de alimentação (3.3V insuficiente)");
      Serial.printf("  A aguardar %ds antes de tentar novamente...\n", tentativa);
      lcdMsg("SD: ERRO!", "Verifica fios");
      delay(1000 * tentativa);
    }
  }

  // Todas as tentativas falharam
  Serial.println("  ✗ SD CARD INDISPONÍVEL após todas as tentativas.");
  Serial.println("  O ESP32 vai continuar sem SD — dados offline");
  Serial.println("  serão guardados em RAM (buffer limitado).");
  Serial.println("=========================================");
  lcdMsg("SD: Falhou!", "Modo sem SD");
  delay(2000);
}

// Tenta re-inicializar o SD periodicamente se ele não está disponível.
// Chamar esta função no loop() a cada ~30s.
void tentarReconectarSD() {
  if (sdDisponivel) return;  // Já está OK, não fazer nada

  Serial.println("SD: A tentar re-inicializar...");
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (SD.begin(SD_CS)) {
    uint8_t tipo = SD.cardType();
    if (tipo != CARD_NONE) {
      // Teste rápido de escrita
      File fw = SD.open("/_sd_recheck.tmp", FILE_WRITE);
      if (fw) {
        fw.print("OK");
        fw.close();
        SD.remove("/_sd_recheck.tmp");
        sdDisponivel = true;
        Serial.println("SD: Re-conectado com sucesso!");
        lcdMsg("SD recuperado!", "");
        delay(1000);
        return;
      }
    }
    SD.end();
  }
  Serial.println("SD: Ainda indisponível.");
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
      // Lê 1 item. Só enviamos no máximo 2 para não bloquear o ESP32 (LCD e loop)
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

  dht.begin();
  pinMode(pinoTrig, OUTPUT);
  pinMode(pinoEcho, INPUT);
  pinMode(pinoLED, OUTPUT);

  // Iniciar LCD
  Wire.begin(pinoSDA, pinoSCL);
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
  unsigned long inicioLoop = millis(); // Marcar o início do ciclo

  // 0. TENTAR RE-CONECTAR SD se indisponível (a cada ~30s = 10 ciclos de 3s)
  static int cicloSD = 0;
  if (!sdDisponivel && ++cicloSD >= 10) {
    cicloSD = 0;
    tentarReconectarSD();
  }


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
    delay(2000);
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

  // 5. LCD — Atualiza PRIMEIRO, antes de qualquer operação de rede
  //    Assim o ecrã fica sempre responsivo independentemente da velocidade da internet
  char linha0[17];
  char linha1[17];
  snprintf(linha0, sizeof(linha0), "T:%4.1fC H:%3.0f%%  ", temperatura, humidade);
  snprintf(linha1, sizeof(linha1), "L:%3.0fLx D:%3.0fcm", valorLux, distancia_cm);

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
    enviarFilaDoSD();

    if (enviarJSON(jsonPayload)) {
      Serial.println("Dados enviados com sucesso.");
    } else {
      Serial.println("Falha no envio — a guardar no SD para retry.");
      guardarNoSD(jsonPayload);
    }
  } else {
    Serial.println("Offline — a guardar no SD para envio posterior.");
    guardarNoSD(jsonPayload);
    WiFi.reconnect();
  }

  // 8. DELAY INTELIGENTE — desconta o tempo já gasto no loop (HTTP, SD, etc.)
  //    Objetivo: manter um ciclo total de ~3 segundos, nunca mais
  unsigned long tempoGasto = millis() - inicioLoop;
  long tempoRestante = 3000 - (long)tempoGasto;
  
  Serial.printf("Ciclo: %lums | Delay: %ldms\n", tempoGasto, tempoRestante > 0 ? tempoRestante : 0);
  
  if (tempoRestante > 0) {
    delay(tempoRestante);
  }
  // Se tempoRestante <= 0 significa que o HTTP já demorou mais de 3s,
  // nesse caso avança logo sem delay extra
}