/**
 * 7MGFC — Utilitários de processamento local
 *
 * Responsabilidades:
 * - validar URLs
 * - identificar Magnific/Freepik
 * - interpretar URLs oficiais
 * - identificar recursos Premium
 * - interpretar URLs CDN já assinadas
 *
 * A extensão não gera nem altera tokens de autenticação.
 */

import type { MagnificCdnDetails } from "./types";

export interface ResolvedResource {
  isSupportedPlatform: boolean;

  platform: "magnific" | "freepik";

  resourceId: string;

  tier: "premium" | "free";

  category: string;

  slug: string;

  cleanFilename: string;

  fileType: string;

  downloadUrl: string;

  alternativeDownloadUrls: string[];

  isDirectCdnUrl?: boolean;

  cdnDetails?: MagnificCdnDetails;

  authorId?: string;

  formatCode?: string;

  clusterId?: string;

  pageUrl?: string;

  isProtected: boolean;

  statusMessage: string;
}

function isMagnificHost(host: string): boolean {
  return host === "magnific.com" || host.endsWith(".magnific.com");
}

function isFreepikHost(host: string): boolean {
  return host === "freepik.com" || host.endsWith(".freepik.com");
}

function isSupportedHost(host: string): boolean {
  return isMagnificHost(host) || isFreepikHost(host);
}

export function isValidUrl(input: string): boolean {
  try {
    const parsed = new URL(input.trim());

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "desconhecido";
  }
}

/**
 * Identifica o tipo de arquivo
 * pela extensão.
 */
function getFileTypeFromExtension(ext: string): {
  fileType: string;
  category: string;
} {
  const normalized = ext.toLowerCase();

  switch (normalized) {
    case "psd":
      return {
        fileType: "PSD",
        category: "psd",
      };

    case "ai":
    case "eps":
      return {
        fileType: normalized.toUpperCase(),
        category: "vector",
      };

    case "jpg":
    case "jpeg":
    case "png":
    case "webp":
      return {
        fileType: normalized.toUpperCase(),
        category: "photo",
      };

    case "mp4":
    case "mov":
      return {
        fileType: normalized.toUpperCase(),
        category: "video",
      };

    default:
      return {
        fileType: normalized ? normalized.toUpperCase() : "ARQUIVO",
        category: "psd",
      };
  }
}

/**
 * Parser de URLs Magnific/Freepik.
 *
 * Uma URL de página Premium não é considerada
 * automaticamente um arquivo baixável.
 *
 * Uma URL CDN só é considerada disponível
 * quando possui a assinatura fornecida pela
 * própria plataforma e ela ainda está válida.
 */
export function parseMagnificOrFreepik(
  rawUrl: string,
): ResolvedResource | null {
  try {
    const input = rawUrl.trim();

    const parsed = new URL(input);

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

    if (!isSupportedHost(host)) {
      return null;
    }

    const platform: "magnific" | "freepik" = isMagnificHost(host)
      ? "magnific"
      : "freepik";

    const pathname = parsed.pathname;

    const lowerPath = pathname.toLowerCase();

    /*
     * Detecta Premium pela própria URL.
     */
    let tier: "premium" | "free" = lowerPath.includes("premium")
      ? "premium"
      : "free";

    let category = "psd";

    let slug = "";

    let resourceId = "";

    let cdnDetails: MagnificCdnDetails | undefined;

    let authorId: string | undefined;

    let formatCode: string | undefined;

    let clusterId: string | undefined;

    let ext = "zip";

    let fileType = "PSD";

    /*
     * Identificação inicial pela URL.
     */
    if (lowerPath.includes("vector") || lowerPath.includes("vetor")) {
      category = "vector";

      fileType = "VETOR";

      ext = "zip";
    } else if (lowerPath.includes("photo") || lowerPath.includes("foto")) {
      category = "photo";

      fileType = "FOTO";

      ext = "jpg";
    } else if (lowerPath.includes("video")) {
      category = "video";

      fileType = "VÍDEO";

      ext = "mp4";
    } else if (lowerPath.includes("icon") || lowerPath.includes("icone")) {
      category = "icon";

      fileType = "ÍCONE";

      ext = "zip";
    } else if (lowerPath.includes("psd")) {
      category = "psd";

      fileType = "PSD";

      ext = "zip";
    }

    /*
     * CDN direto.
     *
     * Exemplo:
     *
     * /d/419723865/795323/2/1323/arquivo.zip
     *
     * A assinatura é apenas lida.
     * Nunca é criada ou modificada.
     */
    const cdnMatch = pathname.match(
      /^\/d\/(\d+)(?:\/(\d+))?(?:\/(\d+))?(?:\/(\d+))?\/([a-zA-Z0-9_.-]+)$/i,
    );

    if (cdnMatch) {
      resourceId = cdnMatch[1];

      authorId = cdnMatch[2];

      formatCode = cdnMatch[3];

      clusterId = cdnMatch[4];

      const rawFile = cdnMatch[5];

      const lastDot = rawFile.lastIndexOf(".");

      if (lastDot > 0) {
        slug = rawFile.substring(0, lastDot);

        ext = rawFile.substring(lastDot + 1).toLowerCase();
      } else {
        slug = rawFile;

        ext = "zip";
      }

      const typeInfo = getFileTypeFromExtension(ext);

      category = typeInfo.category;

      fileType = typeInfo.fileType;

      /*
       * URLs /d/ são normalmente recursos
       * distribuídos pelo CDN.
       */
      tier = "premium";

      const tokenParam = parsed.searchParams.get("token") || "";

      let tokenExpiresAt: number | undefined;

      let isExpired = false;

      let hmac: string | undefined;

      if (tokenParam) {
        const expMatch = tokenParam.match(/(?:^|[&;,])exp=(\d+)/);

        const hmacMatch = tokenParam.match(/(?:^|[&;,])hmac=([a-f0-9]+)/i);

        if (expMatch) {
          tokenExpiresAt = Number(expMatch[1]);

          if (Number.isFinite(tokenExpiresAt)) {
            isExpired = Math.floor(Date.now() / 1000) > tokenExpiresAt;
          }
        }

        if (hmacMatch) {
          hmac = hmacMatch[1];
        }
      }

      const cdnNodeMatch = host.match(/downloadscdn(\d+)/i);

      const cdnNodeNumber = cdnNodeMatch ? Number(cdnNodeMatch[1]) : undefined;

      const hasSignature = Boolean(tokenParam && hmac && tokenExpiresAt);

      cdnDetails = {
        cdnHost: host,

        cdnNodeNumber,

        resourceId,

        authorId,

        formatCode,

        clusterId,

        slug,

        fileExt: ext,

        token: tokenParam || undefined,

        tokenExpiresAt,

        isExpired,

        hmac,
      };

      /*
       * CDN sem assinatura válida.
       */
      if (!hasSignature) {
        return {
          isSupportedPlatform: true,

          platform,

          resourceId,

          tier,

          category,

          slug,

          cleanFilename: `${slug}_${resourceId}.${ext}`,

          fileType,

          downloadUrl: input,

          alternativeDownloadUrls: [],

          isDirectCdnUrl: true,

          cdnDetails,

          authorId,

          formatCode,

          clusterId,

          pageUrl: undefined,

          isProtected: true,

          statusMessage:
            "URL CDN oficial sem assinatura válida fornecida pela plataforma.",
        };
      }

      /*
       * CDN com assinatura expirada.
       */
      if (isExpired) {
        return {
          isSupportedPlatform: true,

          platform,

          resourceId,

          tier,

          category,

          slug,

          cleanFilename: `${slug}_${resourceId}.${ext}`,

          fileType,

          downloadUrl: input,

          alternativeDownloadUrls: [],

          isDirectCdnUrl: true,

          cdnDetails,

          authorId,

          formatCode,

          clusterId,

          pageUrl: undefined,

          isProtected: true,

          statusMessage:
            "A assinatura CDN oficial expirou. Abra o recurso novamente na plataforma para obter uma nova URL autorizada.",
        };
      }

      /*
       * CDN com assinatura fornecida pela
       * própria plataforma e ainda válida.
       */
      return {
        isSupportedPlatform: true,

        platform,

        resourceId,

        tier,

        category,

        slug,

        cleanFilename: `${slug}_${resourceId}.${ext}`,

        fileType,

        downloadUrl: input,

        alternativeDownloadUrls: [],

        isDirectCdnUrl: true,

        cdnDetails,

        authorId,

        formatCode,

        clusterId,

        pageUrl: undefined,

        isProtected: false,

        statusMessage: "URL CDN oficial assinada e ainda válida.",
      };
    }

    /*
     * Página normal Magnific/Freepik.
     */
    const segments = pathname.split("/").filter(Boolean);

    const lastSegment = segments[segments.length - 1] || "";

    const match = lastSegment.match(
      /^([a-zA-Z0-9_\-.]+?)_(\d{5,14})(?:\.html?)?$/i,
    );

    if (match) {
      slug = match[1];

      resourceId = match[2];
    } else {
      const fallbackId = pathname.match(/(?:_|\/|^)(\d{5,14})(?:\.html?|\/|$)/);

      if (fallbackId) {
        resourceId = fallbackId[1];

        slug =
          lastSegment
            .replace(/\.html?$/i, "")
            .replace(/\.zip$/i, "")
            .replace(/_\d+$/, "") || `recurso_${resourceId}`;
      }
    }

    if (!resourceId) {
      return null;
    }

    const cleanSlug = slug
      .replace(/\.zip$/i, "")
      .replace(/\.htm$/i, "")
      .replace(/\.html$/i, "");

    const cleanFilename = cleanSlug
      ? `${cleanSlug}_${resourceId}.${ext}`
      : `magnific_${resourceId}.${ext}`;

    /*
     * Endpoint oficial.
     *
     * A plataforma continua responsável
     * por validar a autorização.
     */
    const primaryDownloadUrl = `https://www.magnific.com/api/v1/resources/${resourceId}/download`;

    const reconstructedPageUrl = parsed.href;

    const alternativeDownloadUrls = [
      primaryDownloadUrl,

      `https://www.freepik.com/api/v1/resources/${resourceId}/download`,

      `https://api.magnific.com/v1/resources/${resourceId}/download`,

      `https://www.magnific.com/download/file/${resourceId}`,
    ];

    /*
     * Premium.
     */
    if (tier === "premium") {
      return {
        isSupportedPlatform: true,

        platform,

        resourceId,

        tier,

        category,

        slug: cleanSlug,

        cleanFilename,

        fileType,

        downloadUrl: primaryDownloadUrl,

        alternativeDownloadUrls,

        isDirectCdnUrl: false,

        cdnDetails: undefined,

        authorId,

        formatCode,

        clusterId,

        pageUrl: reconstructedPageUrl,

        isProtected: true,

        statusMessage:
          "Recurso Premium identificado. O download depende da autorização da conta na plataforma.",
      };
    }

    /*
     * Recurso não-Premium.
     */
    return {
      isSupportedPlatform: true,

      platform,

      resourceId,

      tier,

      category,

      slug: cleanSlug,

      cleanFilename,

      fileType,

      downloadUrl: primaryDownloadUrl,

      alternativeDownloadUrls,

      isDirectCdnUrl: false,

      cdnDetails: undefined,

      authorId,

      formatCode,

      clusterId,

      pageUrl: reconstructedPageUrl,

      isProtected: false,

      statusMessage: "Recurso oficial identificado.",
    };
  } catch {
    return null;
  }
}

export function extractFilename(url: string): string {
  const resolved = parseMagnificOrFreepik(url);

  if (resolved) {
    return resolved.cleanFilename;
  }

  try {
    const parsed = new URL(url);

    const segments = parsed.pathname.split("/").filter(Boolean);

    const last = segments[segments.length - 1];

    if (last) {
      const decoded = decodeURIComponent(last);

      const clean = decoded.split("?")[0].split("#")[0];

      if (clean.includes(".")) {
        return clean;
      }

      return `${clean}.zip`;
    }

    return "arquivo.zip";
  } catch {
    return "arquivo.zip";
  }
}

export function detectFileType(filename: string): string {
  const clean = filename.split("?")[0].split("#")[0].toLowerCase();

  const ext = clean.split(".").pop() || "";

  const map: Record<string, string> = {
    zip: "ZIP",
    rar: "RAR",
    "7z": "7Z",
    tar: "TAR",
    gz: "GZIP",

    psd: "PSD",
    ai: "AI",
    eps: "EPS",

    pdf: "PDF",

    png: "PNG",
    jpg: "JPG",
    jpeg: "JPEG",
    webp: "WEBP",
    svg: "SVG",

    mp4: "MP4",
    mp3: "MP3",
    wav: "WAV",

    doc: "DOC",
    docx: "DOCX",
    txt: "TXT",
  };

  return map[ext] || (ext ? ext.toUpperCase() : "ARQUIVO");
}

export function isProtectedResource(url: string): {
  isProtected: boolean;
  reason?: string;
} {
  const resolved = parseMagnificOrFreepik(url);

  if (resolved) {
    return {
      isProtected: resolved.isProtected,

      reason: resolved.statusMessage,
    };
  }

  const lower = url.toLowerCase();

  if (
    lower.endsWith("/login") ||
    lower.endsWith("/signin") ||
    lower.endsWith("/checkout")
  ) {
    return {
      isProtected: true,

      reason: "Esta URL aponta para uma página de autenticação.",
    };
  }

  return {
    isProtected: false,
  };
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || bytes <= 0) {
    return "—";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];

  const k = 1024;

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  const val = bytes / Math.pow(k, i);

  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond <= 0) {
    return "0 KB/s";
  }

  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);

  const pad = (n: number) => n.toString().padStart(2, "0");

  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}
