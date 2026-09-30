<?php
/**
 * 7MGFC — API Backend para Painel Administrativo
 * Gerencia usuários e chaves de acesso via Supabase
 */
session_start();
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/config.php';

// ==================== HELPERS ====================

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function requireAdmin() {
    if (!isset($_SESSION['user']) || $_SESSION['user']['role'] !== 'admin') {
        jsonResponse(['success' => false, 'message' => 'Acesso negado. Apenas administradores.'], 403);
    }
}

function requireAuth() {
    if (!isset($_SESSION['user'])) {
        jsonResponse(['success' => false, 'message' => 'Não autenticado.'], 401);
    }
}

function generateAccessKey($prefix = '7MGFC') {
    $chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    $segments = [];
    for ($i = 0; $i < 4; $i++) {
        $segment = '';
        for ($j = 0; $j < 4; $j++) {
            $segment .= $chars[random_int(0, strlen($chars) - 1)];
        }
        $segments[] = $segment;
    }
    return $prefix . '-' . implode('-', $segments);
}

// ==================== ROTEADOR ====================

$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    // ==================== AUTH ====================
    case 'login':
        handleLogin();
        break;
    case 'register':
        handleRegister();
        break;
    case 'logout':
        handleLogout();
        break;
    case 'check_session':
        handleCheckSession();
        break;

    // ==================== ADMIN: USERS ====================
    case 'list_users':
        requireAdmin();
        handleListUsers();
        break;
    case 'create_user':
        requireAdmin();
        handleCreateUser();
        break;
    case 'toggle_user':
        requireAdmin();
        handleToggleUser();
        break;
    case 'delete_user':
        requireAdmin();
        handleDeleteUser();
        break;
    case 'update_user':
        requireAdmin();
        handleUpdateUser();
        break;

    // ==================== ADMIN: KEYS ====================
    case 'list_keys':
        requireAdmin();
        handleListKeys();
        break;
    case 'generate_keys':
        requireAdmin();
        handleGenerateKeys();
        break;
    case 'toggle_key':
        requireAdmin();
        handleToggleKey();
        break;
    case 'delete_key':
        requireAdmin();
        handleDeleteKey();
        break;

    // ==================== ADMIN: STATS ====================
    case 'dashboard_stats':
        requireAdmin();
        handleDashboardStats();
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Ação não reconhecida: ' . $action], 400);
}

// ==================== AUTH HANDLERS ====================

function handleLogin() {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';

    if (empty($username) || empty($password)) {
        jsonResponse(['success' => false, 'message' => 'Preencha todos os campos.'], 400);
    }

    // Buscar usuário
    $res = supabaseRequest('users?username=eq.' . urlencode($username) . '&select=*', 'GET');
    if (!$res['success'] || empty($res['data'])) {
        jsonResponse(['success' => false, 'message' => 'Usuário não encontrado.'], 404);
    }

    $user = $res['data'][0];

    // Verificar se está ativo
    if (isset($user['is_active']) && !$user['is_active']) {
        jsonResponse(['success' => false, 'message' => 'Conta desativada. Contate o administrador.'], 403);
    }

    // Verificar se expirou
    if (!empty($user['expires_at']) && strtotime($user['expires_at']) < time()) {
        jsonResponse(['success' => false, 'message' => 'Seu acesso expirou. Contate o administrador.'], 403);
    }

    // Verificar senha
    if (!password_verify($password, $user['password_hash'])) {
        jsonResponse(['success' => false, 'message' => 'Senha incorreta.'], 401);
    }

    // Atualizar último login
    supabaseRequest('users?id=eq.' . $user['id'], 'PATCH', ['last_login' => date('c')]);

    // Criar sessão
    unset($user['password_hash']);
    $_SESSION['user'] = $user;

    jsonResponse(['success' => true, 'message' => 'Login realizado com sucesso!', 'user' => $user]);
}

function handleRegister() {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $accessKey = trim($input['access_key'] ?? '');

    if (empty($username) || empty($password) || empty($accessKey)) {
        jsonResponse(['success' => false, 'message' => 'Preencha todos os campos incluindo a chave de acesso.'], 400);
    }

    if (strlen($password) < 6) {
        jsonResponse(['success' => false, 'message' => 'A senha deve ter no mínimo 6 caracteres.'], 400);
    }

    // Verificar se username já existe
    $existing = supabaseRequest('users?username=eq.' . urlencode($username) . '&select=id', 'GET');
    if ($existing['success'] && !empty($existing['data'])) {
        jsonResponse(['success' => false, 'message' => 'Este nome de usuário já está em uso.'], 409);
    }

    // Verificar a chave de acesso
    $keyRes = supabaseRequest('access_keys?key_code=eq.' . urlencode($accessKey) . '&is_used=eq.false&is_active=eq.true&select=*', 'GET');
    if (!$keyRes['success'] || empty($keyRes['data'])) {
        jsonResponse(['success' => false, 'message' => 'Chave de acesso inválida, já utilizada ou desativada.'], 400);
    }

    $key = $keyRes['data'][0];
    $now = date('c');
    $expiresAt = date('c', strtotime('+' . $key['duration_hours'] . ' hours'));

    // Criar o usuário
    $passwordHash = password_hash($password, PASSWORD_BCRYPT);
    $userData = [
        'username' => $username,
        'password_hash' => $passwordHash,
        'daily_limit' => DEFAULT_DAILY_LIMIT,
        'is_active' => true,
        'role' => 'user',
        'access_key_used' => $accessKey,
        'expires_at' => $expiresAt
    ];

    $createRes = supabaseRequest('users', 'POST', [$userData]);
    if (!$createRes['success']) {
        jsonResponse(['success' => false, 'message' => 'Erro ao criar usuário: ' . ($createRes['error'] ?? 'desconhecido')], 500);
    }

    // Marcar key como usada
    supabaseRequest('access_keys?id=eq.' . $key['id'], 'PATCH', [
        'is_used' => true,
        'used_by' => $username,
        'used_at' => $now,
        'expires_at' => $expiresAt
    ]);

    jsonResponse(['success' => true, 'message' => 'Conta criada com sucesso! Faça login para continuar.']);
}

function handleLogout() {
    session_destroy();
    jsonResponse(['success' => true, 'message' => 'Logout realizado.']);
}

function handleCheckSession() {
    if (isset($_SESSION['user'])) {
        jsonResponse(['success' => true, 'user' => $_SESSION['user']]);
    } else {
        jsonResponse(['success' => false, 'message' => 'Não autenticado.'], 401);
    }
}

// ==================== ADMIN: USERS HANDLERS ====================

function handleListUsers() {
    $res = supabaseRequest('users?select=id,username,email,daily_limit,is_active,role,access_key_used,expires_at,last_login,created_at&order=created_at.desc', 'GET');
    if ($res['success']) {
        jsonResponse(['success' => true, 'users' => $res['data']]);
    } else {
        jsonResponse(['success' => false, 'message' => 'Erro ao listar usuários: ' . $res['error']], 500);
    }
}

function handleCreateUser() {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = trim($input['username'] ?? '');
    $password = $input['password'] ?? '';
    $role = $input['role'] ?? 'user';
    $dailyLimit = (int)($input['daily_limit'] ?? DEFAULT_DAILY_LIMIT);

    if (empty($username) || empty($password)) {
        jsonResponse(['success' => false, 'message' => 'Username e senha são obrigatórios.'], 400);
    }

    $userData = [
        'username' => $username,
        'password_hash' => password_hash($password, PASSWORD_BCRYPT),
        'daily_limit' => $dailyLimit,
        'is_active' => true,
        'role' => $role
    ];

    $res = supabaseRequest('users', 'POST', [$userData]);
    if ($res['success']) {
        jsonResponse(['success' => true, 'message' => 'Usuário criado com sucesso!']);
    } else {
        jsonResponse(['success' => false, 'message' => 'Erro ao criar: ' . $res['error']], 500);
    }
}

function handleToggleUser() {
    $input = json_decode(file_get_contents('php://input'), true);
    $userId = $input['user_id'] ?? null;
    $isActive = $input['is_active'] ?? null;

    if ($userId === null || $isActive === null) {
        jsonResponse(['success' => false, 'message' => 'Parâmetros inválidos.'], 400);
    }

    $res = supabaseRequest('users?id=eq.' . $userId, 'PATCH', ['is_active' => (bool)$isActive]);
    jsonResponse(['success' => $res['success'], 'message' => $res['success'] ? 'Status atualizado!' : $res['error']]);
}

function handleDeleteUser() {
    $input = json_decode(file_get_contents('php://input'), true);
    $userId = $input['user_id'] ?? null;

    if (!$userId) {
        jsonResponse(['success' => false, 'message' => 'ID do usuário é obrigatório.'], 400);
    }

    // Não permitir excluir a si mesmo
    if ($_SESSION['user']['id'] == $userId) {
        jsonResponse(['success' => false, 'message' => 'Você não pode excluir sua própria conta.'], 400);
    }

    $res = supabaseRequest('users?id=eq.' . $userId, 'DELETE');
    jsonResponse(['success' => $res['success'], 'message' => $res['success'] ? 'Usuário excluído!' : $res['error']]);
}

function handleUpdateUser() {
    $input = json_decode(file_get_contents('php://input'), true);
    $userId = $input['user_id'] ?? null;
    $updates = [];

    if (!$userId) {
        jsonResponse(['success' => false, 'message' => 'ID do usuário é obrigatório.'], 400);
    }

    if (isset($input['daily_limit'])) $updates['daily_limit'] = (int)$input['daily_limit'];
    if (isset($input['role'])) $updates['role'] = $input['role'];
    if (isset($input['is_active'])) $updates['is_active'] = (bool)$input['is_active'];
    if (!empty($input['password'])) $updates['password_hash'] = password_hash($input['password'], PASSWORD_BCRYPT);

    if (empty($updates)) {
        jsonResponse(['success' => false, 'message' => 'Nenhuma alteração fornecida.'], 400);
    }

    $res = supabaseRequest('users?id=eq.' . $userId, 'PATCH', $updates);
    jsonResponse(['success' => $res['success'], 'message' => $res['success'] ? 'Usuário atualizado!' : $res['error']]);
}

// ==================== ADMIN: KEYS HANDLERS ====================

function handleListKeys() {
    $res = supabaseRequest('access_keys?select=*&order=created_at.desc', 'GET');
    if ($res['success']) {
        jsonResponse(['success' => true, 'keys' => $res['data']]);
    } else {
        jsonResponse(['success' => false, 'message' => 'Erro ao listar keys: ' . $res['error']], 500);
    }
}

function handleGenerateKeys() {
    $input = json_decode(file_get_contents('php://input'), true);
    $quantity = min(max((int)($input['quantity'] ?? 1), 1), 50);
    $durationHours = (int)($input['duration_hours'] ?? 720); // Padrão: 30 dias

    $keys = [];
    $keysData = [];

    for ($i = 0; $i < $quantity; $i++) {
        $keyCode = generateAccessKey();
        $keys[] = $keyCode;
        $keysData[] = [
            'key_code' => $keyCode,
            'duration_hours' => $durationHours,
            'is_used' => false,
            'is_active' => true
        ];
    }

    $res = supabaseRequest('access_keys', 'POST', $keysData);
    if ($res['success']) {
        jsonResponse([
            'success' => true,
            'message' => $quantity . ' chave(s) gerada(s) com sucesso!',
            'keys' => $keys,
            'duration_hours' => $durationHours
        ]);
    } else {
        jsonResponse(['success' => false, 'message' => 'Erro ao gerar keys: ' . $res['error']], 500);
    }
}

function handleToggleKey() {
    $input = json_decode(file_get_contents('php://input'), true);
    $keyId = $input['key_id'] ?? null;
    $isActive = $input['is_active'] ?? null;

    if ($keyId === null || $isActive === null) {
        jsonResponse(['success' => false, 'message' => 'Parâmetros inválidos.'], 400);
    }

    $res = supabaseRequest('access_keys?id=eq.' . $keyId, 'PATCH', ['is_active' => (bool)$isActive]);
    jsonResponse(['success' => $res['success'], 'message' => $res['success'] ? 'Status da key atualizado!' : $res['error']]);
}

function handleDeleteKey() {
    $input = json_decode(file_get_contents('php://input'), true);
    $keyId = $input['key_id'] ?? null;

    if (!$keyId) {
        jsonResponse(['success' => false, 'message' => 'ID da key é obrigatório.'], 400);
    }

    $res = supabaseRequest('access_keys?id=eq.' . $keyId, 'DELETE');
    jsonResponse(['success' => $res['success'], 'message' => $res['success'] ? 'Key excluída!' : $res['error']]);
}

// ==================== ADMIN: STATS ====================

function handleDashboardStats() {
    // Total de usuários
    $usersRes = supabaseRequest('users?select=id', 'GET');
    $totalUsers = $usersRes['success'] ? count($usersRes['data']) : 0;

    // Usuários ativos
    $activeUsersRes = supabaseRequest('users?is_active=eq.true&select=id', 'GET');
    $activeUsers = $activeUsersRes['success'] ? count($activeUsersRes['data']) : 0;

    // Total de keys
    $keysRes = supabaseRequest('access_keys?select=id', 'GET');
    $totalKeys = $keysRes['success'] ? count($keysRes['data']) : 0;

    // Keys disponíveis
    $availableKeysRes = supabaseRequest('access_keys?is_used=eq.false&is_active=eq.true&select=id', 'GET');
    $availableKeys = $availableKeysRes['success'] ? count($availableKeysRes['data']) : 0;

    // Downloads hoje
    $today = date('Y-m-d');
    $downloadsRes = supabaseRequest('daily_limits?download_date=eq.' . $today . '&select=downloads_used', 'GET');
    $todayDownloads = 0;
    if ($downloadsRes['success'] && is_array($downloadsRes['data'])) {
        foreach ($downloadsRes['data'] as $row) {
            $todayDownloads += (int)($row['downloads_used'] ?? 0);
        }
    }

    jsonResponse([
        'success' => true,
        'stats' => [
            'total_users' => $totalUsers,
            'active_users' => $activeUsers,
            'total_keys' => $totalKeys,
            'available_keys' => $availableKeys,
            'today_downloads' => $todayDownloads
        ]
    ]);
}
?>
