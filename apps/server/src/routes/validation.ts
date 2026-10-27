import { HttpError } from "../http-error.js";

export function readParam(
  params: Record<string, string | string[] | undefined>,
  field: string,
): string {
  const value = params[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new HttpError(400, "INVALID_PARAM", `缺少路径参数 ${field}`);
  }
  return value;
}

export function readBody(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_BODY", "请求体必须是 JSON 对象");
  }
  return value as Record<string, unknown>;
}

export function readString(
  source: Record<string, unknown>,
  field: string,
  options: { max?: number; label?: string } = {},
): string {
  const value = source[field];
  const label = options.label ?? field;
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_FIELD", `${label} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, "INVALID_FIELD", `${label} 不能为空`);
  }
  const max = options.max ?? 20_000;
  if (trimmed.length > max) {
    throw new HttpError(400, "INVALID_FIELD", `${label} 不能超过 ${max} 个字符`);
  }
  return trimmed;
}

export function readOptionalString(
  source: Record<string, unknown>,
  field: string,
  options: { max?: number; label?: string } = {},
): string | undefined {
  if (source[field] === undefined) return undefined;
  return readString(source, field, options);
}

export function readOptionalInteger(
  source: Record<string, unknown>,
  field: string,
  options: { min?: number; label?: string } = {},
): number | undefined {
  const value = source[field];
  if (value === undefined) return undefined;
  const label = options.label ?? field;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, "INVALID_FIELD", `${label} 必须是整数`);
  }
  const min = options.min ?? 1;
  if (value < min) {
    throw new HttpError(400, "INVALID_FIELD", `${label} 不能小于 ${min}`);
  }
  return value;
}

export function readStringArray(
  source: Record<string, unknown>,
  field: string,
  label: string,
): string[] {
  const value = source[field];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "INVALID_FIELD", `${label} 必须是字符串数组`);
  }
  return value as string[];
}
