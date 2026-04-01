-- ================================================================
-- MIGRATION: Isolamento de dados por utilizador
-- Executa este SQL no Supabase Dashboard → SQL Editor → New query
-- ================================================================

-- 1. Adicionar coluna user_id às tabelas existentes
ALTER TABLE security_events ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE security_alerts ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Criar tabela de associação dispositivo <-> utilizador
CREATE TABLE IF NOT EXISTS user_devices (
    id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    device_id  TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Ativar Row Level Security (RLS) nas tabelas
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices    ENABLE ROW LEVEL SECURITY;

-- 4. Políticas de segurança: cada utilizador só vê os seus dados

-- security_events: só lê as suas próprias linhas
CREATE POLICY "Utilizador vê apenas os seus eventos"
    ON security_events FOR SELECT
    USING (auth.uid() = user_id);

-- security_alerts: só lê os seus próprios alertas
CREATE POLICY "Utilizador vê apenas os seus alertas"
    ON security_alerts FOR SELECT
    USING (auth.uid() = user_id);

-- user_devices: só vê e gere os seus dispositivos
CREATE POLICY "Utilizador gere os seus dispositivos"
    ON user_devices FOR ALL
    USING (auth.uid() = user_id);

-- 5. Permitir que o backend (service role) insira em tudo
--    O service role ignora RLS por padrão, por isso não é necessário política de INSERT para o backend.
--    Se quiseres ser explícito:
-- CREATE POLICY "Service role pode inserir eventos" ON security_events FOR INSERT WITH CHECK (true);
-- CREATE POLICY "Service role pode inserir alertas" ON security_alerts FOR INSERT WITH CHECK (true);
