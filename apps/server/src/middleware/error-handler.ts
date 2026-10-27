import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../http-error.js";

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof HttpError) {
    res.status(error.status).json({ code: error.code, message: error.message });
    return;
  }

  const candidate = error as { type?: string; status?: number } | null;
  if (candidate?.type === "entity.parse.failed") {
    res.status(400).json({ code: "INVALID_JSON", message: "请求体不是有效的 JSON" });
    return;
  }
  if (candidate?.type === "entity.too.large") {
    res.status(413).json({ code: "PAYLOAD_TOO_LARGE", message: "请求体过大" });
    return;
  }

  const message = error instanceof Error ? error.message : "未知错误";
  console.error("[server] 未处理异常：", message);
  res.status(500).json({ code: "INTERNAL_ERROR", message: "本地服务发生错误" });
}
