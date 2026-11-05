import { describe, expect, it, vi } from "vitest";
import { PreferenceFieldQueue, type PreferenceFieldName } from "./preferences-writer";

type Field = PreferenceFieldName;

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  promise: Promise<unknown>;
}

function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { resolve, reject, promise };
}

/** 排空当前微任务队列，让队列中的调度得以执行 */
const drainMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("PreferenceFieldQueue", () => {
  it("同一事件循环内的连续快速切换合并为一次请求，持久化最后一次选择", async () => {
    const written: string[] = [];
    const write = vi.fn((_field: Field, value: string) => {
      written.push(value);
      return Promise.resolve();
    });
    const queue = new PreferenceFieldQueue("theme", write);

    queue.push("dark");
    queue.push("light");
    queue.push("system");

    await drainMicrotasks();
    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(written).toEqual(["system"]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("多次顺序切换按序串行写入，最终持久化为最后一次选择", async () => {
    const written: string[] = [];
    const write = vi.fn((_field: Field, value: string) => {
      written.push(value);
      return Promise.resolve();
    });
    const queue = new PreferenceFieldQueue("theme", write);

    queue.push("dark");
    await drainMicrotasks();
    queue.push("light");
    await drainMicrotasks();
    queue.push("system");
    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));

    expect(written).toEqual(["dark", "light", "system"]);
  });

  it("写入进行中到达的新选择不会丢失，旧值完成后按最新值续写", async () => {
    const gate = deferred();
    const written: string[] = [];
    const write = vi.fn((_field: Field, value: string) => {
      written.push(value);
      return gate.promise;
    });
    const queue = new PreferenceFieldQueue("theme", write);

    queue.push("dark");
    await drainMicrotasks();
    expect(written).toEqual(["dark"]);

    // 第一次请求未返回期间，用户又切换了两次
    queue.push("light");
    queue.push("system");
    gate.resolve(undefined);

    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(written).toEqual(["dark", "system"]);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("请求失败时静默保留状态，后续操作仍可正常写入", async () => {
    const written: string[] = [];
    let fail = true;
    const write = vi.fn((_field: Field, value: string) => {
      written.push(value);
      if (fail) return Promise.reject(new Error("network down"));
      return Promise.resolve();
    });
    const queue = new PreferenceFieldQueue("theme", write);

    queue.push("dark");
    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(written).toEqual(["dark"]);

    fail = false;
    queue.push("light");
    await vi.waitFor(() => expect(queue.isBusy()).toBe(false));
    expect(written).toEqual(["dark", "light"]);
  });

  it("不同字段的队列相互独立、互不阻塞", async () => {
    const themeGate = deferred();
    const themeWrite = vi.fn((_field: Field, _value: string) => themeGate.promise);
    const languageWritten: string[] = [];
    const languageWrite = vi.fn((_field: Field, value: string) => {
      languageWritten.push(value);
      return Promise.resolve();
    });
    const themeQueue = new PreferenceFieldQueue("theme", themeWrite);
    const languageQueue = new PreferenceFieldQueue("language", languageWrite);

    themeQueue.push("dark");
    languageQueue.push("en");
    await drainMicrotasks();

    // 主题队列被挂起，语言队列不受影响
    await vi.waitFor(() => expect(languageWritten).toEqual(["en"]));
    expect(themeWrite).toHaveBeenCalledTimes(1);
    themeGate.resolve(undefined);
    await vi.waitFor(() => expect(themeQueue.isBusy()).toBe(false));
  });
});
