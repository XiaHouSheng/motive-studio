export function excerpt(text: string, max = 48): string {
  const plain = text
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$]*\$/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>#]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= max) return plain;
  return `${plain.slice(0, max)}…`;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

const TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
};

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "numeric",
  day: "numeric",
};

export function formatTime(timestamp: number, locale = "zh-CN"): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const time = getFormatter(locale, TIME_OPTIONS).format(date);
  if (sameDay) return time;
  return `${getFormatter(locale, DATE_OPTIONS).format(date)} ${time}`;
}

export function formatDay(timestamp: number, locale = "zh-CN", todayLabel = "今天"): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return todayLabel;
  return getFormatter(locale, DATE_OPTIONS).format(date);
}
