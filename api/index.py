from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from supabase import create_client, Client
from datetime import datetime, timezone, timedelta
from typing import Optional
from collections import defaultdict
from time import time as time_now
import hmac
import re
import os

# Apenas carregar .env em desenvolvimento local (na Vercel, as variáveis são injetadas pelo painel)
if os.environ.get("VERCEL") is None:
    from dotenv import load_dotenv
    load_dotenv()

app = FastAPI(title="ESP32 Security Monitor API")

# CORS restrito apenas aos domínios necessários
ALLOWED_ORIGINS = [
    os.environ.get("FRONTEND_URL", "https://dtsd-security-monitor.vercel.app"),
    "http://localhost:3000",   # Dev local
    "http://localhost:5500",   # Live Server VS Code
    "http://127.0.0.1:5500",  # Live Server VS Code (alternativo)
    "http://localhost:8000",   # Uvicorn local
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "x-api-key"],
)

# 1. Configurações do Supabase (Colocar as chaves reais)
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
USE_SUPABASE = True

API_SECRET_KEY = os.environ.get("API_SECRET_KEY")

# Falha imediata se a chave API não estiver configurada — previne bypass total
if not API_SECRET_KEY:
    raise RuntimeError("FATAL: API_SECRET_KEY não está definida nas variáveis de ambiente! O servidor não pode arrancar sem esta chave.")

if USE_SUPABASE:
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("[OK] Supabase ativado!")
    except Exception as e:
        print(f"[ERRO] Erro ao ligar ao Supabase: {e}")
        USE_SUPABASE = False
else:
    print("[AVISO] Supabase desativado (Credenciais não configuradas). Utiliza recurso em memória para testes locais.")

# Estrutura de dados do ESP32 — com validação de input
class SensorData(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=64)
    temperature: float = Field(..., ge=-50, le=80)       # DHT22
    humidity: float = Field(..., ge=0, le=100)            # DHT22
    light_level: float = Field(..., ge=0, le=100000)      # LDR
    distance: float = Field(..., ge=0, le=20000)          # HC-SR04 (timeout pode dar valores altos)
    flame_detected: bool                                   # Sensor de chama
    # Timestamp NTP enviado pelo ESP32 — usado para dados offline armazenados no SD
    # Se ausente ou inválido, o servidor usa datetime.now(UTC) como fallback
    timestamp: Optional[str] = None

    @validator('device_id')
    def validate_device_id(cls, v):
        if not re.match(r'^[a-zA-Z0-9_\-]+$', v):
            raise ValueError('device_id deve conter apenas letras, números, _ e -')
        return v

# Modelo para registo de dispositivo
class DeviceRegister(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=64)

    @validator('device_id')
    def validate_device_id(cls, v):
        if not re.match(r'^[a-zA-Z0-9_\-]+$', v):
            raise ValueError('device_id deve conter apenas letras, números, _ e -')
        return v

# Armazenamento em memória para testes imediatos antes da configuração total do Supabase
local_data_storage = []
local_alerts_storage = []

# Rate limiter simples por device_id (protege contra DoS por instância quente)
_rate_limit_map = defaultdict(list)
RATE_LIMIT_WINDOW = 60   # segundos
RATE_LIMIT_MAX = 120     # max requests por device_id por minuto (aumentado para suportar fila offline)

# Estado dos alertas por dispositivo (evita enviar alertas contínuos)
_device_alert_state = defaultdict(lambda: {
    "high_temp": False, 
    "low_temp": False,
    "high_hum": False,
    "low_hum": False,
    "last_intrusion": 0,
    "last_flame": 0
})

# Retorna True se o pedido deve ser rejeitado por excesso de taxa.
def check_rate_limit(device_id: str) -> bool:
    now = time_now()
    window = _rate_limit_map[device_id]
    _rate_limit_map[device_id] = [t for t in window if now - t < RATE_LIMIT_WINDOW]
    if len(_rate_limit_map[device_id]) >= RATE_LIMIT_MAX:
        return True
    _rate_limit_map[device_id].append(now)
    return False

# Cache de mapeamento device_id -> user_id com TTL (reduz queries ao Supabase)
_device_user_cache = {}
_cache_ttl = 300  # 5 minutos

# Obtém o user_id associado a um device_id, com cache de 5 minutos.
def get_user_id_by_device(device_id: str) -> Optional[str]:
    if not USE_SUPABASE:
        return None

    now = time_now()
    cached = _device_user_cache.get(device_id)
    if cached and (now - cached['ts']) < _cache_ttl:
        return cached['user_id']

    try:
        resp = supabase.table("user_devices").select("user_id").eq("device_id", device_id).single().execute()
        user_id = resp.data.get("user_id") if resp.data else None
        _device_user_cache[device_id] = {'user_id': user_id, 'ts': now}
        return user_id
    except Exception:
        return None

# Valida o token JWT do Supabase e retorna o utilizador.
def get_user_from_token(authorization: Optional[str]) -> Optional[dict]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    try:
        resp = supabase.auth.get_user(token)
        return resp.user
    except Exception:
        return None

# Função auxiliar que processa regras de alerta e armazena os dados na base de dados local e Supabase.
def process_and_store_sensor_data(data: SensorData, user_id: Optional[str]) -> dict:
    # Usar o timestamp NTP enviado pelo ESP32 se existir e for válido (formato ISO 8601).
    esp_timestamp = data.timestamp
    if esp_timestamp and not esp_timestamp.startswith("1970"):
        try:
            # Aceitar formatos: "2026-04-21T15:30:00Z" ou "2026-04-21T15:30:00+00:00"
            parsed = datetime.fromisoformat(esp_timestamp.replace('Z', '+00:00'))
            # Rejeitar timestamps do futuro (> 2 min) ou muito antigos (> 7 dias)
            now_utc = datetime.now(timezone.utc)
            if parsed > now_utc + timedelta(minutes=2):
                timestamp = now_utc.isoformat()
            elif (now_utc - parsed).days > 7:
                timestamp = now_utc.isoformat()
            else:
                timestamp = parsed.isoformat()
        except (ValueError, AttributeError):
            timestamp = datetime.now(timezone.utc).isoformat()
    else:
        # Sem timestamp do ESP32 ou NTP falhou (1970) — usar hora do servidor
        timestamp = datetime.now(timezone.utc).isoformat()

    data_dict = data.dict()
    data_dict.pop("timestamp", None)  # Remover o campo bruto do ESP32
    data_dict["timestamp"] = timestamp  # Inserir o timestamp validado

    if user_id:
        data_dict["user_id"] = user_id

    alert_triggered = False
    alert_message = ""
    now_ts = time_now()

    # 1. Regra de Intrusão: Distância < 50cm
    if data.distance < 50.0:
        # Cooldown de 60 segundos para não spammar
        if now_ts - _device_alert_state[data.device_id]["last_intrusion"] > 60:
            alert_triggered = True
            alert_message = f"[ALARME DE INTRUSAO] Movimento a {data.distance}cm em {data.device_id}"
            _device_alert_state[data.device_id]["last_intrusion"] = now_ts

    # 2. Regra Comercial de Incêndio: Chama ou Temperatura >= 60C
    if data.flame_detected or data.temperature >= 60.0:
        # Cooldown de 60 segundos
        if now_ts - _device_alert_state[data.device_id]["last_flame"] > 60:
            alert_triggered = True
            prefix = " | " if alert_message else ""
            
            if data.flame_detected and data.temperature >= 60.0:
                motivo = f"Chama + {data.temperature}C"
            elif data.flame_detected:
                motivo = "Sensor detetou Chama"
            else:
                motivo = f"Temperatura Crítica de {data.temperature}C"
                
            alert_message += f"{prefix}[INCENDIO] Risco desastroso! ({motivo})"
            _device_alert_state[data.device_id]["last_flame"] = now_ts
        
    # 3. Temperatura (Hysteresis - Threshold bloqueante)
    if 28.0 < data.temperature < 60.0:
        if not _device_alert_state[data.device_id]["high_temp"]:
            alert_triggered = True
            prefix = " | " if alert_message else ""
            alert_message += f"{prefix}Temperatura muito alta ({data.temperature}C)"
            _device_alert_state[data.device_id]["high_temp"] = True
    elif data.temperature < 27.0:
        _device_alert_state[data.device_id]["high_temp"] = False

    if data.temperature < 0.0:
        if not _device_alert_state[data.device_id]["low_temp"]:
            alert_triggered = True
            prefix = " | " if alert_message else ""
            alert_message += f"{prefix}Frio extremo ({data.temperature}C)"
            _device_alert_state[data.device_id]["low_temp"] = True
    elif data.temperature > 1.0:
        _device_alert_state[data.device_id]["low_temp"] = False

    # 4. Humidade (Hysteresis - Threshold bloqueante)
    if data.humidity > 70.0:
        if not _device_alert_state[data.device_id]["high_hum"]:
            alert_triggered = True
            prefix = " | " if alert_message else ""
            alert_message += f"{prefix}Humidade muito alta ({data.humidity}%)"
            _device_alert_state[data.device_id]["high_hum"] = True
    elif data.humidity < 65.0:
        _device_alert_state[data.device_id]["high_hum"] = False

    if data.humidity < 30.0:
        if not _device_alert_state[data.device_id]["low_hum"]:
            alert_triggered = True
            prefix = " | " if alert_message else ""
            alert_message += f"{prefix}Tempo muito seco ({data.humidity}%)"
            _device_alert_state[data.device_id]["low_hum"] = True
    elif data.humidity > 35.0:
        _device_alert_state[data.device_id]["low_hum"] = False

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


# Recebe dados dos sensores do ESP32, processa regras de alerta e armazena os dados na base de dados.
@app.post("/api/data")
def receive_data(data: SensorData, x_api_key: Optional[str] = Header(None)):
    # Comparação em tempo constante para prevenir timing attacks
    if not x_api_key or not hmac.compare_digest(x_api_key, API_SECRET_KEY):
        raise HTTPException(status_code=401, detail="Acesso negado: Chave API invalida ou ausente")

    # Verificar rate limit por dispositivo
    if check_rate_limit(data.device_id):
        raise HTTPException(status_code=429, detail="Demasiadas requisições. Tenta novamente mais tarde.")

    # Associar o user_id ao device_id (para isolação de dados por utilizador)
    user_id = get_user_id_by_device(data.device_id)
    return process_and_store_sensor_data(data, user_id)


# Novo endpoint seguro para receber simulação do frontend usando token JWT do utilizador
@app.post("/api/simulate-data")
def simulate_data(data: SensorData, authorization: Optional[str] = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Não autenticado")

    # Verificar se o utilizador é proprietário deste dispositivo
    user_id = get_user_id_by_device(data.device_id)
    if not user_id:
        raise HTTPException(status_code=403, detail="Este dispositivo não está registado. Registe-o primeiro na secção 'Dispositivo'.")
    if user_id != str(user.id):
        raise HTTPException(status_code=403, detail="Este dispositivo pertence a outro utilizador.")

    # Processar e guardar as leituras sob o ID do utilizador autenticado
    return process_and_store_sensor_data(data, user_id)



# Associa um device_id ao utilizador autenticado.
@app.post("/api/register-device")
def register_device(body: DeviceRegister, authorization: Optional[str] = Header(None)):
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

# Devolve a lista de dispositivos geridos pelo utilizador que tem o login feito
@app.get("/api/devices")
def get_my_devices(authorization: Optional[str] = Header(None)):
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

# Endpoints GET agora exigem autenticação e filtram por utilizador
# Devolve os dados de segurança filtrados pelo utilizador autenticado.
@app.get("/api/data")
def get_recent_data(authorization: Optional[str] = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Não autenticado")

    if USE_SUPABASE:
        try:
            response = (supabase.table("security_events")
                       .select("*")
                       .eq("user_id", str(user.id))
                       .order("timestamp", desc=True)
                       .limit(100)
                       .execute())
            return response.data
        except Exception as e:
            print(f"Erro a ler do Supabase (data): {e}")
            return [d for d in local_data_storage if d.get("user_id") == str(user.id)]

    return [d for d in local_data_storage if d.get("user_id") == str(user.id)]

# Devolve os alertas filtrados pelo utilizador autenticado.
@app.get("/api/alerts")
def get_recent_alerts(authorization: Optional[str] = Header(None)):
    user = get_user_from_token(authorization)
    if not user:
        raise HTTPException(status_code=401, detail="Não autenticado")

    if USE_SUPABASE:
        try:
            response = (supabase.table("security_alerts")
                       .select("*")
                       .eq("user_id", str(user.id))
                       .order("timestamp", desc=True)
                       .limit(50)
                       .execute())
            return response.data
        except Exception as e:
            print(f"Erro a ler do Supabase (alerts): {e}")
            return [a for a in local_alerts_storage if a.get("user_id") == str(user.id)]

    return [a for a in local_alerts_storage if a.get("user_id") == str(user.id)]

if __name__ == "__main__":
    import uvicorn
    # Executar na porta 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
