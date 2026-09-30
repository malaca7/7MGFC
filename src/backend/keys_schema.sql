-- ==============================================================================
-- 7MGFC — Tabela de Chaves de Acesso para Supabase (PostgreSQL)
-- Execute no SQL Editor do Supabase
-- ==============================================================================

-- 1. Tabela de Chaves de Acesso
CREATE TABLE IF NOT EXISTS public.access_keys (
    id BIGSERIAL PRIMARY KEY,
    key_code TEXT UNIQUE NOT NULL,
    duration_hours INT NOT NULL DEFAULT 720,
    is_used BOOLEAN DEFAULT FALSE,
    used_by TEXT DEFAULT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NULL,
    expires_at TIMESTAMPTZ DEFAULT NULL
);

-- 2. Adicionar campos extras na tabela users (se não existirem)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS access_key_used TEXT DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ DEFAULT NULL;

-- 3. Habilitar RLS
ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY;

-- 4. Política de acesso
CREATE POLICY "Permitir acesso total service_role a access_keys" ON public.access_keys
    FOR ALL TO authenticated, service_role, anon USING (true) WITH CHECK (true);

-- 5. Inserir usuário admin padrão (senha: password - mesmo hash das seeds)
INSERT INTO public.users (username, password_hash, daily_limit, role, is_active)
VALUES ('admin', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 999, 'admin', true)
ON CONFLICT (username) DO UPDATE SET role = 'admin', daily_limit = 999, is_active = true;

-- NOTA: A senha padrão do admin é "password"
-- Para alterar, use o painel ou gere um novo hash com:
-- PHP: echo password_hash('sua_nova_senha', PASSWORD_BCRYPT);
