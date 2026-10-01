// main.js
import PuppeteerDownloader from './src/puppeteerDownloader.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// --- Código boilerplate para obter o __dirname em módulos ES ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// --------------------------------------------------------------

// Carrega o arquivo JSON de forma síncrona
const configPath = join(__dirname, 'config', 'metadados_projeto.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

async function main() {
  console.log('Iniciando o processo de download via automação de navegador...');

  // A URL completa do recurso no Magnific
  const magnificUrl = "https://www.magnific.com/premium-psd/eletro-funk-party-flyer-template-with-dj-lineup_433136414.htm#fromView=search&page=2&position=9&uuid=4657d59e-c002-4e92-8328-8a7aba170633&track=ais_hybrid&query=flyer+show";

  const downloader = new PuppeteerDownloader(false); // 'false' para ver o navegador, 'true' para oculto
  
  try {
    const result = await downloader.downloadFile(magnificUrl);
    console.log('\n✅ SUCESSO! Processo finalizado.');
    console.log(`📁 Arquivo salvo em: ${result.filePath}`);
  } catch (error) {
    console.error('\n💥 Ocorreu um erro crítico durante a execução:', error.message);
  }
}

main();