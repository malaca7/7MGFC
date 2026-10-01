import type { DownloadProgress } from '../types';

export interface DownloadOptions {
  url: string;
  filename: string;
  apiKey?: string;
  alternativeUrls?: string[];
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Inicia download no ambiente web nativo do navegador.
 * Suporta stream de progresso via fetch com fallback automático para trigger de link âncora.
 */
export async function executeWebDownload({
  url,
  filename,
  apiKey,
  alternativeUrls,
  onProgress,
}: DownloadOptions): Promise<{ success: boolean; error?: string }> {
  if (!url) {
    return { success: false, error: 'URL de download inválida.' };
  }

  let finalUrl = url;

  // 1. Tratamento de API Endpoints (Freepik / Magnific)
  const isApiEndpoint =
    url.includes('/api/v1/resources/') ||
    url.includes('api.magnific.com') ||
    url.includes('api.freepik.com') ||
    url.includes('/download/file/');

  if (isApiEndpoint) {
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const urlsToTry = [url, ...(alternativeUrls || [])];
    let resolvedCandidate: string | null = null;

    for (const candidateEndpoint of urlsToTry) {
      try {
        const response = await fetch(candidateEndpoint, {
          method: 'GET',
          headers,
        });

        if (!response.ok) continue;

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
          const data = await response.json();
          const candidate =
            data?.url ??
            data?.download_url ??
            data?.file ??
            data?.data?.url ??
            data?.data?.download_url ??
            data?.data?.file;

          if (typeof candidate === 'string' && candidate.startsWith('http')) {
            resolvedCandidate = candidate;
            break;
          }
        }
      } catch {
        // Tenta próxima URL
      }
    }

    if (resolvedCandidate) {
      finalUrl = resolvedCandidate;
    }
  }

  // 2. Tentativa de download com acompanhamento de progresso (Streaming Fetch)
  try {
    const response = await fetch(finalUrl, {
      method: 'GET',
      headers: {
        Accept: '*/*',
      },
    });

    if (response.ok && response.body) {
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

      // Cria Blob e dispara download
      const blob = new Blob(chunks as unknown as BlobPart[]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
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
  } catch (fetchError) {
    console.warn(
      '[7MGFC] Fetch streaming restrito pelo navegador/CORS. Utilizando trigger nativo direto:',
      fetchError
    );
  }

  // 3. Fallback: Trigger nativo no navegador (funciona sempre, mesmo com CORS restrito)
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
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Falha ao acionar download no navegador.',
    };
  }
}
