import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUiPreferences } from "./ui-preferences";

describe("fetchUiPreferences", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("服务端正常返回时返回偏好", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ theme: "dark", language: "en", markdownFontSize: 16 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await fetchUiPreferences();
    expect(result).toEqual({ theme: "dark", language: "en", markdownFontSize: 16 });
  });

  it("请求失败时返回 null，不抛错", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection refused"));
    const result = await fetchUiPreferences();
    expect(result).toBeNull();
  });

  it("超时时返回 null，不阻塞调用方", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>(() => undefined),
    );
    const startedAt = Date.now();
    const result = await fetchUiPreferences(30);
    expect(result).toBeNull();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it("服务端报错（非 2xx）时返回 null", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_FIELD", message: "bad" }), { status: 400 }),
    );
    const result = await fetchUiPreferences();
    expect(result).toBeNull();
  });
});
