// ---- Platform ----
export type Platform = 'threads' | 'x';

// ---- Metric handling ----
export interface MetricValue {
  raw: string;           // The displayed text (e.g. "1.2K", "123", "")
  parsed: number | null; // Parsed numeric value, null if unparsable
}

// ---- Raw post from DOM ----
export interface RawPost {
  postId: string;
  datetime: string | null;
  text: string | null;          // null for image-only posts
  likes: MetricValue;
  replies: MetricValue;
  views: MetricValue;
  hasMedia: boolean;
  postUrl: string;
  // X-specific (undefined for Threads)
  retweets?: MetricValue;
  bookmarks?: MetricValue;
}

// ---- GAS payload ----
export interface GasPayload {
  posts: GasPost[];
  account: string;
  username: string;
  sessionId: string;
  batchId: string;
  platform: Platform;
}

// Posts formatted for GAS transmission (MetricValue flattened to strings)
export interface GasPost {
  postId: string;
  datetime: string;
  text: string;
  likes: string;
  replies: string;
  views: string;
  hasImage: string;       // "あり" / "なし"
  postUrl: string;
  // X-specific
  retweets?: string;
  bookmarks?: string;
}

// ---- GAS response ----
export interface GasResponse {
  success: boolean;
  message: string;
  count: number;
}

// ---- Collection state ----
export interface CollectionState {
  isCollecting: boolean;
  platform: Platform | null;
  pendingCount: number;
  sentCount: number;
  seenCount: number;
  filteredCount: number;
  username: string | null;
}

// ---- Messages ----
export type MessageType =
  | 'START_COLLECTING'
  | 'STOP_COLLECTING'
  | 'GET_STATUS'
  | 'SEND_TO_GAS'
  | 'UPDATE_COUNT'
  | 'SEND_RESULT'
  | 'ERROR'
  | 'HEALTH_CHECK_FAILED'
  | 'HEALTH_WARNING';

// ---- Health check result ----
export interface HealthCheckResult {
  ok: boolean;
  errors: string[];
  samplePost: RawPost | null;
}
