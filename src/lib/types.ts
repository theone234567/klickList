export interface Crop { x: number; y: number; w: number; h: number }

export interface Batch { id: string; name: string; created_at: string }

export type ItemStatus = "draft" | "ready" | "listed" | "sold";
export type AiStatus = "pending" | "queued" | "batched" | "processing" | "done" | "failed" | "skipped";

export interface Photo {
  id: string;
  item_id: string;
  storage_path: string;
  position: number;
  width: number | null;
  height: number | null;
  rotation: 0 | 90 | 180 | 270;
  crop: Crop | null;
  bg_status: "none" | "done" | "failed";
  use_white: boolean;
}

export interface Item {
  id: string;
  batch_id: string;
  position: number;
  status: ItemStatus;
  ai_status: AiStatus;
  ai_error: string | null;
  ai_updated_at: string | null;
  hint: string;
  barcode: string;
  title: string;
  subtitle: string;
  description: string;
  category_path: string;
  condition: "New" | "Used" | "Refurbished" | "Unknown";
  attributes: { name: string; value: string }[];
  start_price: number | null;
  buy_now_price: number | null;
  price_confidence: "low" | "medium" | "high" | null;
  price_reasoning: string;
  shipping_size: string;
  weight_kg: number | null;
  needs_check: string[];
  tm_category: string;
  price_check: PriceCheck | { ideas: unknown[] } | null; // read with ideasOf()
  price_checked_at: string | null;
  exported_at: string | null;
  ai_provider: "claude" | "gemini" | null;
  photos: Photo[];
}

export interface PriceCheck {
  found: boolean;
  low: number | null;
  high: number | null;
  typical: number | null;
  start: number;
  buy_now: number | null;
  summary: string;
  sources: { url: string; title: string }[];
}

export interface Prefs {
  aiProvider: "claude" | "gemini";
  aiBackup: boolean; // use the other AI if the chosen one fails / runs out
  economy: boolean; // Claude Batch API: 50% off, results within minutes-hours
  whiteBg: "all" | "main" | "off";
  autoPriceCheck: boolean;
  priceCheckMin: number;
  tm: TmOptions; // Trade Me listing options written into every upload file
}

/** Trade Me listing options. They override the same columns from the template. */
export interface TmOptions {
  shipping: "free" | "custom";
  shippingText: string; // e.g. "4.00=Tracked Post;7.25=Courier" or a Trade Me shipping template name
  pickup: "no" | "allowed" | "must";
  days: number; // auction length
  bank: boolean;
  card: boolean; // Pay Now / credit card
  cash: boolean;
}

export const DEFAULT_TM_OPTIONS: TmOptions = {
  shipping: "free", shippingText: "", pickup: "no", days: 7, bank: true, card: false, cash: false,
};

export interface TmTemplate { headers: string[]; defaults: string[]; loadedAt: string; preamble?: string[][] }

export interface Settings {
  prefs: Prefs;
  tm_template: TmTemplate | null;
  category_map: Record<string, string>;
}

export const DEFAULT_PREFS: Prefs = {
  aiProvider: "claude", aiBackup: true, economy: true, whiteBg: "all", autoPriceCheck: true, priceCheckMin: 5,
  tm: DEFAULT_TM_OPTIONS,
};
