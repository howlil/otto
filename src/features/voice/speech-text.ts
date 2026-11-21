const FENCED_CODE_BLOCK = /```([^\r\n`]*)\r?\n([\s\S]*?)```|~~~([^\r\n~]*)\r?\n([\s\S]*?)~~~/g;
const INLINE_CODE = /`([^`\r\n]+)`/g;
const MARKDOWN_LINK = /\[([^\]]+)\]\([^)]+\)/g;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\([^)]+\)/g;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_MARKER = /^\s{0,3}>\s?/gm;
const LIST_MARKER = /^\s*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/gm;
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/gm;
const EMPHASIS_MARKERS = /(\*\*|__|\*|_|~~)/g;
const DISPLAY_MATH = /\$\$([\s\S]*?)\$\$/g;
const INLINE_MATH = /\$([^$\r\n]+)\$/g;

const INDONESIAN_STOPWORDS = new Set([
  "yang",
  "dan",
  "di",
  "ini",
  "itu",
  "untuk",
  "dengan",
  "adalah",
  "dari",
  "dalam",
  "tidak",
  "bisa",
  "akan",
  "atau",
  "pada",
  "juga",
  "karena",
  "sebagai",
  "kita",
  "kamu",
  "saya",
  "anda",
  "fungsi",
  "contoh",
]);

export function detectSpeechLocale(
  text: string,
  fallback: "auto" | "id" | "en" = "auto",
): "id" | "en" {
  if (fallback === "id" || fallback === "en") return fallback;
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let idHits = 0;
  for (const word of words) {
    if (INDONESIAN_STOPWORDS.has(word)) idHits += 1;
  }
  return idHits >= 2 ? "id" : "en";
}

function summarizeCodeFence(rawLang: string, locale: "id" | "en"): string {
  const lang =
    rawLang
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z0-9+#.-]/g, "") ?? "";
  if (locale === "id") {
    return lang ? ` Contoh kode ${lang}. ` : " Contoh kode. ";
  }
  return lang ? ` ${lang} code example. ` : " Code example. ";
}

export function cleanMarkdownForSpeech(
  markdown: string,
  preferredLanguage: "auto" | "id" | "en" = "auto",
): string {
  if (!markdown?.trim()) return "";
  const locale = detectSpeechLocale(markdown, preferredLanguage);
  const replacedFences = markdown.replace(
    FENCED_CODE_BLOCK,
    (_match, langA: string | undefined, _codeA, langB: string | undefined) =>
      summarizeCodeFence(langA ?? langB ?? "", locale),
  );
  const cleaned = replacedFences
    .replace(DISPLAY_MATH, " $1 ")
    .replace(INLINE_MATH, " $1 ")
    .replace(MARKDOWN_IMAGE, " $1 ")
    .replace(MARKDOWN_LINK, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(TABLE_DIVIDER, " ")
    .replace(HEADING_MARKER, "")
    .replace(BLOCKQUOTE_MARKER, "")
    .replace(LIST_MARKER, "")
    .replace(EMPHASIS_MARKERS, "")
    .replace(/\|/g, ", ")
    .replace(/\r?\n+/g, ". ")
    .replace(/\s*\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}
