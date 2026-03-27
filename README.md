# DTSD ESP32 Security Monitor 🔒

Sistema completo de Dashboard e Backend para a Cadeira de **Desenvolvimento e Teste de Sistemas Digitais (DTSD)**.

## Arquitetura Cloud (Parte 2 do Projeto)

Aproveitámos a estrutura usada em ISCF, mas otimizada para ser extremamente rápida de testar (HTML/JS + FastAPI) sem precisar de instalação de ficheiros Node.js gigantescos na máquina inteira:

### 1) Backend API (`/backend`)
Construído em **Python + FastAPI**, responsável por receber os pedidos HTTP POST feitos pelo ESP32 com o estado dos sensores, analisar e aplicar _regras de deteção de intrusão/anomalias_, e devolver o histórico para o Dashboard.
Se não quiser usar o Supabase logo de início, o Backend guarda até 100 eventos localmente em memória para poder logo testar!

### 2) Frontend Dashboard (`/frontend`)
Foi desenhado com foco num **"Premium Design"** (Modern UI, Glassmorphism, Tailwind). É um painel de controlo estático, mas completamente dinâmico com JavaScript em tempo real que lê da API. Funciona localmente sem compilar.

---

## Como testar AGORA MESMO (Simulador)?

Visto que o ESP32 ainda está a ser construído, criámos um **simulador** para que possa testar ambos os componentes Cloud logo de seguida:

### A) Iniciar o Servidor (API)
Abra a linha de comandos / terminal na pasta `backend`:
1. (Opcional) `python -m venv venv` e ative o ambiente virtual
2. Instale as bibliotecas: `pip install -r requirements.txt`
3. Inicie: `python main.py`
*(O servidor arranca em http://localhost:8000)*

### B) Abrir o Dashboard (Interface)
1. Vá à pasta `/frontend` num explorador de ficheiros.
2. Dê duplo-clique no **`index.html`** (abrirá no seu browser).
*(Como a API já está a correr, ele vai conectar-se em tempo real, mas verá os valores vazios).*

### C) Ligar o Simulador ESP32
Na pasta `backend`, abra um novo terminal em paralelo:
1. Execute: `python test_sensors.py`

O script começará a gerar falsos valores de Temperatura (+ Anomalia de Incêndio > 50ºC) e de Luminosidade, assim como "abrir portas" e "movimento". No Dashboard, as métricas e os gráficos ganharão vida, com os alertas no painel da direita!

---

## E quando o ESP32 estiver pronto?

O seu colega só precisa de adicionar a biblioteca **`HTTPClient.h`** (Wifi) ao Arduino IDE e, quando detetar algo, enviar os dados assim (substitua o IP pelo do seu PC local se não for colocar num servidor na nuvem):

```cpp
#include <HTTPClient.h>
#include <ArduinoJson.h>

void postToCloud() {
    HTTPClient http;
    // Utilize o IP interno do computador na mesma rede Wi-Fi, ou do domínio Cloud
    http.begin("http://O_SEU_IP:8000/api/data");
    http.addHeader("Content-Type", "application/json");

    String jsonPayload = "{\"device_id\": \"ESP32_GrupoX\", \"temperature\": " + String(temp) + ", \"light_level\": " + String(light) + ", \"motion_detected\": true, \"door_open\": false}";

    int code = http.POST(jsonPayload);
    http.end();
}
```

Bom trabalho! 🎉
"# DTSD_LAB1" 
