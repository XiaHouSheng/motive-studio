import { describe, expect, it } from "vitest";
import { createSseParser, encodeSseEvent } from "@motive/shared";

function parseAll(chunks: string[]): string[] {
  const parser = createSseParser();
  const events: string[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  events.push(...parser.flush());
  return events;
}

describe("createSseParser", () => {
  it("按 1 个字符切分仍能正确解析事件", () => {
    const text = 'data: {"a":1}\n\ndata: [DONE]\n\n';
    const events = parseAll(text.split(""));
    expect(events).toEqual(['{"a":1}', "[DONE]"]);
  });

  it("跨 chunk 的 CRLF 不会丢事件", () => {
    const events = parseAll(["data: one\r", "\n\r", "\ndata: two\r\n\r\n"]);
    expect(events).toEqual(["one", "two"]);
  });

  it("多行 data 合并为一个事件", () => {
    const events = parseAll(["data: line1\ndata: line2\n\n"]);
    expect(events).toEqual(["line1\nline2"]);
  });

  it("忽略注释与空事件", () => {
    const events = parseAll([": keep-alive\n\n", "\n\n", "data: value\n\n"]);
    expect(events).toEqual(["value"]);
  });

  it("flush 返回结尾未带空行的事件", () => {
    const parser = createSseParser();
    expect(parser.push("data: tail")).toEqual([]);
    expect(parser.flush()).toEqual(["tail"]);
  });

  it("只有空白的事件不产生载荷", () => {
    expect(parseAll(["data:\n\n"])).toEqual([""]);
  });
});

describe("encodeSseEvent", () => {
  it("输出 data 前缀与空行结尾", () => {
    expect(encodeSseEvent({ type: "text-delta", text: "a\nb" })).toBe(
      'data: {"type":"text-delta","text":"a\\nb"}\n\n',
    );
  });
});
