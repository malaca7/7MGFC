// server.cjs - Servidor local de ponte/proxy para download oficial
const http = require('http');
const https = require('https');
const { URL, URLSearchParams } = require('url');

const PORT = process.env.PORT || 3001;

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(parsed, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: () => Promise.resolve(data)
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function getOfficialDownloadLink(stockUrl, accessCode = 'MG-XNL4-NASL-25U6') {
  // 1. Obter formulário inicial e CSRF
  const getRes = await fetchUrl('https://keyviva.net/magnific/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const html = await getRes.text();
  const csrfMatch = html.match(/name=["']csrf["']\s+value=["']([^"']+)["']/i);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const setCookie = (getRes.headers['set-cookie'] || [])[0] || '';
  const sessionId = setCookie.split(';')[0];

  // 2. Login com código
  const loginBody = new URLSearchParams({ csrf, code: accessCode }).toString();
  const postRes = await fetchUrl('https://keyviva.net/magnific/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': sessionId,
      'Referer': 'https://keyviva.net/magnific/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: loginBody
  });

  const postCookie = (postRes.headers['set-cookie'] || [])[0] || sessionId;
  const panelCookie = postCookie.split(';')[0];

  // 3. Obter CSRF do painel
  const panelRes = await fetchUrl('https://keyviva.net/magnific/panel.php', {
    headers: {
      'Cookie': panelCookie,
      'Referer': 'https://keyviva.net/magnific/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });

  const panelHtml = await panelRes.text();
  const panelCsrfMatch = panelHtml.match(/name=["']csrf["']\s+value=["']([^"']+)["']/i);
  const panelCsrf = panelCsrfMatch ? panelCsrfMatch[1] : csrf;

  // 4. Submeter URL para geração do link
  const genBody = new URLSearchParams({ csrf: panelCsrf, stock_url: stockUrl }).toString();
  const genRes = await fetchUrl('https://keyviva.net/magnific/panel.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': panelCookie,
      'Referer': 'https://keyviva.net/magnific/panel.php',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    },
    body: genBody
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
    throw new Error(cleanError);
  } else {
    throw new Error('Não foi possível gerar o link de download.');
  }
}

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/generate') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body || '{}');
        const stockUrl = payload.stock_url || payload.url;
        const code = payload.code || 'MG-XNL4-NASL-25U6';

        if (!stockUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A URL do recurso é obrigatória.' }));
          return;
        }

        const result = await getOfficialDownloadLink(stockUrl, code);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
});

server.listen(PORT, () => {
  console.log(`[7MGFC Server] Ponte de download rodando em http://localhost:${PORT}`);
});
