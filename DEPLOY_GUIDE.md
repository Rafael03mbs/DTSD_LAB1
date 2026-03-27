# Guia Completo: Colocar o Projeto 100% Online (Cloud & Database) 🚀

Este guia vai guiá-lo passo a passo para criar a **SUA PRÓPRIA BASE DE DADOS no Supabase** e colocar tanto a API de Python como o seu Dashboard desenhado na internet para todos poderem aceder.

---

## Passo 1: Configurar a sua Base de Dados (Supabase)

1. Vá a [Supabase.com](https://supabase.com/) e crie uma conta (pode fazer login direto com o GitHub).
2. Clique em **"New Project"**.
   - **Name:** *DTSD Security Monitor* (ou algo do género).
   - **Database Password:** Crie uma passe forte (vai precisar dela, guarde-a).
   - **Region:** Escolha *Frankfurt* ou *London* (Europa).
3. Depois do projeto terminar de criar (demora uns 2-3 minutos), vá ao menu do lado esquerdo e clique em **SQL Editor**.
4. Clique em **"New Query"** e cole o seguinte código inteiro para criar as suas tabelas automaticamente:

```sql
-- Criar Tabela principal dos Sensores
CREATE TABLE public.security_events (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL,
    temperature REAL,
    humidity REAL,
    light_level REAL,
    distance REAL,
    flame_detected BOOLEAN,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Criar Tabela de Alertas de Intrusão/Anomalias
CREATE TABLE public.security_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL
);

-- (Opcional) Desligar o RLS para permitir inserção simples pelo Python nesta fase de testes
ALTER TABLE public.security_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_alerts DISABLE ROW LEVEL SECURITY;
```
5. Clique no botão verde direito inferior **"Run"**. *Pronto! As suas duas tabelas de dados já existem.*

### Obter as suas chaves do Supabase:
Ainda no Supabase, no menu lateral esquerdo, vá às **Settings (roda dentada) -> API**.
Vai ver dois valores importantes. Guarde os dois:
- **Project URL** (Geralmente *https://xyz...supabase.co*)
- **Project API Keys -> anon / public** (Uma chave super longa que começa por *ey...*)

No seu ficheiro `main.py` na linha 20 e 21, mude:
```python
SUPABASE_URL = "Cole_aqui_o_seu_Project_URL"
SUPABASE_KEY = "Cole_aqui_a_chave_anon_public"
```

Se reiniciar o simulador (`python test_sensors.py`), a partir de agora **os dados já vão ficar guardados no seu Supabase verdadeiro**! 

---

## Passo 2: Alojamento do Backend Python (Render)
Para o seu Dashboard Funcionar online (e o ESP32 poder comunicar), o backend precisa de sair do seu PC ("localhost") e ir para um servidor Cloud real 24/7.

1. Vá a **[GitHub.com](https://github.com/)** e crie um novo repositório privado chamado `DTSD-Backend`.
2. Faça upload de **todos** os ficheiros da sua pasta raiz (exceto o `frontend`). O ficheiro `main.py` tem de estar na pasta que envia (se quiser facilitar, arraste apenas a pasta `backend`).
3. Vá a **[Render.com](https://render.com/)** e crie uma conta gratuita.
4. Clique em **"New -> Web Service"**.
5. Conecte o seu GitHub e selecione o repositório que acabou de criar.
6. Configure as seguintes propriedades obrigatórias no painel do Render:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port 10000`
7. Clique em **Deploy**. Quando terminar, o Render vai dar-lhe um URL público para a sua API (Ex: `https://dtsd-backend-xf12.onrender.com`). Guarde esse Link!

---

## Passo 3: Alojamento do Frontend Dashboard (Netlify)
Agora o mais fácil, meter aquele painel bonito na internet!

1. Abra o ficheiro **`frontend/app.js`** no seu computador.
2. Na LINHA 1 mude o URL local para o do servidor Render que acabou de criar:
   - *Antes:* `const API_BASE = "http://localhost:8000/api";`
   - **Depois:** `const API_BASE = "https://SEU_URL_DO_RENDER_AQUI.com/api";`
3. Vá a **[Netlify Drop](https://app.netlify.com/drop)** (Não precisa sequer de criar conta se não quiser).
4. **Arraste a pasta inteira `frontend` do seu computador para o circulo do site Netlify.**
5. Dois segundos depois, o Netlify vai dar-lhe um __Link Público Definitivo__! (Ex: `https://magnificent-dtsd-4921x.netlify.app`).

Ao aceder a esse link no telemóvel do Professor, ele verá o sistema a funcionar na Perfeição! E agora quando o ESP desenhado pelo colega enviar os dados, só precisa de apontar os pedidos no ESP32 para o tal endereço Cloud (`https://SEU_URL_DO_RENDER_AQUI...`) em vez do IP local.
