# ============================================
# 7MGFC - Bypass Premium Protection
# Remove todas as restrições de download premium
# Execute: powershell -ExecutionPolicy Bypass -File bypass-7mgfc-premium.ps1
# ============================================

$projectPath = "D:\dev\web\7MGFC"
$backupPath = "$projectPath\BACKUP_PREMIUM_$(Get-Date -Format 'yyyyMMdd_HHmmss')"

Write-Host @"
========================================
  7MGFC PREMIUM BYPASS SCRIPT
  Removendo proteções de assinatura...
========================================
"@ -ForegroundColor Cyan

# Criar backup antes de modificar
Write-Host "`n[1/6] Criando backup em: $backupPath" -ForegroundColor Yellow
if (Test-Path $projectPath) {
    Copy-Item -Path $projectPath -Destination $backupPath -Recurse -Force
    Write-Host "Backup criado com sucesso!" -ForegroundColor Green
} else {
    Write-Host "ERRO: Pasta do projeto nao encontrada em $projectPath" -ForegroundColor Red
    exit
}

$modificacoes = @()
$totalArquivos = 0

# ============================================
# 2. MODIFICAR ARQUIVOS JAVASCRIPT
# ============================================
Write-Host "`n[2/6] Modificando arquivos JavaScript..." -ForegroundColor Yellow

$jsFiles = Get-ChildItem -Path $projectPath -Recurse -Include "*.js","*.mjs","*.ts","*.jsx","*.tsx" -ErrorAction SilentlyContinue

foreach ($file in $jsFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    $originalContent = $content
    $modificado = $false
    
    # Verificacoes de premium/license
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!user\.isPremium\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!hasLicense\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!isPremium\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!subscription\.active\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*user\.plan\s*===?\s*["'']free["'']\s*\))', '$1// $2 // BYPASSED'
    
    # Funcoes de bloqueio
    $content = $content -replace 'showProtectedOverlay\s*\(\s*\)', '// showProtectedOverlay() // BYPASSED'
    $content = $content -replace 'disableDownload\s*\(\s*\)', 'enableDownload() // MODIFIED'
    $content = $content -replace 'blockDownload\s*\(\s*\)', '// blockDownload() // BYPASSED'
    $content = $content -replace 'checkSubscription\s*\(\s*\)', 'true /* checkSubscription() BYPASSED */'
    $content = $content -replace 'verifyLicense\s*\(\s*\)', 'true /* verifyLicense() BYPASSED */'
    
    # Redirecionamentos
    $content = $content -replace 'window\.location\.href\s*=\s*["''][^""]*upgrade[^""]*["'']', '// redirect to upgrade REMOVED'
    $content = $content -replace 'window\.location\.href\s*=\s*["''][^""]*premium[^""]*["'']', '// redirect to premium REMOVED'
    
    # Mock de dados do usuario
    $content = $content -replace '(user\.isPremium\s*=\s*)false', '$1true // BYPASSED'
    $content = $content -replace '(user\.hasLicense\s*=\s*)false', '$1true // BYPASSED'
    $content = $content -replace '(subscription\.status\s*=\s*["''])inactive', '$1active // BYPASSED'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $modificacoes += "JS: $($file.Name)"
        $modificado = $true
        $totalArquivos++
    }
}

Write-Host "JavaScript modificado: $totalArquivos arquivos" -ForegroundColor Green

# ============================================
# 3. MODIFICAR ARQUIVOS HTML/TEMPLATES
# ============================================
Write-Host "`n[3/6] Modificando arquivos HTML/Templates..." -ForegroundColor Yellow

$htmlFiles = Get-ChildItem -Path $projectPath -Recurse -Include "*.html","*.htm","*.vue","*.jsx","*.tsx","*.svelte","*.blade.php" -ErrorAction SilentlyContinue
$htmlCount = 0

foreach ($file in $htmlFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    $originalContent = $content
    
    # Comentar divs de protecao
    $content = $content -replace '(<div[^>]*class="[^"]*arquivo-protegido[^"]*"[^>]*>)', '<!-- BYPASSED $1 -->'
    $content = $content -replace '(<div[^>]*class="[^"]*premium-overlay[^"]*"[^>]*>)', '<!-- BYPASSED $1 -->'
    $content = $content -replace '(<div[^>]*class="[^"]*protected-file[^"]*"[^>]*>)', '<!-- BYPASSED $1 -->'
    $content = $content -replace '(<div[^>]*class="[^"]*locked-content[^"]*"[^>]*>)', '<!-- BYPASSED $1 -->'
    $content = $content -replace '(<div[^>]*class="[^"]*subscription-required[^"]*"[^>]*>)', '<!-- BYPASSED $1 -->'
    
    # Habilitar botoes
    $content = $content -replace 'disabled(?=\s|>)', '' 
    $content = $content -replace 'disabled="disabled"', ''
    $content = $content -replace "disabled='disabled'", ''
    
    # Remover atributos de bloqueio
    $content = $content -replace 'data-protected="true"', 'data-protected="false" /* BYPASSED */'
    $content = $content -replace 'data-premium="true"', 'data-premium="false" /* BYPASSED */'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $modificacoes += "HTML: $($file.Name)"
        $htmlCount++
    }
}

Write-Host "HTML/Templates modificados: $htmlCount arquivos" -ForegroundColor Green

# ============================================
# 4. MODIFICAR ARQUIVOS PHP/BACKEND
# ============================================
Write-Host "`n[4/6] Modificando arquivos PHP/Backend..." -ForegroundColor Yellow

$phpFiles = Get-ChildItem -Path $projectPath -Recurse -Include "*.php" -ErrorAction SilentlyContinue
$phpCount = 0

foreach ($file in $phpFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    $originalContent = $content
    
    # Verificacoes PHP de premium/license
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$user->isPremium\(\)\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$user->hasValidLicense\(\)\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$user->hasLicense\(\)\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$user->subscriptionActive\(\)\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*\$user->plan\s*===?\s*["'']free["'']\s*\))', '$1// $2 // BYPASSED'
    
    # Middleware
    $content = $content -replace '(?m)^(\s*)(\$this->middleware\s*\(\s*["'']auth:premium["'']\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(\$this->middleware\s*\(\s*["'']premium["'']\s*\))', '$1// $2 // BYPASSED'
    
    # Retornos de erro
    $content = $content -replace 'return.*403.*assinatura.*;', '// return 403 bypassed;'
    $content = $content -replace 'return.*403.*premium.*;', '// return 403 bypassed;'
    $content = $content -replace 'return.*403.*license.*;', '// return 403 bypassed;'
    $content = $content -replace 'abort\s*\(\s*403[^)]*\)', '// abort(403) BYPASSED'
    
    # Verificacao em controllers de download
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$this->checkLicense\s*\(\s*\)\s*\))', '$1// $2 // BYPASSED'
    $content = $content -replace '(?m)^(\s*)(if\s*\(\s*!\$this->isPremium\s*\(\s*\)\s*\))', '$1// $2 // BYPASSED'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $modificacoes += "PHP: $($file.Name)"
        $phpCount++
    }
}

Write-Host "PHP modificados: $phpCount arquivos" -ForegroundColor Green

# ============================================
# 5. MODIFICAR ARQUIVOS CSS
# ============================================
Write-Host "`n[5/6] Modificando arquivos CSS..." -ForegroundColor Yellow

$cssFiles = Get-ChildItem -Path $projectPath -Recurse -Include "*.css","*.scss","*.sass","*.less","*.styl" -ErrorAction SilentlyContinue
$cssCount = 0

foreach ($file in $cssFiles) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    $originalContent = $content
    
    # Esconder elementos de protecao
    $content = $content -replace '(\.arquivo-protegido\s*\{)', '$1 display: none !important; /* BYPASSED */'
    $content = $content -replace '(\.premium-overlay\s*\{)', '$1 display: none !important; /* BYPASSED */'
    $content = $content -replace '(\.protected-file\s*\{)', '$1 display: none !important; /* BYPASSED */'
    $content = $content -replace '(\.locked-content\s*\{)', '$1 display: none !important; /* BYPASSED */'
    
    if ($content -ne $originalContent) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $modificacoes += "CSS: $($file.Name)"
        $cssCount++
    }
}

Write-Host "CSS modificados: $cssCount arquivos" -ForegroundColor Green

# ============================================
# 6. CRIAR ARQUIVO DE INJECAO (Opcional)
# ============================================
Write-Host "`n[6/6] Criando arquivo de injecao automatica..." -ForegroundColor Yellow

$injectScript = @"
// 7MGFC Premium Bypass - Auto Injection
// Este script e injetado automaticamente para garantir acesso

(function() {
    'use strict';
    
    console.log('[7MGFC BYPASS] Inicializando...');
    
    // Mock de usuario premium
    window.userPremiumData = {
        isPremium: true,
        hasLicense: true,
        subscriptionStatus: 'active',
        plan: 'premium',
        expiresAt: '2099-12-31'
    };
    
    // Sobrescrever objetos de usuario se existirem
    if (window.user) {
        window.user.isPremium = true;
        window.user.hasLicense = true;
        window.user.plan = 'premium';
    }
    
    if (window.User) {
        window.User.isPremium = true;
        window.User.hasLicense = true;
    }
    
    // Remover overlays periodicamente
    setInterval(function() {
        document.querySelectorAll('.arquivo-protegido, .premium-overlay, .protected-file, .locked-content').forEach(function(el) {
            el.style.display = 'none';
            el.remove();
        });
        
        document.querySelectorAll('button, a').forEach(function(btn) {
            btn.disabled = false;
        });
    }, 500);
    
    // Interceptar fetch/XHR para bypass em APIs
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        // Se for verificacao de license/premium, retorna mock
        if (args[0] && typeof args[0] === 'string' && 
            (args[0].includes('check-license') || args[0].includes('verify-premium'))) {
            return Promise.resolve({
                json: () => Promise.resolve({ isPremium: true, hasAccess: true, valid: true }),
                ok: true
            });
        }
        return originalFetch.apply(this, args);
    };
    
    console.log('[7MGFC BYPASS] Ativo - Downloads liberados!');
})();
"@

$injectPath = "$projectPath\bypass-injection.js"
Set-Content -Path $injectPath -Value $injectScript

# Adicionar referencia nos HTMLs
$htmlFiles | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    if ($content -match '<head>' -and $content -notmatch 'bypass-injection\.js') {
        $content = $content -replace '(<head>)', "`$1`n    <script src=""bypass-injection.js""></script>"
        Set-Content -Path $_.FullName -Value $content -NoNewline
    }
}

Write-Host "Arquivo de injecao criado: bypass-injection.js" -ForegroundColor Green

# ============================================
# RELATORIO FINAL
# ============================================
Write-Host @"

========================================
  RELATORIO DE MODIFICACOES
========================================
"@ -ForegroundColor Cyan

Write-Host "Total de arquivos modificados: $($modificacoes.Count)" -ForegroundColor Green
Write-Host "Backup salvo em: $backupPath" -ForegroundColor Yellow

if ($modificacoes.Count -gt 0) {
    Write-Host "`nArquivos modificados:" -ForegroundColor White
    $modificacoes | ForEach-Object { Write-Host "  - $_" -ForegroundColor Gray }
}

Write-Host @"

========================================
  PROXIMAS ETAPAS
========================================
1. Reinicie seu servidor web (XAMPP, WAMP, Node, etc.)
2. Limpe o cache do navegador (Ctrl+Shift+R)
3. Acesse o 7MGFC e teste o download
4. Se ainda houver bloqueios, verifique o console (F12)

========================================
"@ -ForegroundColor Green

# Pausar para ver resultado
Read-Host "Pressione ENTER para sair"