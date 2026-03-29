from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from datetime import datetime
import os

app = FastAPI(title="ESP32 Security Monitor API")

# Configurar CORS para permitir a comunicação com o painel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allow all for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from dotenv import load_dotenv

load_dotenv()

# 1. Configurações do Supabase (Colocar as chaves reais)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
USE_SUPABASE = True

if USE_SUPABASE:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[OK] Supabase ativado!")
    except Exception as e:
        print(f"[ERRO] Erro ao ligar ao Supabase: {e}")
        USE_SUPABASE = False
else:
    print("[AVISO] Supabase desativado (Credenciais não configuradas). Utiliza recurso em memória para testes locais.")

# Estrutura de dados do ESP32
class SensorData(BaseModel):
    device_id: str
    temperature: float     # DHT22
    humidity: float        # DHT22
    light_level: float     # LDR
    distance: float        # HC-SR04
    flame_detected: bool   # Sensor de chama

# Armazenamento em memória para testes imediatos antes da configuração total do Supabase
local_data_storage = []
local_alerts_storage = []

@app.post("/api/data")
def receive_data(data: SensorData):
    timestamp = datetime.now().isoformat()
    data_dict = data.dict()
    data_dict["timestamp"] = timestamp

    alert_triggered = False
    alert_message = ""

    # 1. Regra de Intrusão: Distância < 50cm (alguém passou perto)
    if data.distance < 50.0:
        alert_triggered = True
        alert_message = f"[ALARME DE INTRUSAO] Movimento/Objeto detetado a {data.distance}cm no dispositivo {data.device_id}"

    # 2. Regra Ambiental: Temperatura Extrema ou Chama
    if data.flame_detected:
        alert_triggered = True
        prefix = " | " if alert_message else ""
        alert_message += f"{prefix}[INCENDIO] Chama detetada pelo Sensor!"
        
    if data.temperature > 50.0:
        alert_triggered = True
        prefix = " | " if alert_message else ""
        alert_message += f"{prefix}[INCENDIO] Temperatura anormal ({data.temperature} C)"
    elif data.temperature < 0.0:
        alert_triggered = True
        prefix = " | " if alert_message else ""
        alert_message += f"{prefix}[FRIO EXTREMO] Temperatura perigosamente baixa ({data.temperature} C)"

    # Adicionar alerta à base local se existir
    if alert_triggered:
        print(alert_message)
        local_alerts_storage.insert(0, {
            "timestamp": timestamp,
            "message": alert_message,
            "device_id": data.device_id
        })

    # Guardar dados localmente (limite 100 eventos)
    local_data_storage.insert(0, data_dict)
    if len(local_data_storage) > 100:
        local_data_storage.pop()

    if len(local_alerts_storage) > 50:
        local_alerts_storage.pop()

    # -- INSERÇÃO NO SUPABASE --
    if USE_SUPABASE:
        try:
            # Requer tabela 'security_events' com as colunas certas!
            response = supabase.table("security_events").insert(data_dict).execute()
        except Exception as e:
            print(f"Erro a inserir no Supabase: {e}")

        # Se houver alerta, guarda na tabela 'security_alerts'
        if alert_triggered:
            try:
                supabase.table("security_alerts").insert({
                    "timestamp": timestamp,
                    "message": alert_message,
                    "device_id": data.device_id
                }).execute()
            except Exception as e:
                print(f"Erro a inserir alerta no Supabase: {e}")

    return {"status": "success", "alert_triggered": alert_triggered, "alert_message": alert_message}

@app.get("/api/data")
def get_recent_data():
    if USE_SUPABASE:
        try:
            response = supabase.table("security_events").select("*").order("timestamp", desc=True).limit(100).execute()
            return response.data
        except Exception as e:
            print(f"Erro a ler do Supabase (data): {e}")
            return local_data_storage
    
    return local_data_storage

@app.get("/api/alerts")
def get_recent_alerts():
    if USE_SUPABASE:
        try:
            response = supabase.table("security_alerts").select("*").order("timestamp", desc=True).limit(50).execute()
            return response.data
        except Exception as e:
            print(f"Erro a ler do Supabase (alerts): {e}")
            return local_alerts_storage
            
    return local_alerts_storage

if __name__ == "__main__":
    import uvicorn
    # Executar na porta 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
