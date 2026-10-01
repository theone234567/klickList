// Plain constants shared by the app and the Edge Function (no dependencies, keeps the web bundle small).
export const TITLE_MAX = 50; // Trade Me My Products import limit (import guide v6.15)
export const SUBTITLE_MAX = 50;
export const DESCRIPTION_MAX = 2000; // Trade Me "body" allows 2048 incl. the item details we append
export const HINT_MAX = 300;
export const MAX_AI_IMAGES = 3; // more photos = more tokens; front + back is usually enough

export const CONDITIONS = ["New", "Used", "Refurbished", "Unknown"] as const;
export const SHIPPING_SIZES = ["Small parcel", "Medium parcel", "Large parcel", "Pickup only"] as const;
export const CONFIDENCE = ["low", "medium", "high"] as const;
