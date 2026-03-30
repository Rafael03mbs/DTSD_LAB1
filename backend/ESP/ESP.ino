#include <Wire.h> 
#include <LiquidCrystal_I2C.h>
#include "DHT.h"
#include <WiFi.h>
#include <HTTPClient.h>

// --- Configurações de Rede (Wi-Fi) ---
#include "secrets.h" // Ficheiro que esconde a passe Wi-Fi!

const char* ssid = SECRET_SSID;       
const char* password = SECRET_PASS; 
const char* serverName = "https://dtsd-lab-1.vercel.app/api/data";
// --- Configurações do LCD ---
// 0x27 é o endereço mais comum. Se o ecrã não der nada, muda para 0x3F
LiquidCrystal_I2C lcd(0x27, 16, 2); 

// --- Configurações do Fotorresistor (LDR) ---
const int pinoLDR = 36; 
const float voltagemPlaca = 3.3; 
const float resistenciaFixa = 10000.0; 

// --- Configurações do DHT11 ---
#define pinoDHT 4     
#define tipoDHT DHT11 
DHT dht(pinoDHT, tipoDHT);

// --- Configurações do HC-SR04 ---
const int pinoTrig = 15; 
const int pinoEcho = 2;  

void setup() {
  Serial.begin(9600);
  
  // Inicia os sensores
  dht.begin();
  pinMode(pinoTrig, OUTPUT);
  pinMode(pinoEcho, INPUT);

  // Inicia o Ecrã LCD
  lcd.init();
  lcd.backlight(); // Liga a luz de fundo do ecrã
  
  // Mensagem de boas-vindas
  lcd.setCursor(0, 0); // Coluna 0, Linha 0
  lcd.print("A iniciar o");
  lcd.setCursor(0, 1); // Coluna 0, Linha 1
  lcd.print("Super Projeto...");
  delay(2000); 
  lcd.clear(); // Limpa o ecrã

  // Ligar ao Wi-Fi
  Serial.print("A ligar ao Wi-Fi: ");
  Serial.println(ssid);
  lcd.setCursor(0,0);
  lcd.print("A ligar Wi-Fi...");
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("Wi-Fi ligado com sucesso!");
  Serial.print("Endereço IP: ");
  Serial.println(WiFi.localIP());
  
  lcd.clear();
  lcd.setCursor(0,0);
  lcd.print("Wi-Fi Ligado!");
  delay(1500);
  lcd.clear();
}

void loop() {
  // 1. LER LUZ
  int valorADC = analogRead(pinoLDR);
  if (valorADC == 0) valorADC = 1; 
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

  // ==========================================
  // 4. ESCREVER NO ECRÃ LCD
  // ==========================================
  
  // Linha de Cima: Temperatura e Humidade (Ex: "T:25.0C H:50% ")
  lcd.setCursor(0, 0); 
  if (isnan(temperatura) || isnan(humidade)) {
    lcd.print("Erro no DHT11!  ");
  } else {
    lcd.print("T:");
    lcd.print(temperatura, 1);
    lcd.print("C H:");
    lcd.print(humidade, 0);
    lcd.print("%   "); // Os espaços no fim apagam lixo de leituras anteriores
  }

  // Linha de Baixo: Luz e Distância (Ex: "L:450Lx D:15cm  ")
  lcd.setCursor(0, 1);
  lcd.print("L:");
  lcd.print(valorLux, 0);
  lcd.print("Lx D:");
  lcd.print(distancia_cm, 0);
  lcd.print("cm   "); // Espaços para limpar o resto da linha

  // ==========================================
  // 5. ENVIAR DADOS PARA O SERVIDOR
  // ==========================================
  if(WiFi.status() == WL_CONNECTED){
    HTTPClient http;
    
    // Inicia a ligação ao endpoint da API
    http.begin(serverName);
    
    // Indica que o formato do pedido é JSON
    http.addHeader("Content-Type", "application/json");
    
    // Construir a string JSON (com a mesma estrutura do test_sensors.py)
    String jsonPayload = "{";
    jsonPayload += "\"device_id\":\"ESP32_Entrada\",";
    jsonPayload += "\"temperature\":" + String(temperatura, 2) + ",";
    jsonPayload += "\"humidity\":" + String(humidade, 2) + ",";
    jsonPayload += "\"light_level\":" + String(valorLux, 2) + ",";
    jsonPayload += "\"distance\":" + String(distancia_cm, 2) + ",";
    jsonPayload += "\"flame_detected\":false"; // Não existe sensor de chama de momento
    jsonPayload += "}";
    
    // Envia o pedido HTTP POST com o JSON
    int httpResponseCode = http.POST(jsonPayload);
    
    Serial.print("Dados enviados! Resposta HTTP: ");
    Serial.println(httpResponseCode);
    
    if (httpResponseCode > 0) {
      String resposta = http.getString();
      Serial.println(resposta);
    } else {
      Serial.print("Erro a enviar o POST: ");
      Serial.println(http.errorToString(httpResponseCode));
    }
    
    // Liberta os recursos
    http.end();
  } else {
    Serial.println("Erro: Wi-Fi desconectado, não foi possível enviar dados.");
  }

  // O ecrã atualiza a cada 3 segundos (limite do DHT11 e para evitar spam na API)
  delay(3000); 
}