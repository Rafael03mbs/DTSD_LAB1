import time
import random
import requests
import json

API_URL = "http://localhost:8000/api/data"

print("[START] Simulador do ESP32 iniciado...")
print("A enviar dados falsos para o backend para testar o Dashboard!")
print("Pressione Ctrl+C para parar.\n")

device_id = "ESP32_Entrada"
temperature = 22.0
humidity = 50.0  # %
light = 800.0
distance = 150.0 # cm
flame_detected = False

try:
    while True:
        # Variacoes graduais ("Random Walk")
        temperature += random.uniform(-0.5, 0.5)
        humidity += random.uniform(-1.0, 1.0)
        humidity = max(0, min(100, humidity)) # Limit to 0-100%
        light += random.uniform(-20, 20)
        
        # Chance de alguem se aproximar (15% chance, dist < 50cm)
        if random.random() < 0.15:
            distance = random.uniform(10.0, 45.0)
        else:
            # Distancia de standby (e.g. parede)
            distance = random.uniform(150.0, 200.0)
        
        # Chance de incendio / chama! (2% de chance)
        flame_detected = random.random() < 0.02
        if flame_detected or random.random() < 0.01:
            temperature = random.uniform(55.0, 70.0)
            flame_detected = True
            print("[ALERTA] A gerar um alerta simulado de Incendio!")

        payload = {
            "device_id": device_id,
            "temperature": round(temperature, 2),
            "humidity": round(humidity, 2),
            "light_level": round(max(0, light), 2),
            "distance": round(distance, 2),
            "flame_detected": flame_detected
        }

        try:
            res = requests.post(API_URL, json=payload)
            if res.status_code == 200:
                print(f"[OK] T={payload['temperature']}C | H={payload['humidity']}% | L={payload['light_level']}lx | Dist={payload['distance']}cm | Fogo={flame_detected}")
                if res.json().get("alert_triggered"):
                    print(f"[ALARME] NA CLOUD: {res.json().get('alert_message')}")
            else:
                print(f"[ERRO] Erro do backend: {res.status_code}")
        except requests.exceptions.ConnectionError:
            print("[ERRO] Erro de ligacao! O servidor FastAPI esta a correr? (Execute 'uvicorn api.index:app --port 8000')")

        time.sleep(3) # Enviar a cada 3 segundos
except KeyboardInterrupt:
    print("\n[STOP] Simulador terminado.")
