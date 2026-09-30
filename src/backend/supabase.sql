-- ==============================================================================
-- 7MGFC — Script SQL de Estrutura para Supabase (PostgreSQL)
-- Projeto: https://crsqpssomhkpapqcoftr.supabase.co
-- Instruções: Copie e cole este script no SQL Editor do seu painel Supabase e execute.
-- ==============================================================================

-- 1. Tabela de Usuários do Sistema
CREATE TABLE IF NOT EXISTS public.users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    daily_limit INT DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 2. Tabela de Limites Diários por Usuário
CREATE TABLE IF NOT EXISTS public.daily_limits (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    download_date DATE NOT NULL,
    downloads_used INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    CONSTRAINT unique_user_date UNIQUE (user_id, download_date)
);

-- 3. Tabela de Histórico de Downloads Realizados
CREATE TABLE IF NOT EXISTS public.downloads_history (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT,
    stock_url TEXT NOT NULL,
    download_url TEXT,
    resource_id TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- 4. Habilitação de Segurança em Nível de Linha (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.downloads_history ENABLE ROW LEVEL SECURITY;

-- 5. Políticas de Acesso (Service Role tem acesso irrestrito para o Backend)
CREATE POLICY "Permitir acesso total service_role a users" ON public.users
    FOR ALL TO authenticated, service_role, anon USING (true) WITH CHECK (true);

CREATE POLICY "Permitir acesso total service_role a daily_limits" ON public.daily_limits
    FOR ALL TO authenticated, service_role, anon USING (true) WITH CHECK (true);

CREATE POLICY "Permitir acesso total service_role a downloads_history" ON public.downloads_history
    FOR ALL TO authenticated, service_role, anon USING (true) WITH CHECK (true);

-- 6. Inserção de Usuários Padrão para Testes (user4 e testuser)
INSERT INTO public.users (username, password_hash, daily_limit)
VALUES 
    ('user4', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 30),
    ('testuser', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 30)
ON CONFLICT (username) DO NOTHING;

-- 7. Inserção de Registro de Teste para o Limite de Hoje
INSERT INTO public.daily_limits (user_id, download_date, downloads_used)
VALUES ('user4', CURRENT_DATE, 3)
ON CONFLICT (user_id, download_date) DO UPDATE
SET downloads_used = EXCLUDED.downloads_used;

