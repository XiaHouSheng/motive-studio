import { describe, expect, it } from "vitest";
import { excerpt } from "./format";

describe("excerpt", () => {
  it("移除公式与 Markdown 标记", () => {
    expect(excerpt("已知函数 $f(x)=x^{2}-6x+5$，求最值。")).toBe("已知函数 ，求最值。");
    expect(excerpt("`f(x)` 的**定义域**")).toBe("的定义域");
  });

  it("超长内容截断并加省略号", () => {
    const text = "一二三四五六七八九十一二三四五六七八九十";
    expect(excerpt(text, 6)).toBe("一二三四五六…");
  });

  it("保留短文本原样", () => {
    expect(excerpt("极限计算", 48)).toBe("极限计算");
  });
});
