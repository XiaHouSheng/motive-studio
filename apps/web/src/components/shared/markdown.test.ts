import { describe, expect, it } from "vitest";
import { normalizeAsterisks, normalizePlainFormulas } from "./markdown";

describe("normalizeAsterisks", () => {
  it("把数学星号 ∗（U+2217）的加粗结构归一化为 ASCII 星号", () => {
    expect(normalizeAsterisks("∗∗一次额外的确认∗∗")).toBe("**一次额外的确认**");
  });

  it("全角星号 ＊（U+FF0A）同样归一化，斜体配对亦然", () => {
    expect(normalizeAsterisks("＊＊加粗＊＊ 与 ＊斜体＊")).toBe("**加粗** 与 *斜体*");
  });

  it("混用 ASCII 与形似星号时仍能配对", () => {
    expect(normalizeAsterisks("∗∗混排**文本∗∗")).toBe("**混排**文本**");
  });

  it("代码块、行内代码与公式中的形似星号保持原样", () => {
    const fenced = "```\na ∗ b\n```";
    expect(normalizeAsterisks(fenced)).toBe(fenced);
    expect(normalizeAsterisks("记为 `a ∗ b` 即可")).toBe("记为 `a ∗ b` 即可");
    expect(normalizeAsterisks("满足 $a ∗ b$ 关系")).toBe("满足 $a ∗ b$ 关系");
    expect(normalizeAsterisks("$$\nx ∗ y\n$$")).toBe("$$\nx ∗ y\n$$");
  });

  it("链接中的形似星号保持原样", () => {
    expect(normalizeAsterisks("[a∗b](https://example.com/x∗y)")).toBe(
      "[a∗b](https://example.com/x∗y)",
    );
  });

  it("无星号文本原样返回", () => {
    const text = "普通文本，不含任何星号。";
    expect(normalizeAsterisks(text)).toBe(text);
  });
});

describe("normalizePlainFormulas", () => {
  it("Markdown 加粗标记 ** 不被误判为公式，保持原样", () => {
    const text = "本题要求输出 **房间号** 及其 **最高温度**。";
    expect(normalizePlainFormulas(text)).toBe(text);
  });

  it("紧贴正文的加粗标记同样保持原样", () => {
    const text = "输出**房间号**及其**最高温度**，斜体 *x* 亦然。";
    expect(normalizePlainFormulas(text)).toBe(text);
  });

  it("纯符号串（如 --、==）不包裹公式", () => {
    expect(normalizePlainFormulas("a -- b == c")).toBe("a -- b == c");
  });

  it("裸文本公式仍会被包上行内 $…$", () => {
    expect(normalizePlainFormulas("其中 x=3 时取等")).toBe("其中 $x=3$ 时取等");
    expect(normalizePlainFormulas("由 a₁>0 可知")).toBe("由 $a_{1}>0$ 可知");
  });

  it("代码与公式片段内的内容不做处理", () => {
    const text = "记 `x=3` 或 $y=4$ 即可";
    expect(normalizePlainFormulas(text)).toBe(text);
  });
});
