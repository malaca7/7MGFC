const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('[7MGFC Build] Iniciando verificação de tipos e compilação...');

// 1. TypeScript Check
execSync('npx tsc --noEmit', { stdio: 'inherit' });

// 2. Vite Build
execSync('npx vite build', { stdio: 'inherit' });

// 3. Sincronizar assets para a raiz (garante funcionamento no GitHub Pages)
const rootDir = path.resolve(__dirname, '..');
const distAssets = path.join(rootDir, 'dist', 'assets');
const rootAssets = path.join(rootDir, 'assets');

if (fs.existsSync(distAssets)) {
  if (!fs.existsSync(rootAssets)) {
    fs.mkdirSync(rootAssets, { recursive: true });
  }

  const files = fs.readdirSync(distAssets);
  for (const file of files) {
    const src = path.join(distAssets, file);
    const dest = path.join(rootAssets, file);
    fs.copyFileSync(src, dest);
    console.log(`[7MGFC Build] Copiado ${file} -> assets/`);
  }
}

// 4. Garantir .nojekyll
const noJekyllPath = path.join(rootDir, '.nojekyll');
if (!fs.existsSync(noJekyllPath)) {
  fs.writeFileSync(noJekyllPath, '# disable jekyll\n');
}

console.log('[7MGFC Build] Compilação e preparação para GitHub Pages concluídas com sucesso!');
