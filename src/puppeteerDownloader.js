// src/puppeteerDownloader.js
import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PuppeteerDownloader {
  constructor(headless = true) {
    this.headless = headless;
  }

  async downloadFile(magnificUrl, outputPath = './downloads') {
    let browser;
    try {
      console.log('🚀 Iniciando o navegador...');
      browser = await puppeteer.launch({ 
        headless: this.headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Args para evitar problemas em alguns ambientes
      });
      const page = await browser.newPage();
      
      // Aumenta o timeout padrão para esperar elementos, pois a página pode ser lenta
      page.setDefaultTimeout(30000); // 30 segundos

      console.log(`📍 Navegando para https://7mgfc.malaca.com.br/...`);
      await page.goto('https://7mgfc.malaca.com.br/', { waitUntil: 'networkidle2' });

      // --- ETAPA 1: LOGIN (SIMBÓLICO) ---
      console.log('🔐 Preenchendo formulário de login...');
      // Usa um seletor mais robusto que não depende do placeholder
      await page.waitForSelector('input[placeholder="Seu nome de usuário"]');
      await page.type('input[placeholder="Seu nome de usuário"]', 'aa');
      
      // Encontra o botão de login pelo texto visível, que é mais confiável
      await page.waitForSelector('button:has-text("Acessar Painel")');
      await page.click('button:has-text("Acessar Painel")');
      
      // Espera a página fazer qualquer transição pós-login
      await page.waitForTimeout(2000);

      // --- ETAPA 2: IDENTIFICAÇÃO DO RECURSO ---
      console.log(`🔗 Colando a URL do recurso...`);
      // CORREÇÃO: Usando o seletor correto baseado no placeholder completo
      await page.waitForSelector('input[placeholder*="freepik.com"]');
      await page.type('input[placeholder*="freepik.com"]', magnificUrl);
      
      console.log('🔍 Clicando para identificar o recurso...');
      await page.click('button:has-text("IDENTIFICAR & LIBERAR DOWNLOAD")');
      await page.waitForTimeout(3000); // Espera a UI atualizar

      // --- ETAPA 3: INJEÇÃO DO SCRIPT DE BYPASS ---
      console.log('💉 Injetando script para burlar a verificação de premium...');
      await page.evaluateOnNewDocument(() => {
        // Tentamos sobrescrever várias variáveis globais que possam controlar o acesso premium
        window.isPremiumUser = () => true;
        window.userHasPremium = true;
        window.appState = window.appState || {};
        window.appState.isPremium = true;
        window.appState.user = window.appState.user || {};
        window.appState.user.isPremium = true;
        console.log('🎭 Injeção de bypass de premium aplicada!');
      });
      
      // --- ETAPA 4: DOWNLOAD ---
      console.log('⬇️ Clicando no botão de download...');
      await page.click('button:has-text("BAIXAR ARQUIVO")');
      
      console.log('⏳ Aguardando o link de download (Blob URL) ser gerado...');
      
      // Espera o link <a> ser criado e clica nele
      await page.waitForSelector('body > a', { visible: true });
      
      // Intercepta a próxima navegação, que será para o blob URL
      const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
        page.click('body > a')
      ]);

      // --- ETAPA 5: SALVAMENTO DO ARQUIVO ---
      if (response && response.url().startsWith('blob:')) {
        console.log('✅ Blob URL interceptado! Extraindo conteúdo...');
        const buffer = await response.buffer();
        
        if (!fs.existsSync(outputPath)) {
          fs.mkdirSync(outputPath, { recursive: true });
        }
        
        const fileName = `premium-file-${Date.now()}.zip`;
        const filePath = path.join(outputPath, fileName);
        fs.writeFileSync(filePath, buffer);

        console.log(`🎉 Download concluído! Arquivo salvo em: ${filePath}`);
        return { success: true, filePath };
      } else {
        throw new Error('❌ Não foi possível interceptar o Blob URL. A injeção de script pode ter falhado ou o site mudou.');
      }

    } catch (error) {
      console.error('💥 Erro durante o processo automatizado:', error.message);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}

export default PuppeteerDownloader;