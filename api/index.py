from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client, Client
from datetime import datetime, timezone
from typing import Optional
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

API_SECRET_KEY = os.environ.get("API_SECRET_KEY") 

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

# Modelo para registo de dispositivo
class DeviceRegister(BaseModel):
    device_id: str

# Armazenamento em memória para testes imediatos antes da configuração total do Supabase
local_data_storage = []
local_alerts_storage = []

def get_user_id_by_device(device_id: str) -> Optional[str]:
    """Obtém o user_id associado a um device_id da tabela user_devices."""
    if not USE_SUPABASE:
        return None
    try:
        resp = supabase.table("user_devices").select("user_id").eq("device_id", device_id).single().execute()
        if resp.data:
            return resp.data.get("user_id")
    except Exception:
        pass
    return None

def get_user_from_token(authorization: Optional[str]) -> Optional[dict]:
    """Valida o token JWT do Supabase e retorna o utilizador."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        resp = supabase.auth.get_user(token)
        return resp.user
    except Exception:
        return None

@app.post("/api/data")
def receive_data(data: SensorData, x_api_key: Optional[str] = Header(None)):
    if x_api_key != API_SECRET_KEY:
        raise HTTPException(status_code=401, detail="Acesso negado: Chave API invalida ou ausente")

    timestamp = datetime.now(timezone.utc).isoformat()
    data_dict = data.dict()
    data_dict["timestamp"] = timestamp

    # Associar o user_id ao device_id (para isolação de dados por utilizador)
    user_id = get_user_id_by_device(data.device_id)
    if user_id:
        data_dict["user_id"] = user_id

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
        
    if data.temperature > 28.0:
        alert_triggered = True
        prefix = " | " if alert_message else ""
        alert_message += f"{prefix}Temperatura muito elevada ({data.temperature} C)"
    elif data.temperature < 0.0:
        alert_triggered = True
        prefix = " | " if alert_message else ""
        alert_message += f"{prefix}[FRIO EXTREMO] Temperatura muito baixa ({data.temperature} C)"

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
                alert_dict = {
                    "timestamp": timestamp,
                    "message": alert_message,
                    "device_id": data.device_id
                }
                if user_id:
                    alert_dict["user_id"] = user_id
                supabase.table("security_alerts").insert(alert_dict).execute()
            except Exception as e:
                print(f"Erro a inserir alerta no Supabase: {e}")

    return {"status": "success", "alert_triggered": alert_triggered, "alert_message": alert_message}


@app.post("/api/register-device")
def register_device(body: DeviceRegister, authorization: Optional[str] = Header(None)):
    """Associa um device_id ao utilizador autenticado."""
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Não autenticado")

    if not USE_SUPABASE:
        raise HTTPException(status_code=503, detail="Supabase não disponível")

    try:
        # 1. Verificar se o dispositivo já está associado a alguém
        existing = supabase.table("user_devices").select("*").eq("device_id", body.device_id).execute()
        
        if existing.data and len(existing.data) > 0:
            owner_id = existing.data[0].get("user_id")
            if owner_id == str(user.id):
                raise HTTPException(status_code=400, detail="Este dispositivo já está associado à tua conta.")
            else:
                raise HTTPException(status_code=400, detail="Este dispositivo já se encontra registado noutra conta.")

        # 2. Se não existir, associa à conta
        novo_dispositivo = {
            "user_id": str(user.id),
            "device_id": body.device_id
        }

        supabase.table("user_devices").insert(novo_dispositivo).execute()
        return {"status": "ok", "mensagem": "Dispositivo associado com sucesso!", "device_id": body.device_id}
        
    except HTTPException as he:
        raise he # Mantém os erros 400 que criámos
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/devices")
def get_my_devices(authorization: Optional[str] = Header(None)):
    """Devolve a lista de dispositivos geridos pelo utilizador que tem o login feito"""
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Não autenticado")
        
    if not USE_SUPABASE:
        return []
        
    try:
        # Vai buscar todos os dispositivos onde o user_id é o do utilizador logado
        resp = supabase.table("user_devices").select("*").eq("user_id", str(user.id)).execute()
        return resp.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
