export function cleanText(value = "") {
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleCase(value = "") {
  const acronyms = new Set(["ai", "api", "nasa", "nft", "ml", "vr", "ar"]);
  return cleanText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (acronyms.has(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function slugify(value = "") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "episode";
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
