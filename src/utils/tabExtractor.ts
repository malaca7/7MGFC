/**
 * 7MGFC — Extrator de Dados e Ativos da Aba Ativa
 *
 * Detecta informações que a própria página disponibiliza:
 * - título
 * - autor
 * - preview
 * - indicação de Premium
 * - links oficiais de download já presentes no DOM
 *
 * Não gera, modifica ou fabrica tokens de autenticação.
 */

import type { ExtractedAssetData } from "../types";

function isSupportedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");

  return (
    host === "magnific.com" ||
    host.endsWith(".magnific.com") ||
    host === "freepik.com" ||
    host.endsWith(".freepik.com")
  );
}

function isCandidateDownloadUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  try {
    const parsed = new URL(value);

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    const isMagnific =
      host === "magnific.com" || host.endsWith(".magnific.com");

    const isFreepik = host === "freepik.com" || host.endsWith(".freepik.com");

    if (!isMagnific && !isFreepik) {
      return false;
    }

    const path = parsed.pathname.toLowerCase();

    /*
     * Aceita apenas URLs que aparentam ser endpoints
     * de download oficiais ou arquivos diretamente
     * disponibilizados pelo domínio.
     */
    const looksLikeDownload =
      path.includes("/download") ||
      path.includes("/d/") ||
      path.endsWith(".zip") ||
      path.endsWith(".rar") ||
      path.endsWith(".7z") ||
      path.endsWith(".psd") ||
      path.endsWith(".ai") ||
      path.endsWith(".eps") ||
      path.endsWith(".pdf");

    return looksLikeDownload;
  } catch {
    return false;
  }
}

function normalizeUrl(value: string, baseUrl: string): string | undefined {
  try {
    const absolute = new URL(value, baseUrl);

    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
      return undefined;
    }

    return absolute.href;
  } catch {
    return undefined;
  }
}

export async function extractFromActiveTab(): Promise<ExtractedAssetData | null> {
  if (
    typeof chrome === "undefined" ||
    !chrome.tabs?.query ||
    !chrome.scripting?.executeScript
  ) {
    return null;
  }

  try {
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    const activeTab = tabs?.[0];

    if (!activeTab?.id || !activeTab.url) {
      return null;
    }

    let activeUrl: URL;

    try {
      activeUrl = new URL(activeTab.url);
    } catch {
      return null;
    }

    if (!isSupportedHost(activeUrl.hostname)) {
      return null;
    }

    const results = await chrome.scripting.executeScript({
      target: {
        tabId: activeTab.id,
      },

      func: () => {
        let mainImageDataUrl: string | undefined;

        /*
         * Preview oficial.
         */
        const ogImage =
          document
            .querySelector('meta[property="og:image"]')
            ?.getAttribute("content") ||
          document
            .querySelector('meta[name="twitter:image"]')
            ?.getAttribute("content") ||
          document.querySelector('link[rel="image_src"]')?.getAttribute("href");

        /*
         * Procura imagem visível.
         */
        const imgElements = Array.from(document.querySelectorAll("img"));

        const targetImg =
          imgElements.find(
            (img) =>
              img.naturalWidth > 300 &&
              (img.src.includes("freepik") ||
                img.src.includes("magnific") ||
                img.src.includes("cdn")),
          ) || imgElements.find((img) => img.naturalWidth > 300);

        if (targetImg && targetImg.complete && targetImg.naturalWidth > 0) {
          try {
            const canvas = document.createElement("canvas");

            canvas.width = targetImg.naturalWidth;

            canvas.height = targetImg.naturalHeight;

            const ctx = canvas.getContext("2d");

            if (ctx) {
              ctx.drawImage(targetImg, 0, 0);

              mainImageDataUrl = canvas.toDataURL("image/png");
            }
          } catch {
            /*
             * Algumas imagens externas
             * bloqueiam canvas.toDataURL().
             */
          }
        }

        /*
         * Procura links de download
         * que a própria página colocou
         * no DOM.
         */
        const possibleUrls: string[] = [];

        const selectors = [
          "a[href]",
          "button[data-download-url]",
          "[data-download-url]",
          "[data-url]",
        ];

        for (const selector of selectors) {
          const elements = Array.from(document.querySelectorAll(selector));

          for (const element of elements) {
            const href = element.getAttribute("href");

            const dataDownload = element.getAttribute("data-download-url");

            const dataUrl = element.getAttribute("data-url");

            if (href) {
              possibleUrls.push(href);
            }

            if (dataDownload) {
              possibleUrls.push(dataDownload);
            }

            if (dataUrl) {
              possibleUrls.push(dataUrl);
            }
          }
        }

        /*
         * Também verifica botões/elementos
         * com atributos relacionados a download.
         */
        const downloadElements = Array.from(
          document.querySelectorAll(
            '[download], [data-testid*="download"], [aria-label*="download" i]',
          ),
        );

        for (const element of downloadElements) {
          const href = element.getAttribute("href");

          const dataUrl = element.getAttribute("data-url");

          const dataDownload = element.getAttribute("data-download-url");

          if (href) {
            possibleUrls.push(href);
          }

          if (dataUrl) {
            possibleUrls.push(dataUrl);
          }

          if (dataDownload) {
            possibleUrls.push(dataDownload);
          }
        }

        /*
         * Seleciona o primeiro link que
         * aparenta ser um download oficial.
         */
        let activeCdnUrl: string | undefined;

        for (const candidate of possibleUrls) {
          try {
            const absolute = new URL(candidate, window.location.href);

            const host = absolute.hostname.toLowerCase().replace(/^www\./, "");

            const validHost =
              host === "magnific.com" ||
              host.endsWith(".magnific.com") ||
              host === "freepik.com" ||
              host.endsWith(".freepik.com");

            if (!validHost) {
              continue;
            }

            const path = absolute.pathname.toLowerCase();

            const looksLikeDownload =
              path.includes("/download") ||
              path.includes("/d/") ||
              path.endsWith(".zip") ||
              path.endsWith(".rar") ||
              path.endsWith(".7z") ||
              path.endsWith(".psd") ||
              path.endsWith(".ai") ||
              path.endsWith(".eps") ||
              path.endsWith(".pdf");

            if (looksLikeDownload) {
              activeCdnUrl = absolute.href;

              break;
            }
          } catch {
            // ignora URL inválida
          }
        }

        /*
         * Metadados.
         */
        const pageTitle = document.title;

        const author =
          document
            .querySelector('[class*="author"], [data-author]')
            ?.textContent?.trim() ||
          document.querySelector('a[href*="/author/"]')?.textContent?.trim();

        const tags = Array.from(
          document.querySelectorAll(
            'a[href*="/search?format="], a[href*="/search?query="]',
          ),
        )
          .map((el) => el.textContent?.trim() || "")
          .filter((tag) => tag.length > 1)
          .slice(0, 10);

        /*
         * Identificação Premium.
         */
        const isPremiumPage = Boolean(
          window.location.pathname.toLowerCase().includes("premium") ||
          document.querySelector(
            '[class*="premium"], [data-premium="true"], [class*="crown"], svg[class*="crown"]',
          ),
        );

        return {
          mainImageDataUrl,
          previewImageUrl: ogImage || undefined,
          activeCdnUrl,
          pageTitle,
          author,
          tags,
          isPremiumPage,
        };
      },
    });

    const extracted = results?.[0]?.result as ExtractedAssetData | undefined;

    if (!extracted) {
      return null;
    }

    /*
     * Normaliza a URL encontrada.
     */
    if (extracted.activeCdnUrl) {
      const normalized = normalizeUrl(extracted.activeCdnUrl, activeTab.url);

      if (normalized && isCandidateDownloadUrl(normalized)) {
        extracted.activeCdnUrl = normalized;
      } else {
        extracted.activeCdnUrl = undefined;
      }
    }

    /*
     * Se não encontrou imagem em data URL,
     * tenta obter a preview.
     */
    if (!extracted.mainImageDataUrl && extracted.previewImageUrl) {
      try {
        const previewUrl = normalizeUrl(
          extracted.previewImageUrl,
          activeTab.url,
        );

        if (previewUrl) {
          const response = await fetch(previewUrl);

          if (response.ok) {
            const blob = await response.blob();

            const reader = new FileReader();

            const dataUrl = await new Promise<string>((resolve) => {
              reader.onloadend = () => resolve(reader.result as string);

              reader.readAsDataURL(blob);
            });

            extracted.mainImageDataUrl = dataUrl;
          }
        }
      } catch (error) {
        console.warn("[7MGFC] Não foi possível obter preview:", error);
      }
    }

    return extracted;
  } catch (error) {
    console.warn("[7MGFC] Falha ao extrair dados da aba:", error);

    return null;
  }
}
