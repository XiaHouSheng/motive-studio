import { Router } from "express";
import type { Request, Response } from "express";
import { APP_VERSION } from "../config.js";

/** GitHub 仓库地址：跳转按钮、关于页与更新检查共用 */
export const GITHUB_REPO_URL = "https://github.com/XiaHouSheng/motive-studio";

/** 应用信息：版本展示与更新检查的数据源 */
export function createAppInfoRouter(): Router {
  const router = Router();

  router.get("/app/info", (_req: Request, res: Response) => {
    res.json({
      name: "Motive Studio",
      version: APP_VERSION,
      repoUrl: GITHUB_REPO_URL,
    });
  });

  return router;
}

interface LatestRelease {
  tagName: string;
  name: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  body: string;
}

/** releases 查询缓存：10 分钟内复用，避免每次启动都打到 GitHub API */
let releaseCache: { at: number; data: LatestRelease | null } | null = null;
const RELEASE_CACHE_TTL = 10 * 60 * 1000;

/** 最新发行版：服务端代理 GitHub API（离线/失败时返回 null，前端按「无法检查」处理） */
export function createAppReleasesRouter(): Router {
  const router = Router();

  router.get("/app/releases/latest", async (_req: Request, res: Response) => {
    if (releaseCache && Date.now() - releaseCache.at < RELEASE_CACHE_TTL) {
      res.json({ release: releaseCache.data });
      return;
    }

    let release: LatestRelease | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const apiUrl = GITHUB_REPO_URL.replace("https://github.com/", "https://api.github.com/repos/");
      const response = await fetch(`${apiUrl}/releases/latest`, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "motive-studio",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        const body = (await response.json()) as {
          tag_name?: string;
          name?: string | null;
          html_url?: string;
          published_at?: string | null;
          body?: string | null;
        };
        if (body.tag_name && body.html_url) {
          release = {
            tagName: body.tag_name,
            name: body.name ?? null,
            htmlUrl: body.html_url,
            publishedAt: body.published_at ?? null,
            body: typeof body.body === "string" ? body.body.slice(0, 4000) : "",
          };
        }
      }
    } catch {
      // 离线或 GitHub 不可达：保持 null，前端展示「检查失败」
    }

    releaseCache = { at: Date.now(), data: release };
    res.json({ release });
  });

  return router;
}
