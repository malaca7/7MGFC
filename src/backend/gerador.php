<?php
// backend/gerador.php
header('Content-Type: application/json');
require_once 'config.php';

// Função auxiliar para fazer requisições à API do Supabase
function supabase_request($method, $table, $data = null) {
    $ch = curl_init();
    $url = SUPABASE_URL . '/rest/v1/' . $table;
    
    $headers = [
        'apikey: ' . SUPABASE_KEY,
        'Authorization: Bearer ' . SUPABASE_KEY,
        'Content-Type: application/json',
        'Prefer: return=minimal' // Opcional, para respostas mais limpas
    ];

    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    return ['body' => json_decode($response, true), 'status' => $httpCode];
}

// --- LÓGICA PRINCIPAL ---

// 1. Autenticação Simples (Só para o TCC, não é seguro para produção!)
// Em um sistema real, você usaria JWT. Para o TCC, vamos simular com um header.
$username = $_SERVER['HTTP_X_USERNAME'] ?? null;
$password = $_SERVER['HTTP_X_PASSWORD'] ?? null;

if (!$username || !$password) {
    echo json_encode(['success' => false, 'message' => 'Credenciais de autenticação não fornecidas.']);
    exit;
}

// 2. Verificar o usuário no Supabase
$userResponse = supabase_request('GET', 'users', 'username=eq.' . $username);
if ($userResponse['status'] !== 200 || empty($userResponse['body'])) {
    echo json_encode(['success' => false, 'message' => 'Usuário não encontrado.']);
    exit;
}
$user = $userResponse['body'][0];

// 3. Verificar a senha
if (!password_verify($password, $user['password_hash'])) {
    echo json_encode(['success' => false, 'message' => 'Senha incorreta.']);
    exit;
}

// 4. Verificar o limite diário
$today = date('Y-m-d');
$limitResponse = supabase_request('GET', 'daily_limits', "user_id=eq.{$user['id']}&download_date=eq.{$today}");
$limitData = $limitResponse['body'][0] ?? ['downloads_used' => 0];

if ($limitData['downloads_used'] >= DAILY_LIMIT) {
    echo json_encode(['success' => false, 'message' => 'Limite diário de downloads atingido.']);
    exit;
}

// 5. Lógica de requisição para o Magnific
if (!isset($_POST['stock_url']) || !filter_var($_POST['stock_url'], FILTER_VALIDATE_URL)) {
    echo json_encode(['success' => false, 'message' => 'URL do Magnific inválida.']);
    exit;
}

$magnificUrl = $_POST['stock_url'];

// --- AQUI ESTÁ O SEGREDO ---
// Você precisa ter um arquivo 'cookies.txt' com a sessão de uma conta PREMIUM do Magnific.
// Coloque-o na mesma pasta do gerador.php
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $magnificUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_COOKIEFILE, __DIR__ . '/cookies.txt'); // <-- IMPORTANTE!
curl_setopt($ch, CURLOPT_COOKIEJAR, __DIR__ . '/cookies.txt');
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200) {
    echo json_encode(['success' => false, 'message' => 'Falha ao acessar a página do Magnific. Status: ' . $httpCode]);
    exit;
}

// 6. Parse do HTML para encontrar o link de download
$dom = new DOMDocument();
@$dom->loadHTML($response);
$xpath = new DOMXPath($dom);

// O seletor XPath para encontrar o link de download. PODE PRECISAR DE AJUSTES!
$downloadNode = $xpath->query("//a[contains(@class, 'download-button')]/@href")->item(0);

if ($downloadNode) {
    $downloadUrl = $downloadNode->nodeValue;

    // 7. Atualizar o limite no banco de dados
    $updateData = ['user_id' => $user['id'], 'download_date' => $today, 'downloads_used' => $limitData['downloads_used'] + 1];
    supabase_request('POST', 'daily_limits', $updateData);

    echo json_encode([
        'success' => true,
        'download_url' => $downloadUrl,
        'remaining' => DAILY_LIMIT - $limitData['downloads_used'] - 1
    ]);
} else {
    echo json_encode(['success' => false, 'message' => 'Não foi possível encontrar o link de download na página. Verifique o seletor XPath.']);
}
?>