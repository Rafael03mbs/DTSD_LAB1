import time
import random
import requests
import json
import os
from dotenv import load_dotenv

load_dotenv() # Carregar o ficheiro .env

# Cole aqui o link que o Vercel lhe deu (Não se esqueça do /api/data no fim!)
# Exemplo: API_URL = "https://dtsd-security-rafael.vercel.app/api/data"
API_URL = "https://dtsd-lab-1.vercel.app/api/data"
API_KEY = os.environ.get("API_SECRET_KEY") 

print("[START] Simulador do ESP32 iniciado...")
print("A enviar dados falsos para o backend para testar o Dashboard!")
print("Pressione Ctrl+C para parar.\n")

device_id = "ESP32_RafaelS"
temperature = 22.0
humidity = 50.0  # %
light = 800.0
distance = 150.0 # cm
flame_detected = False

try:
    while True:
        # Variações graduais ("Random Walk")
        temperature += random.uniform(-0.5, 0.5)
        humidity += random.uniform(-1.0, 1.0)
        humidity = max(0, min(100, humidity)) # Limitar a 0-100%
        light += random.uniform(-20, 20)
        
        # Probabilidade de alguém se aproximar (15% de probabilidade, dist < 50cm)
        if random.random() < 0.15:
            distance = random.uniform(10.0, 45.0)
        else:
            # Distância em espera (ex. parede)
            distance = random.uniform(150.0, 200.0)
        
        # Probabilidade de incêndio / chama! (Totalmente independente da temperatura)
        flame_detected = random.random() < 0.02
        if flame_detected:
            print("[ALERTA] A gerar um alerta simulado de Chama!")

        # Manter temperatura dentro de limites realistas (18 a 25 graus)
        if temperature > 25.0:
            temperature -= random.uniform(0.5, 1.5)
        elif temperature < 18.0:
            temperature += random.uniform(0.5, 1.5)

        payload = {
            "device_id": device_id,
            "temperature": round(temperature, 2),
            "humidity": round(humidity, 2),
            "light_level": round(max(0, light), 2),
            "distance": round(distance, 2),
            "flame_detected": flame_detected
        }

        try:
            headers = {"x-api-key": API_KEY}
            res = requests.post(API_URL, json=payload, headers=headers)
            if res.status_code == 200:
                print(f"[OK] T={payload['temperature']}C | H={payload['humidity']}% | L={payload['light_level']}lx | Dist={payload['distance']}cm | Fogo={flame_detected}")
                if res.json().get("alert_triggered"):
                    print(f"[ALARME] NA CLOUD: {res.json().get('alert_message')}")
            else:
                print(f"[ERRO] Erro do backend (Status {res.status_code}): {res.text}")
        except requests.exceptions.ConnectionError:
            print("[ERRO] Erro de ligacao! O servidor FastAPI esta a correr? (Execute 'uvicorn api.index:app --port 8000')")

        time.sleep(3) # Enviar a cada 3 segundos
except KeyboardInterrupt:
    print("\n[STOP] Simulador terminado.")
