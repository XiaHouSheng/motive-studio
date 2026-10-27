import type { Request } from "express";

/** 仅允许本机回环访问的敏感接口 */
export function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
