/**
 * 版本比较：兼容本项目多种 tag 风格（v0.4.0b2 / v0.4.0-beta.2 / desktop-v0.4.0）。
 * 规则：主版本数字大者新；数字相同时正式版 > 预发布；同为 beta 时编号大者新。
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
  // 数字版本相同：正式版 > 预发布；同为预发布时比较编号
  if (latest.preLabel === null) return current.preLabel !== null;
  if (current.preLabel === null) return false;
  return latest.preNumber > current.preNumber;
}
