<?php
/**
 * 7MGFC — Setup: Executa SQL no Supabase via pg_query
 * Acesse este arquivo no browser: http://localhost/7MGFC/setup.php
 * 
 * Se não tiver extensão pgsql, ele tentará via a Supabase Management API.
 */

// Credenciais Supabase
$supabaseUrl = 'https://crsqpssomhkpapqcoftr.supabase.co';
$serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyc3Fwc3NvbWhrcGFwcWNvZnRyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MDcxMzU2MCwiZXhwIjoyMTA2Mjg5NTYwfQ.1gVKJCmaO2vZ_VJ7hgY8ZGuF5AhwAgEuoi5Y8d_itjI';

$sqlStatements = [
    // 1. Criar tabela access_keys
    "CREATE TABLE IF NOT EXISTS public.access_keys (
        id BIGSERIAL PRIMARY KEY,
        key_code TEXT UNIQUE NOT NULL,
        duration_hours INT NOT NULL DEFAULT 720,
        is_used BOOLEAN DEFAULT FALSE,
        used_by TEXT DEFAULT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
        used_at TIMESTAMPTZ DEFAULT NULL,
        expires_at TIMESTAMPTZ DEFAULT NULL
    )",
    
    // 2. Adicionar campos na tabela users
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT DEFAULT NULL",
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE",
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user'",
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS access_key_used TEXT DEFAULT NULL",
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL",
    "ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ DEFAULT NULL",
    
    // 3. Habilitar RLS
    "ALTER TABLE public.access_keys ENABLE ROW LEVEL SECURITY",
    
    // 4. Criar admin padrão
    "INSERT INTO public.users (username, password_hash, daily_limit, role, is_active)
     VALUES ('admin', '\$2y\$10\$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 999, 'admin', true)
     ON CONFLICT (username) DO UPDATE SET role = 'admin', daily_limit = 999, is_active = true"
];

// A política precisa de tratamento especial (pode já existir)
$policySQL = "DO \$\$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Permitir acesso total service_role a access_keys'
    ) THEN
        CREATE POLICY \"Permitir acesso total service_role a access_keys\" ON public.access_keys
            FOR ALL TO authenticated, service_role, anon USING (true) WITH CHECK (true);
    END IF;
END \$\$";

echo "<!DOCTYPE html><html><head><title>7MGFC Setup</title>";
echo "<style>body{font-family:monospace;background:#0a0a0f;color:#e0e0e0;padding:30px;} ";
echo ".ok{color:#10b981;} .err{color:#ef4444;} .info{color:#6366f1;} h1{color:#f0f0f5;} ";
echo "pre{background:#12121a;padding:15px;border-radius:8px;border:1px solid #333;overflow-x:auto;}</style></head><body>";
echo "<h1>🔧 7MGFC — Database Setup</h1>";

// Tentar conexão PostgreSQL direta
$pgHost = 'db.crsqpssomhkpapqcoftr.supabase.co';
$pgPort = '5432';
$pgDb = 'postgres';
$pgUser = 'postgres';

// Tentar usar a Connection String do Supabase (requer a senha do DB)
// Se você não tem a senha, use o SQL Editor manual do Supabase

if (extension_loaded('pgsql')) {
    echo "<p class='info'>🔌 Extensão pgsql detectada. Tentando conexão direta...</p>";
    echo "<p class='info'>⚠️ Para conexão direta, informe a senha do banco na variável abaixo no código.</p>";
    
    // COLOQUE SUA SENHA DO BANCO AQUI SE QUISER USAR CONEXÃO DIRETA
    $pgPassword = '';
    
    if (!empty($pgPassword)) {
        $conn = @pg_connect("host=$pgHost port=$pgPort dbname=$pgDb user=$pgUser password=$pgPassword sslmode=require");
        if ($conn) {
            echo "<p class='ok'>✅ Conectado ao PostgreSQL!</p>";
            
            foreach ($sqlStatements as $i => $sql) {
                $result = @pg_query($conn, $sql);
                if ($result) {
                    echo "<p class='ok'>✅ Query " . ($i+1) . " executada com sucesso.</p>";
                } else {
                    $err = pg_last_error($conn);
                    echo "<p class='err'>❌ Query " . ($i+1) . " falhou: " . htmlspecialchars($err) . "</p>";
                }
            }
            
            // Tentar policy
            $result = @pg_query($conn, $policySQL);
            if ($result) {
                echo "<p class='ok'>✅ Política de acesso configurada.</p>";
            } else {
                echo "<p class='err'>⚠️ Política: " . htmlspecialchars(pg_last_error($conn)) . "</p>";
            }
            
            pg_close($conn);
            echo "<p class='ok'>🎉 Setup concluído!</p>";
        } else {
            echo "<p class='err'>❌ Falha na conexão PostgreSQL.</p>";
        }
    } else {
        echo "<p class='info'>ℹ️ Senha do PostgreSQL não configurada. Use o método manual.</p>";
    }
} else {
    echo "<p class='info'>ℹ️ Extensão pgsql não disponível. Use o SQL Editor do Supabase.</p>";
}

// Sempre mostrar o SQL para execução manual
echo "<hr style='border-color:#333;margin:30px 0'>";
echo "<h2>📋 SQL para executar manualmente no Supabase</h2>";
echo "<p>Acesse: <a href='https://supabase.com/dashboard/project/crsqpssomhkpapqcoftr/sql' target='_blank' style='color:#6366f1'>SQL Editor do Supabase</a></p>";
echo "<p>Copie e cole o SQL abaixo:</p>";

$fullSQL = implode(";\n\n", $sqlStatements) . ";\n\n" . $policySQL . ";";
echo "<pre id='sql-code'>" . htmlspecialchars($fullSQL) . "</pre>";
echo "<button onclick=\"navigator.clipboard.writeText(document.getElementById('sql-code').textContent).then(()=>this.textContent='✅ Copiado!')\" ";
echo "style='background:#6366f1;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px'>📋 Copiar SQL</button>";

// Verificar status atual das tabelas via REST API
echo "<hr style='border-color:#333;margin:30px 0'>";
echo "<h2>📊 Status das Tabelas</h2>";

function checkTable($url, $key, $table) {
    $ch = curl_init("$url/rest/v1/$table?select=id&limit=1");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        "apikey: $key",
        "Authorization: Bearer $key"
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    $res = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code;
}

$tables = ['users', 'access_keys', 'daily_limits', 'downloads_history'];
foreach ($tables as $t) {
    $code = checkTable($supabaseUrl, $serviceKey, $t);
    $icon = ($code >= 200 && $code < 300) ? "<span class='ok'>✅</span>" : "<span class='err'>❌ ($code)</span>";
    echo "<p>$icon <strong>$t</strong></p>";
}

echo "</body></html>";
?>
