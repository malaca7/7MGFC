// main.js
import { getOfficialDownloadLink } from './src/keyvivaClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('🚀 [7MGFC] Iniciando processo de download oficial premium...');

  // URL do recurso (pode ser passada via argumento de linha de comando ou padrão)
  const argUrl = process.argv[2];
  const magnificUrl = argUrl || "https://www.magnific.com/premium-psd/eletro-funk-party-flyer-template-with-dj-lineup_433136414.htm#fromView=search&page=2&position=9&uuid=4657d59e-c002-4e92-8328-8a7aba170633&track=ais_hybrid&query=flyer+show";

  try {
    console.log(`🔗 Recurso: ${magnificUrl}`);
    console.log('⚡ Conectando ao motor de geração de links oficiais...');
    const result = await getOfficialDownloadLink(magnificUrl);
    
    console.log(`\n✅ Link oficial obtido com sucesso!`);
    console.log(`📦 Arquivo: ${result.fileName}`);
    console.log(`🔗 CDN URL: ${result.downloadUrl}`);

    const outputDir = path.join(__dirname, 'downloads');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, result.fileName);

    console.log(`⬇️ Baixando arquivo oficial para: ${outputPath}...`);
    const fileRes = await fetch(result.downloadUrl);
    if (!fileRes.ok) throw new Error(`Falha ao baixar do CDN: HTTP ${fileRes.status}`);

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);

    console.log(`\n🎉 SUCESSO! Arquivo salvo em: ${outputPath} (${(buffer.length / (1024 * 1024)).toFixed(2)} MB)`);
    console.log(`📊 Cota: ${result.quota.used}/${result.quota.limit} usadas (Restam ${result.quota.remaining})`);
  } catch (error) {
    console.error('\n💥 Erro durante a execução:', error.message);
  }
}

main();