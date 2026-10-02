import type { DownloadProgress } from '../types';

export interface DownloadOptions {
  url: string;
  filename: string;
  apiKey?: string;
  alternativeUrls?: string[];
  resourceDetails?: any;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Inicia download oficial do arquivo original no ambiente web nativo do navegador.
 * Obtém o link assinado autorizado e baixa o arquivo com acompanhamento de progresso real.
 */
export async function executeWebDownload({
  url,
  filename,
  apiKey,
  alternativeUrls,
  onProgress,
}: DownloadOptions): Promise<{ success: boolean; error?: string }> {
  if (!url) {
    return { success: false, error: 'URL de download inválida ou não informada.' };
  }

  let finalUrl = url;

  // 1. Tratamento de API Endpoints oficiais (Freepik / Magnific)
  const isApiEndpoint =
    url.includes('/api/v1/resources/') ||
    url.includes('api.magnific.com') ||
    url.includes('api.freepik.com') ||
    url.includes('www.magnific.com/api') ||
    url.includes('www.freepik.com/api') ||
    url.includes('/download/file/');

  if (isApiEndpoint) {
    const cleanApiKey = apiKey?.trim();
    if (!cleanApiKey) {
      return {
        success: false,
        error:
          'Chave de API oficial necessária para download direto via API. Configure sua chave em Configurações ou utilize a opção "Abrir na Conta Oficial".',
      };
    }

    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      'x-magnific-api-key': cleanApiKey,
      'x-freepik-api-key': cleanApiKey,
      Authorization: `Bearer ${cleanApiKey}`,
    };

    // Normaliza endpoints para os hosts de API REST oficiais
    const rawUrls = [url, ...(alternativeUrls || [])];
    const validEndpoints = Array.from(
      new Set(
        rawUrls
          .map((u) =>
            u
              .replace('www.magnific.com/api', 'api.magnific.com')
              .replace('www.freepik.com/api', 'api.freepik.com')
          )
          .filter(
            (u) =>
              u.startsWith('https://api.magnific.com') ||
              u.startsWith('https://api.freepik.com')
          )
      )
    );

    let resolvedCandidate: string | null = null;
    let lastApiError: string | null = null;

    for (const candidateEndpoint of validEndpoints) {
      try {
        const response = await fetch(candidateEndpoint, {
          method: 'GET',
          headers,
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => null);
          if (errData?.message) {
            lastApiError = errData.message;
          } else {
            lastApiError = `A API oficial retornou erro HTTP ${response.status}: Autorização recusada.`;
          }
          continue;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
          const data = await response.json();
          const candidate =
            data?.url ??
            data?.download_url ??
            data?.file ??
            data?.data?.url ??
            data?.data?.download_url ??
            data?.data?.file ??
            data?.data?.attributes?.download_url ??
            data?.data?.attributes?.url ??
            data?.attributes?.download_url ??
            data?.attributes?.url;

          if (typeof candidate === 'string' && candidate.startsWith('http')) {
            resolvedCandidate = candidate;
            break;
          }
        }
      } catch (fetchErr: any) {
        lastApiError = fetchErr?.message || 'Falha ao conectar com o serviço oficial da API.';
      }
    }

    if (!resolvedCandidate) {
      return {
        success: false,
        error:
          lastApiError ||
          'Chave de API não autorizada ou sem permissão para este recurso no servidor oficial.',
      };
    }

    finalUrl = resolvedCandidate;
  }

  // Guarda de segurança: NUNCA disparar endpoints de API ou URLs de texto/HTML no navegador
  if (
    finalUrl.includes('api.magnific.com') ||
    finalUrl.includes('api.freepik.com') ||
    finalUrl.includes('/api/v1/') ||
    finalUrl.includes('www.magnific.com/api') ||
    finalUrl.includes('www.freepik.com/api')
  ) {
    return {
      success: false,
      error: 'Não foi possível resolver o link do arquivo original para download.',
    };
  }

  // 2. Download do arquivo original com stream de progresso real
  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (!response.ok) {
      return {
        success: false,
        error: `O servidor de arquivos retornou HTTP ${response.status} (${response.statusText || 'Acesso negado'}). O link assinado pode ter expirado.`,
      };
    }

    if (response.body) {
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
      let receivedBytes = 0;
      let lastTime = Date.now();
      let lastBytes = 0;
      let speed = 0;

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;

          const now = Date.now();
          const diffSeconds = (now - lastTime) / 1000;
          if (diffSeconds >= 0.25) {
            speed = Math.round((receivedBytes - lastBytes) / diffSeconds);
            lastBytes = receivedBytes;
            lastTime = now;
          }

          const percent =
            totalBytes > 0 ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100)) : 0;

          onProgress?.({
            receivedBytes,
            totalBytes,
            percent,
            speed,
            state: 'in_progress',
          });
        }
      }

      // Preservar nome original se enviado no cabeçalho Content-Disposition
      let resolvedFilename = filename;
      const disposition = response.headers.get('content-disposition');
      if (disposition && disposition.includes('filename=')) {
        const filenameMatch = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (filenameMatch && filenameMatch[1]) {
          resolvedFilename = filenameMatch[1].replace(/['"]/g, '').trim();
        }
      }

      // Cria Blob com o tipo original do arquivo e dispara o download nativo
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const blob = new Blob(chunks as unknown as BlobPart[], { type: contentType });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = resolvedFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);

      onProgress?.({
        receivedBytes,
        totalBytes: receivedBytes,
        percent: 100,
        speed: 0,
        state: 'complete',
      });

      return { success: true };
    }
  } catch (fetchError: any) {
    console.warn(
      '[7MGFC] Fetch streaming bloqueado por política de CORS. Tentando acionamento nativo do link original:',
      fetchError
    );
  }

  // 3. Fallback: Trigger nativo no navegador do link original
  try {
    onProgress?.({
      receivedBytes: 0,
      totalBytes: 0,
      percent: 100,
      speed: 0,
      state: 'complete',
    });

    const a = document.createElement('a');
    a.href = finalUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Falha ao acionar download do arquivo original no navegador.',
    };
  }
}
