/**
 * 7MGFC — Background Service Worker (Manifest V3)
 *
 * Responsabilidades:
 * - iniciar downloads através da Chrome Downloads API
 * - acompanhar progresso
 * - registrar histórico
 * - detectar respostas HTML quando era esperado um arquivo
 *
 * A autenticação do site continua sendo responsabilidade
 * da plataforma oficial.
 */

import type { HistoryRecord, AppSettings } from "../types";

interface TrackedDownload {
  id: number;

  url: string;

  filename: string;

  lastBytes: number;

  lastTime: number;

  speed: number;

  type: string;
}

const activeDownloads = new Map<number, TrackedDownload>();

const DEFAULT_SETTINGS: AppSettings = {
  conflictAction: "uniquify",

  autoDownload: false,

  subfolder: "7MGFC",

  notifications: true,

  maxHistoryItems: 50,

  magnificApiKey: "",
};

/**
 * Inicialização.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["history", "settings"], (res) => {
    if (!res.history) {
      chrome.storage.local.set({
        history: [],
      });
    }

    if (!res.settings) {
      chrome.storage.local.set({
        settings: DEFAULT_SETTINGS,
      });
    }
  });
});

/**
 * Verifica se o arquivo esperado
 * parece ser um arquivo binário.
 */
function isArchiveFilename(filename: string): boolean {
  const lower = filename.toLowerCase();

  return (
    lower.endsWith(".zip") ||
    lower.endsWith(".rar") ||
    lower.endsWith(".7z") ||
    lower.endsWith(".tar") ||
    lower.endsWith(".gz") ||
    lower.endsWith(".psd")
  );
}

/**
 * Verifica se uma URL é claramente
 * uma página HTML.
 */
function isHtmlUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    const path = parsed.pathname.toLowerCase();

    return (
      path.endsWith(".htm") ||
      path.endsWith(".html") ||
      path.endsWith("/login") ||
      path.endsWith("/signin") ||
      path.endsWith("/checkout")
    );
  } catch {
    return false;
  }
}

/**
 * Intercepta respostas HTML quando
 * o download deveria ser um arquivo.
 *
 * Isso evita salvar uma página de login
 * com nome .zip.
 */
chrome.downloads.onCreated.addListener((item) => {
  const tracked = activeDownloads.get(item.id);

  if (!tracked) {
    return;
  }

  if (!isArchiveFilename(tracked.filename)) {
    return;
  }

  const itemFilename = (item.filename || "").toLowerCase();

  const itemUrl = (item.url || "").toLowerCase();

  const isHtml =
    item.mime === "text/html" ||
    itemFilename.endsWith(".htm") ||
    itemFilename.endsWith(".html") ||
    isHtmlUrl(itemUrl);

  if (!isHtml) {
    return;
  }

  console.warn("[7MGFC] Download HTML detectado no lugar do arquivo:", item.id);

  chrome.downloads.cancel(item.id, () => {
    chrome.downloads.erase({
      id: item.id,
    });

    activeDownloads.delete(item.id);
  });
});

/**
 * Determinação do nome final.
 */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const tracked = activeDownloads.get(item.id);

  if (tracked && isArchiveFilename(tracked.filename)) {
    const itemFilename = (item.filename || "").toLowerCase();

    const itemUrl = (item.url || "").toLowerCase();

    const isHtml =
      item.mime === "text/html" ||
      itemFilename.endsWith(".htm") ||
      itemFilename.endsWith(".html") ||
      isHtmlUrl(itemUrl);

    if (isHtml) {
      console.warn(
        "[7MGFC] HTML detectado durante determinação do nome:",
        item.id,
      );

      chrome.downloads.cancel(item.id, () => {
        chrome.downloads.erase({
          id: item.id,
        });

        activeDownloads.delete(item.id);
      });

      return;
    }

    /*
     * Mantém o nome solicitado
     * quando a resposta é realmente
     * um arquivo.
     */
    suggest({
      filename: tracked.filename,

      conflictAction: "uniquify",
    });

    return;
  }

  suggest();
});

/**
 * Monitoramento.
 */
chrome.downloads.onChanged.addListener((delta) => {
  const tracked = activeDownloads.get(delta.id);

  if (!tracked) {
    return;
  }

  if (isArchiveFilename(tracked.filename)) {
    const fn = delta.filename?.current?.toLowerCase();

    const mime = delta.mime?.current?.toLowerCase();

    const isHtml =
      Boolean(fn && (fn.endsWith(".htm") || fn.endsWith(".html"))) ||
      Boolean(mime && mime.includes("text/html"));

    if (isHtml) {
      console.warn("[7MGFC] HTML detectado durante download:", delta.id);

      chrome.downloads.cancel(delta.id, () => {
        chrome.downloads.erase({
          id: delta.id,
        });

        activeDownloads.delete(delta.id);
      });

      return;
    }
  }

  if (!delta.state) {
    return;
  }

  const currentState = delta.state.current;

  if (currentState !== "complete" && currentState !== "interrupted") {
    return;
  }

  const finalStatus = currentState === "complete" ? "completed" : "interrupted";

  chrome.downloads.search(
    {
      id: delta.id,
    },
    (items) => {
      const item = items?.[0];

      const fileSize =
        item?.fileSize && item.fileSize > 0
          ? item.fileSize
          : item?.bytesReceived || null;

      const record: HistoryRecord = {
        id: `${delta.id}-${Date.now()}`,

        filename: tracked.filename,

        url: tracked.url,

        date: Date.now(),

        size: fileSize,

        status: finalStatus,

        type: tracked.type,
      };

      chrome.storage.local.get(["history", "settings"], (storage) => {
        const max =
          (storage.settings as AppSettings | undefined)?.maxHistoryItems || 50;

        const currentHistory: HistoryRecord[] = Array.isArray(storage.history)
          ? (storage.history as HistoryRecord[])
          : [];

        const updated = [record, ...currentHistory.slice(0, max - 1)];

        chrome.storage.local.set({
          history: updated,
        });
      });

      activeDownloads.delete(delta.id);
    },
  );
});

/**
 * Comunicação com o popup.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "startDownload") {
    const { url, filename, type, conflictAction, subfolder } = message as {
      url: string;

      filename: string;

      type: string;

      conflictAction?: "uniquify" | "overwrite" | "prompt";

      subfolder?: string;
    };

    if (!url || typeof url !== "string") {
      sendResponse({
        success: false,

        error: "URL de download não informada.",
      });

      return false;
    }

    if (!filename || typeof filename !== "string") {
      sendResponse({
        success: false,

        error: "Nome do arquivo não informado.",
      });

      return false;
    }

    let targetFilename = filename;

    if (subfolder && subfolder.trim()) {
      const cleanSub = subfolder.replace(/[\\/]+$/, "").trim();

      if (cleanSub) {
        targetFilename = `${cleanSub}/${filename}`;
      }
    }

    const action = conflictAction === "overwrite" ? "overwrite" : "uniquify";

    const saveAs = conflictAction === "prompt";

    (async () => {
      try {
        let finalUrl = url;
        const isApiEndpoint =
          url.includes("/api/v1/resources/") ||
          url.includes("api.magnific.com") ||
          url.includes("api.freepik.com") ||
          url.includes("/download/file/");

        if (isApiEndpoint) {
          const headers: Record<string, string> = {
            Accept: "application/json, text/plain, */*",
          };

          const response = await fetch(url, {
            method: "GET",
            headers,
            credentials: "include",
            redirect: "follow",
          });

          const contentType = (
            response.headers.get("content-type") || ""
          ).toLowerCase();

          if (!response.ok) {
            sendResponse({
              success: false,
              error: `O servidor recusou o download (HTTP ${response.status}).`,
            });
            return;
          }

          if (contentType.includes("text/html")) {
            sendResponse({
              success: false,
              error:
                "O servidor retornou uma página HTML em vez do arquivo. Faça login ou obtenha acesso autorizado ao recurso.",
            });
            return;
          }

          if (contentType.includes("application/json")) {
            const data = await response.json();
            const candidate =
              data?.url ??
              data?.download_url ??
              data?.file ??
              data?.data?.url ??
              data?.data?.download_url ??
              data?.data?.file;

            if (
              typeof candidate !== "string" ||
              !candidate.startsWith("http")
            ) {
              sendResponse({
                success: false,
                error: "A API não forneceu uma URL de download autorizada.",
              });
              return;
            }

            try {
              const candidateUrl = new URL(candidate);
              if (!["http:", "https:"].includes(candidateUrl.protocol))
                throw new Error("invalid protocol");
              finalUrl = candidate;
            } catch {
              sendResponse({
                success: false,
                error: "A URL retornada pela API é inválida.",
              });
              return;
            }
          }
        }

        chrome.downloads.download(
          {
            url: finalUrl,
            filename: targetFilename,
            conflictAction: action,
            saveAs,
          },
      (downloadId) => {
        if (chrome.runtime.lastError || !downloadId) {
          const error =
            chrome.runtime.lastError?.message ||
            "Falha ao iniciar o download no Chrome.";

          sendResponse({
            success: false,

            error,
          });

          return;
        }

        activeDownloads.set(downloadId, {
          id: downloadId,

          url,

          filename,

          lastBytes: 0,

          lastTime: Date.now(),

          speed: 0,

          type: type || "ARQUIVO",
        });

        sendResponse({
          success: true,

          downloadId,
        });
      },
    );
      } catch (error) {
        console.error("[7MGFC] Erro ao preparar download:", error);
        sendResponse({
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Erro desconhecido durante o download.",
        });
      }
    })();

    return true;
  }

  /*
   * Progresso.
   */
  if (message.action === "getDownloadProgress") {
    const { downloadId } = message as {
      downloadId: number;
    };

    const tracked = activeDownloads.get(downloadId);

    chrome.downloads.search(
      {
        id: downloadId,
      },
      (items) => {
        const item = items?.[0];

        if (!item) {
          sendResponse({
            success: false,

            error: "Download não encontrado.",
          });

          return;
        }

        const total =
          item.totalBytes > 0
            ? item.totalBytes
            : item.fileSize > 0
              ? item.fileSize
              : 0;

        const received = item.bytesReceived || 0;

        const percent =
          total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;

        let currentSpeed = 0;

        if (tracked) {
          const now = Date.now();

          const timeDiff = (now - tracked.lastTime) / 1000;

          if (timeDiff >= 0.3) {
            const bytesDiff = received - tracked.lastBytes;

            currentSpeed = Math.max(0, Math.round(bytesDiff / timeDiff));

            tracked.speed = currentSpeed;

            tracked.lastBytes = received;

            tracked.lastTime = now;
          } else {
            currentSpeed = tracked.speed;
          }
        }

        sendResponse({
          success: true,

          data: {
            downloadId,

            receivedBytes: received,

            totalBytes: total,

            percent,

            speed: currentSpeed,

            state: item.state,

            error: item.error,
          },
        });
      },
    );

    return true;
  }

  /*
   * Cancelamento.
   */
  if (message.action === "cancelDownload") {
    const { downloadId } = message as {
      downloadId: number;
    };

    chrome.downloads.cancel(downloadId, () => {
      activeDownloads.delete(downloadId);

      sendResponse({
        success: true,
      });
    });

    return true;
  }

  return false;
});
