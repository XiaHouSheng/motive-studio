import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startApp(dbPath: string): Promise<RunningApp> {
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未获得端口");

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      (app.locals.db as DatabaseSync).close();
    },
  };
}

function decodeFilename(disposition: string): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (!encoded) return "";
  return decodeURIComponent(encoded);
}

describe("题目详解导出", () => {
  let dir: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-export-"));
    running = await startApp(path.join(dir, "motive.db"));
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("单题导出返回 markdown 附件，详解在分步题解之前", async () => {
    const response = await fetch(`${running.baseUrl}/api/exports/questions/q-quad`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");

    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(decodeFilename(disposition)).toMatch(/^题目详解-.+\.md$/);

    const text = await response.text();
    expect(text).toContain("# 题目详解");
    expect(text).toContain("题组：函数与导数");
    expect(text).toContain("已知函数 $f(x)=x^{2}-6x+5$");
    expect(text).toContain("以配方为起点，结合区间端点比较");
    expect(text).toContain("## 分步题解");
    expect(text).toContain("第 1 步：配方并读出顶点");
    expect(text.indexOf("## 题目详解")).toBeLessThan(text.indexOf("## 分步题解"));
  });

  it("无详解与无步骤的题目输出占位说明", async () => {
    const response = await fetch(`${running.baseUrl}/api/exports/questions/q-limit`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("_暂无已完成的题目详解。_");
    expect(text).toContain("_尚未生成分步题解。_");
  });

  it("题组导出包含组内每道题目", async () => {
    const response = await fetch(`${running.baseUrl}/api/exports/groups/g-math`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(decodeFilename(response.headers.get("content-disposition") ?? "")).toBe(
      "题组详解-函数与导数.md",
    );

    const text = await response.text();
    expect(text).toContain("# 函数与导数");
    expect(text).toContain("共 2 道题目");
    expect(text).toContain("## 第 1 题");
    expect(text).toContain("## 第 2 题");
    expect(text).toContain("已知函数 $f(x)=x^{2}-6x+5$");
    expect(text).toContain("求曲线 $y=x^{3}-3x$ 在点 $(1,-2)$ 处的切线方程。");
    expect(text.indexOf("## 第 1 题")).toBeLessThan(text.indexOf("## 第 2 题"));
  });

  it("题目或题组不存在时返回 404", async () => {
    const question = await fetch(`${running.baseUrl}/api/exports/questions/q-missing`);
    expect(question.status).toBe(404);
    expect((await question.json()).code).toBe("NOT_FOUND");

    const group = await fetch(`${running.baseUrl}/api/exports/groups/g-missing`);
    expect(group.status).toBe(404);
  });
});
