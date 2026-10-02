// src/keyvivaClient.js

/**
 * Cliente para autenticação e geração de links oficiais no KeyViva / Magnific
 */
export async function getOfficialDownloadLink(
  stockUrl,
  accessCode = 'MG-XNL4-NASL-25U6'
) {
  try {
    // 1. Obter formulário inicial e CSRF
    const getRes = await fetch('https://keyviva.net/magnific/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!getRes.ok) {
      throw new Error(`Falha ao conectar com o serviço KeyViva: HTTP ${getRes.status}`);
    }

    const html = await getRes.text();
    const csrfMatch = html.match(/name=["']csrf["']\s+value=["']([^"']+)["']/i);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    const setCookie = getRes.headers.get('set-cookie') || '';
    const sessionId = setCookie.split(';')[0];

    // 2. Fazer login com o código de acesso
    const postRes = await fetch('https://keyviva.net/magnific/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': sessionId,
        'Referer': 'https://keyviva.net/magnific/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: new URLSearchParams({
        csrf: csrf,
        code: accessCode
      }),
      redirect: 'manual'
    });

    const postCookie = postRes.headers.get('set-cookie') || sessionId;
    const panelCookie = postCookie ? postCookie.split(';')[0] : sessionId;

    // 3. Acessar panel.php para capturar o CSRF do formulário de download
    const panelRes = await fetch('https://keyviva.net/magnific/panel.php', {
      headers: {
        'Cookie': panelCookie,
        'Referer': 'https://keyviva.net/magnific/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    const panelHtml = await panelRes.text();
    const panelCsrfMatch = panelHtml.match(/name=["']csrf["']\s+value=["']([^"']+)["']/i);
    const panelCsrf = panelCsrfMatch ? panelCsrfMatch[1] : csrf;

    // 4. Submeter a URL do Magnific para geração do link oficial
    const genRes = await fetch('https://keyviva.net/magnific/panel.php', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': panelCookie,
        'Referer': 'https://keyviva.net/magnific/panel.php',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: new URLSearchParams({
        csrf: panelCsrf,
        stock_url: stockUrl
      })
    });

    const genHtml = await genRes.text();
    const linkMatch = genHtml.match(/href=["'](https:\/\/[^"']*(?:magnific\.com|freepik\.com)[^"']*)["']/i);
    const fileMatch = genHtml.match(/class=["']kv-file-name["']>([^<]+)<\/div>/i);
    const errorMatch = genHtml.match(/class=["']kv-alert kv-alert-danger["'][^>]*>([\s\S]*?)<\/div>/i);

    if (linkMatch) {
      return {
        success: true,
        downloadUrl: linkMatch[1].replace(/&amp;/g, '&'),
        fileName: fileMatch ? fileMatch[1].trim() : 'recurso-oficial.zip',
        quota: {
          used: genHtml.match(/<span>Used today<\/span><strong>(\d+)<\/strong>/i)?.[1] || '1',
          remaining: genHtml.match(/<span>Remaining<\/span><strong>(\d+)<\/strong>/i)?.[1] || '29',
          limit: genHtml.match(/<span>Daily limit<\/span><strong>(\d+)<\/strong>/i)?.[1] || '30'
        }
      };
    } else if (errorMatch) {
      const cleanError = errorMatch[1].replace(/<[^>]+>/g, '').trim();
      throw new Error(`Serviço de download: ${cleanError}`);
    } else {
      throw new Error('Não foi possível extrair o link oficial de download retornado pelo servidor.');
    }
  } catch (err) {
    console.error('[KeyViva Client Error]:', err.message);
    throw err;
  }
}

export default getOfficialDownloadLink;
