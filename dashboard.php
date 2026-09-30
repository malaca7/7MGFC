<?php
session_start();
require_once __DIR__ . '/src/backend/config.php';

if (!isset($_SESSION['user'])) {
    header('Location: /');
    exit;
}

$user = $_SESSION['user'];

// Buscar uso diário
$today = date('Y-m-d');
$usage = getSupabaseUsage($user['username'] ?? $user['id'], $today);
$limit = $user['daily_limit'] ?? DEFAULT_DAILY_LIMIT;
$remaining = max(0, $limit - $usage);
$usagePercent = $limit > 0 ? min(100, round(($usage / $limit) * 100)) : 0;

// Verificar expiração
$expiresAt = !empty($user['expires_at']) ? strtotime($user['expires_at']) : null;
$isExpired = $expiresAt && $expiresAt < time();
$daysLeft = $expiresAt ? max(0, ceil(($expiresAt - time()) / 86400)) : null;
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>7MGFC — Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg: #0a0a0f;
            --bg-card: rgba(18,18,28,0.7);
            --border: rgba(255,255,255,0.06);
            --text: #f0f0f5;
            --text-sec: #8b8b9e;
            --text-muted: #5a5a6e;
            --accent: #6366f1;
            --accent-glow: rgba(99,102,241,0.12);
            --success: #10b981;
            --error: #ef4444;
            --warning: #f59e0b;
            --radius: 12px;
        }
        body {
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 40px 20px;
        }
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            max-width: 700px;
            margin-bottom: 32px;
        }
        .header h1 { font-size: 20px; font-weight: 700; }
        .header .user-badge {
            display: flex; align-items: center; gap: 10px;
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 8px 14px;
        }
        .header .avatar {
            width: 32px; height: 32px;
            background: linear-gradient(135deg, var(--accent), #a855f7);
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 12px; font-weight: 700; color: white;
        }
        .header .username { font-size: 13px; font-weight: 600; }
        .btn-logout {
            background: rgba(239,68,68,0.08);
            border: 1px solid rgba(239,68,68,0.15);
            color: var(--error);
            padding: 6px 12px; border-radius: 8px;
            font-size: 12px; font-weight: 500;
            cursor: pointer; font-family: inherit;
        }
        .btn-logout:hover { background: rgba(239,68,68,0.15); }

        .cards { width: 100%; max-width: 700px; display: grid; gap: 16px; }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 24px;
            position: relative;
            overflow: hidden;
        }
        .card::before {
            content: '';
            position: absolute; top: 0; left: 0; right: 0; height: 2px;
        }
        .card:nth-child(1)::before { background: linear-gradient(90deg, var(--accent), transparent); }
        .card:nth-child(2)::before { background: linear-gradient(90deg, var(--success), transparent); }
        .card:nth-child(3)::before { background: linear-gradient(90deg, var(--warning), transparent); }
        .card-title {
            font-size: 12px; font-weight: 600; color: var(--text-muted);
            text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 16px;
        }
        .card-value { font-size: 32px; font-weight: 800; letter-spacing: -1px; }
        .card-sub { font-size: 13px; color: var(--text-sec); margin-top: 4px; }

        .progress-bar {
            width: 100%; height: 8px;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            margin-top: 16px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            border-radius: 4px;
            transition: width 0.8s ease;
        }
        .progress-fill.green { background: var(--success); }
        .progress-fill.yellow { background: var(--warning); }
        .progress-fill.red { background: var(--error); }

        .status-row {
            display: flex; align-items: center; gap: 8px;
            margin-top: 8px;
        }
        .status-dot {
            width: 8px; height: 8px; border-radius: 50%;
        }
        .status-dot.active { background: var(--success); box-shadow: 0 0 8px rgba(16,185,129,0.4); }
        .status-dot.expired { background: var(--error); box-shadow: 0 0 8px rgba(239,68,68,0.4); }
        .status-text { font-size: 13px; font-weight: 500; }

        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 500px) { .grid-2 { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>📊 Dashboard</h1>
        <div style="display:flex;gap:10px;align-items:center">
            <div class="user-badge">
                <div class="avatar"><?= strtoupper(substr($user['username'], 0, 2)) ?></div>
                <span class="username"><?= htmlspecialchars($user['username']) ?></span>
            </div>
            <button class="btn-logout" onclick="fetch('/src/backend/api.php?action=logout',{method:'POST'}).then(()=>location.href='/')">Sair</button>
        </div>
    </div>

    <div class="cards">
        <!-- Downloads -->
        <div class="card">
            <div class="card-title">Downloads Hoje</div>
            <div class="card-value"><?= $usage ?> <span style="font-size:16px;color:var(--text-muted);font-weight:400">/ <?= $limit ?></span></div>
            <div class="card-sub"><?= $remaining ?> downloads restantes</div>
            <div class="progress-bar">
                <div class="progress-fill <?= $usagePercent >= 90 ? 'red' : ($usagePercent >= 60 ? 'yellow' : 'green') ?>" style="width:<?= $usagePercent ?>%"></div>
            </div>
        </div>

        <div class="grid-2">
            <!-- Status da Conta -->
            <div class="card">
                <div class="card-title">Status da Conta</div>
                <div class="status-row">
                    <div class="status-dot <?= $isExpired ? 'expired' : 'active' ?>"></div>
                    <span class="status-text" style="color:<?= $isExpired ? 'var(--error)' : 'var(--success)' ?>">
                        <?= $isExpired ? 'Expirada' : 'Ativa' ?>
                    </span>
                </div>
                <?php if ($daysLeft !== null): ?>
                    <div class="card-sub" style="margin-top:12px">
                        <?= $isExpired ? 'Acesso expirado' : $daysLeft . ' dia(s) restante(s)' ?>
                    </div>
                <?php else: ?>
                    <div class="card-sub" style="margin-top:12px">Sem expiração</div>
                <?php endif; ?>
            </div>

            <!-- Info -->
            <div class="card">
                <div class="card-title">Informações</div>
                <div class="card-sub"><strong>Limite diário:</strong> <?= $limit ?></div>
                <div class="card-sub"><strong>Membro desde:</strong> <?= isset($user['created_at']) ? date('d/m/Y', strtotime($user['created_at'])) : '—' ?></div>
                <?php if (!empty($user['access_key_used'])): ?>
                    <div class="card-sub"><strong>Key usada:</strong> <?= htmlspecialchars(substr($user['access_key_used'], 0, 14)) ?>…</div>
                <?php endif; ?>
            </div>
        </div>
    </div>
</body>
</html>
