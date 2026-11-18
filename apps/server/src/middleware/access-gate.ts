import type { NextFunction, Request, Response } from "express";
import { renderGatePage } from "../access/gate-page.js";
import { isLocalRequest } from "../routes/loopback.js";
import type { RemoteAccessStore } from "../services/remote-access-store.js";

export const ACCESS_COOKIE = "motive_token";
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
/** 同源验证失败限速：窗口内达到上限后拒绝该来源继续尝试 */
const FAILURE_LIMIT = 15;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

interface FailureBucket {
  count: number;
  resetAt: number;
}

/** 提取访问密钥：Cookie → X-Access-Token 头 → ?t= 查询参数（镜像 mobile 的 extractToken 通道思路） */
export function extractAccessToken(req: Request): string {
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(";")) {
      const [name, ...rest] = part.trim().split("=");
      if (name === ACCESS_COOKIE && rest.length > 0) {
        const value = rest.join("=");
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      }
    }
  }
  const headerToken = req.header("x-access-token");
  if (headerToken?.trim()) return headerToken.trim();
  const query = req.query.t;
  return typeof query === "string" ? query : "";
}

/**
 * 请求是否经过反代/隧道：Caddy 反代必带 X-Forwarded-For。
 * 本机直连伪造该头只会让自己被判定为远程，无法借此绕过门卫；
 * 因此「带该头 → 远程；无该头且来自回环 → 本机豁免；其余 → 远程」是安全的分类。
 */

/** 限速按真实来源统计：优先取 X-Forwarded-For 首跳 */
function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** 仅浏览器文档导航会带 text/html；fetch 默认 Accept 为通配类型，避免误判 */
function wantsHtml(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return (req.headers.accept ?? "").includes("text/html");
}

function setAccessCookie(req: Request, res: Response, token: string): void {
  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${ACCESS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`,
  );
}

/**
 * 远程接入门卫：门卫激活（enabled 且已生成密钥）后，非本机来源的请求
 * 必须持有效访问密钥；本机回环请求（Electron 桌面壳、桌面本机使用）豁免。
 * /api/health、/m、/api/mobile/* 有各自的健康检查或配对凭证机制，予以豁免。
 */
export function createAccessGate(store: RemoteAccessStore) {
  const failures = new Map<string, FailureBucket>();

  function registerFailure(key: string): void {
    const now = Date.now();
    const bucket = failures.get(key);
    if (!bucket || now > bucket.resetAt) {
      failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
      return;
    }
    bucket.count += 1;
  }

  function isRateLimited(key: string): boolean {
    const bucket = failures.get(key);
    if (!bucket) return false;
    if (Date.now() > bucket.resetAt) {
      failures.delete(key);
      return false;
    }
    return bucket.count >= FAILURE_LIMIT;
  }

  /** 惰性清理过期桶，避免长期运行时缓慢膨胀 */
  function pruneFailures(now: number): void {
    if (failures.size < 64) return;
    for (const [key, bucket] of failures) {
      if (now > bucket.resetAt) failures.delete(key);
    }
  }

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const config = store.getConfig();
      if (!config.enabled) {
        next();
        return;
      }
      const token = await store.getToken();
      if (!token) {
        // 已启用但尚未生成密钥：先放行，由设置面板引导生成
        next();
        return;
      }

      const path = req.path;
      // 各自带健康检查或配对凭证机制的路径豁免
      if (req.method === "GET" && path === "/api/health") {
        next();
        return;
      }
      if (path === "/m" || path.startsWith("/api/mobile/")) {
        next();
        return;
      }
      // 本机请求（回环且未经反代）豁免：桌面端日常使用不受影响
      if (isLocalRequest(req)) {
        next();
        return;
      }

      const key = clientKey(req);
      pruneFailures(Date.now());

      // 绑定端点：校验密钥并种 Cookie
      if (req.method === "POST" && path === "/api/access/verify") {
        if (isRateLimited(key)) {
          res.status(429).json({ code: "RATE_LIMITED", message: "尝试过于频繁，请稍后再试" });
          return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const candidate = typeof body?.token === "string" ? body.token : "";
        if (await store.verify(candidate)) {
          failures.delete(key);
          setAccessCookie(req, res, token);
          res.json({ ok: true });
          return;
        }
        registerFailure(key);
        res.status(403).json({ code: "UNAUTHORIZED", message: "访问密钥不正确" });
        return;
      }

      const candidate = extractAccessToken(req);
      if (await store.verify(candidate)) {
        // 经 ?t= 进入的文档请求：种 Cookie 并去掉查询参数后重定向，避免密钥留在地址栏与历史记录
        const viaQuery = typeof req.query.t === "string" && req.query.t !== "";
        if (viaQuery && wantsHtml(req)) {
          setAccessCookie(req, res, token);
          res.redirect(303, req.path);
          return;
        }
        next();
        return;
      }

      if (candidate) {
        // 携带了密钥但无效：计入限速
        registerFailure(key);
      }
      if (isRateLimited(key)) {
        res.status(429).json({ code: "RATE_LIMITED", message: "尝试过于频繁，请稍后再试" });
        return;
      }
      if (wantsHtml(req)) {
        res.status(403).type("html").send(renderGatePage());
        return;
      }
      res.status(403).json({ code: "UNAUTHORIZED", message: "需要访问密钥，请先在桌面端获取" });
    } catch (error) {
      next(error);
    }
  };
}
