CREATE DATABASE IF NOT EXISTS meu_downloader;

USE meu_downloader;

-- Tabela para os usuários do seu sistema
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela para controlar os limites diários
CREATE TABLE daily_limits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    download_date DATE NOT NULL,
    downloads_used INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (user_id, download_date) -- Garante que só haja um registro por usuário por dia
);

-- Inserindo um usuário de exemplo para testar (senha: 123456)
-- A senha é 'password' e o hash é gerado com password_hash()
INSERT INTO users (username, password_hash) VALUES ('testuser', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');