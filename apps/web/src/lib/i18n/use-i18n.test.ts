import { describe, expect, it } from "vitest";
import { en } from "./en";
import { zhCN } from "./zh-CN";
import { interpolate } from "./use-i18n";

describe("词条完整性", () => {
  it("en 词条与 zh-CN 的 key 完全一致且非空", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
    for (const key of Object.keys(zhCN) as Array<keyof typeof zhCN>) {
      expect(en[key].length).toBeGreaterThan(0);
      expect(zhCN[key].length).toBeGreaterThan(0);
    }
  });
});

describe("interpolate", () => {
  it("替换 {param} 占位符", () => {
    expect(interpolate("共 {count} 个步骤", { count: 3 })).toBe("共 3 个步骤");
    expect(interpolate("{name} 已保存", { name: "题解" })).toBe("题解 已保存");
  });

  it("无参数时原样返回模板", () => {
    expect(interpolate("普通文案", undefined)).toBe("普通文案");
  });

  it("未知占位符原样保留", () => {
    expect(interpolate("缺少 {missing} 参数", { other: 1 })).toBe("缺少 {missing} 参数");
  });
});
