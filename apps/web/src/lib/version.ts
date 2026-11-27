/**
 * 版本比较：兼容本项目多种 tag 风格（v0.4.0b2 / v0.4.0-beta.2 / desktop-v0.4.0）。
 * 规则：主版本数字大者新；数字相同时仅「同为 beta 且编号更大」视为更新——
 * beta（如 0.4.0b1）表示基于 0.4.0 的后续构建，已包含同号正式版内容，
 * 因此 0.4.0 正式版对 0.4.0b1 用户不算更新，需等 0.5.0 等更高数字版本。
 * 无法解析的输入一律视为不更新。
 */
function normalizeVersion(raw: string): string {
  return raw
    .trim()
    // 去掉 tag 前缀（v / desktop-v 等任意非数字前缀）
    .replace(/^[^\d]*/, "")
    .replace(/(\d)\s*b\s*(\d+)/i, "$1-beta.$2");
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  preLabel: string | null;
  preNumber: number;
}

function parseVersion(raw: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)\.?(\d+))?$/.exec(normalizeVersion(raw));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    preLabel: match[4] ?? null,
    preNumber: match[5] ? Number(match[5]) : 0,
  };
}

export function isNewerVersion(latestRaw: string, currentRaw: string): boolean {
  const latest = parseVersion(latestRaw);
  const current = parseVersion(currentRaw);
  if (!latest || !current) return false;

  const numberOf = (v: ParsedVersion) => v.major * 1_000_000 + v.minor * 1_000 + v.patch;
  if (numberOf(latest) !== numberOf(current)) {
    return numberOf(latest) > numberOf(current);
  }
  // 数字版本相同：beta 是基于该正式版的后续构建，视为已是最新；
  // 仅同为 beta 时比较构建编号（如 0.4.0b2 > 0.4.0b1）
  if (latest.preLabel === null || current.preLabel === null) return false;
  return latest.preNumber > current.preNumber;
}

/** 是否为预发布版本（beta 等）：自动更新提醒默认跳过这类发行版 */
export function isPrereleaseVersion(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed !== null && parsed.preLabel !== null;
}

/**
 * 版本比较键：把同一版本的不同 tag 风格（v0.4.0b2 / desktop-v0.4.0-beta.2）
 * 归一化到相同字符串，用于「跳过此版本」的持久化匹配。
 */
export function versionKey(raw: string): string | null {
  const parsed = parseVersion(raw);
  if (!parsed) return null;
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.preLabel ? `${base}-${parsed.preLabel}.${parsed.preNumber}` : base;
}
