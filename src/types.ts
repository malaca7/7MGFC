export type AppState =
  | "idle"
  | "processing"
  | "identified"
  | "preparing"
  | "downloading"
  | "completed"
  | "error";

export type ResourceStatus = "available" | "protected" | "unavailable";

export interface MagnificCdnDetails {
  cdnHost: string;
  cdnNodeNumber?: number;
  resourceId: string;
  authorId?: string;
  formatCode?: string;
  clusterId?: string;
  slug: string;
  fileExt: string;
  token?: string;
  tokenExpiresAt?: number;
  isExpired?: boolean;
  hmac?: string;
}

export interface ExtractedAssetData {
  mainImageDataUrl?: string;
  previewImageUrl?: string;
  activeCdnUrl?: string;
  pageTitle?: string;
  author?: string;
  tags?: string[];
  dimensions?: string;
  isPremiumPage?: boolean;
}

export interface ResourceDetails {
  url: string;
  originalUrl?: string;
  domain: string;
  filename: string;
  size: number | null;
  type: string;
  status: ResourceStatus;
  statusMessage: string;
  isProtected: boolean;
  platform?: "magnific" | "freepik" | "generic";
  resourceId?: string;
  category?: string;
  slug?: string;
  isPremium?: boolean;
  isDirectCdnUrl?: boolean;
  cdnDetails?: MagnificCdnDetails;
  pageUrl?: string;
  previewImageUrl?: string;
  author?: string;
  pageTitle?: string;
  tokenInfo?: {
    token?: string;
    expiresAt?: number;
    isExpired?: boolean;
    hmac?: string;
  };
  alternativeDownloadUrls?: string[];
}

export interface DownloadProgress {
  downloadId: number;
  receivedBytes: number;
  totalBytes: number;
  percent: number;
  speed: number;
  state: "in_progress" | "interrupted" | "complete";
  error?: string;
}

export interface HistoryRecord {
  id: string;
  filename: string;
  url: string;
  date: number;
  size: number | null;
  status: "completed" | "interrupted" | "error";
  type: string;
}

export interface QueueItem {
  id: string;
  url: string;
  filename: string;
  addedAt: number;
}

export interface AppSettings {
  conflictAction: "uniquify" | "overwrite" | "prompt";
  autoDownload: boolean;
  subfolder: string;
  notifications: boolean;
  maxHistoryItems: number;
  magnificApiKey?: string;
  bypassPremium?: boolean;
}
