import { describe, expect, it } from "vitest";
import { replaceStepReferences } from "@motive/shared";

const steps = [
  { id: "550e8400-e29b-41d4-a716-446655440000", order: 1, title: "明确页面序列" },
  { id: "6FA16C4E-8F5A-4F9E-B2C1-7A2B3C4D5E6F", order: 2, title: "模拟最佳置换" },
];

describe("replaceStepReferences", () => {
  it("裸 UUID 替换为「步骤 N（标题）」", () => {
    const input = "结合 550e8400-e29b-41d4-a716-446655440000 的结论可知缺页 10 次。";
    expect(replaceStepReferences(input, steps)).toBe("结合 步骤 1（明确页面序列） 的结论可知缺页 10 次。");
  });

  it("方括号形态 [uuid] 一并替换", () => {
    const input = "参考 [550e8400-e29b-41d4-a716-446655440000] 的结论。";
    expect(replaceStepReferences(input, steps)).toBe("参考 步骤 1（明确页面序列） 的结论。");
  });

  it("大小写不敏感（大写 UUID 也命中）", () => {
    const input = "6FA16C4E-8F5A-4F9E-B2C1-7A2B3C4D5E6F 的结果为 14 次。";
    expect(replaceStepReferences(input, steps)).toBe("步骤 2（模拟最佳置换） 的结果为 14 次。");
  });

  it("未知 UUID 不动，避免误伤用户文本", () => {
    const input = "请求 id 9f8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d 已记录。";
    expect(replaceStepReferences(input, steps)).toBe(input);
  });

  it("无文本或无步骤时原样返回", () => {
    expect(replaceStepReferences("", steps)).toBe("");
    expect(replaceStepReferences("普通文本", [])).toBe("普通文本");
  });
});
