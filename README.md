# ESP32 Security Monitor

Real-time IoT security and environment monitoring system built with an ESP32 microcontroller, a cloud FastAPI backend, and a web dashboard. Developed as part of the Distributed and Telematic Systems Development (DTSD) course at FCT NOVA.

Grade: 19 / 20

Live demo: https://dtsd-lab-1.vercel.app

---

## What it does

The system continuously reads data from sensors connected to an ESP32 and streams it to a cloud backend, where an alert engine evaluates security rules in real time. Users can monitor their devices and alerts through a web dashboard from any browser.

**Sensors**

| Sensor | Measurement |
|---|---|
| DHT22 | Temperature and humidity |
| LDR | Light level |
| HC-SR04 | Distance (intrusion detection) |
| Flame sensor | Fire detection |

**Alert rules**

- Intrusion: object detected closer than 50 cm (60 s cooldown)
- Fire risk: flame sensor active or temperature >= 60 C
- High temperature: above 28 C
- Extreme cold: below 0 C
- High humidity: above 70%
- Dry conditions: below 30%

---

## Architecture

```
ESP32 (sensors + LCD/OLED display)
    |
    | HTTP POST /api/data  (API key, HMAC)
    v
FastAPI Backend (Python, Vercel serverless)
    |
    |-- Alert engine (hysteresis rules, rate limiting)
    |-- Supabase (PostgreSQL cloud database)
    |-- JWT authentication (Supabase Auth)
    v
Web Dashboard (HTML / CSS / JavaScript)
```

---

## Repository Structure

```
esp32-security-monitor/
├── api/
│   └── index.py           # FastAPI backend — sensor ingestion, alert engine, auth
├── backend/
│   └── ESP/
│       ├── ESP_lcd/       # ESP32 firmware with LCD display
│       └── ESP_oled/      # ESP32 firmware with OLED display
├── public/
│   ├── index.html         # Web dashboard
│   ├── app.js             # Dashboard logic
│   └── styles.css
├── supabase_migration.sql # Database schema
├── requirements.txt
└── vercel.json            # Vercel deployment config
```

---

## Backend Features

- **API key authentication** with HMAC constant-time comparison (prevents timing attacks)
- **JWT authentication** via Supabase Auth for dashboard users
- **Per-device rate limiting** (120 requests/min)
- **Device registration** — each ESP32 is linked to a user account
- **Offline data sync** — ESP32 timestamps via NTP, server fallback if unavailable
- **Supabase** as primary storage; in-memory fallback for local development

---

## Tech Stack

| Layer | Technology |
|---|---|
| Firmware | C++ (Arduino / ESP32) |
| Backend | Python, FastAPI, Pydantic, uvicorn |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth (JWT) |
| Frontend | HTML, CSS, JavaScript |
| Deployment | Vercel |

---

## Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your Supabase URL, key, and API secret key

# Run the backend
uvicorn api.index:app --reload

# Open public/index.html in your browser (or use Live Server)
```

---

## Author

Rafael Martins Batista da Silva
MSc Electrical Engineering — FCT NOVA
[github.com/Rafael03mbs](https://github.com/Rafael03mbs)
