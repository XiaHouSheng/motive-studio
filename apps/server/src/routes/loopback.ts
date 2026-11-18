import type { Request } from "express";

/** 仅允许本机回环访问的敏感接口 */
export function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/**
 * 请求是否经过反代/隧道：Caddy 反代必带 X-Forwarded-For。
 * 隧道转发的请求在本机看来同样来自回环（frpc 本机回环转发），
 * 因此「是否本机」必须同时排除该头——伪造它只会让自己被判定为远程，无法借此绕过。
 */
export function isForwardedRequest(req: Request): boolean {
  return Boolean(req.headers["x-forwarded-for"]);
}

/** 真正的本机请求：回环直连且未经反代/隧道（桌面端日常使用） */
export function isLocalRequest(req: Request): boolean {
  return !isForwardedRequest(req) && isLoopbackRequest(req);
}
