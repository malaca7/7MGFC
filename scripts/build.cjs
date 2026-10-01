const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('[7MGFC Build] Iniciando verificação de tipos e compilação...');

// 1. TypeScript Check
execSync('npx tsc --noEmit', { stdio: 'inherit' });

// 2. Vite Build
execSync('npx vite build', { stdio: 'inherit' });

// 3. Sincronizar assets para a raiz
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

// 4. Garantir CNAME e .nojekyll no dist
const cnameSrc = path.join(rootDir, 'CNAME');
const cnameDist = path.join(rootDir, 'dist', 'CNAME');
if (fs.existsSync(cnameSrc)) {
  fs.copyFileSync(cnameSrc, cnameDist);
  console.log('[7MGFC Build] CNAME copiado para dist/CNAME');
}

const noJekyllDist = path.join(rootDir, 'dist', '.nojekyll');
fs.writeFileSync(noJekyllDist, '# disable jekyll\n');
console.log('[7MGFC Build] .nojekyll criado em dist/.nojekyll');

console.log('[7MGFC Build] Compilação e preparação concluídas com sucesso!');
