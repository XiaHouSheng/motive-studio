import { describe, expect, it } from "vitest";
import {
  buildImageImportMessages,
  parseImageQuestions,
} from "./image-import-generator.js";

const IMAGE = { mediaType: "image/png", data: "iVBORw0KGgo=" };

describe("parseImageQuestions", () => {
  it("解析合法 JSON 并裁剪空白、丢弃空项", () => {
    const questions = parseImageQuestions(
      '{"questions":[" 求 $x^2-1=0$ 的解 ","  ","证明勾股定理"]}',
    );
    expect(questions).toEqual(["求 $x^2-1=0$ 的解", "证明勾股定理"]);
  });

  it("支持带代码围栏的输出", () => {
    const questions = parseImageQuestions(
      '```json\n{"questions":["题目一"]}\n```',
    );
    expect(questions).toEqual(["题目一"]);
  });

  it("空数组视为没有识别到题目", () => {
    expect(parseImageQuestions('{"questions":[]}')).toEqual([]);
  });

  it("拒绝非法 JSON 或缺失 questions", () => {
    expect(() => parseImageQuestions("not json")).toThrowError(/不是有效 JSON/);
    expect(() => parseImageQuestions('{"items":["a"]}')).toThrowError(
      /缺少 questions/,
    );
    expect(() => parseImageQuestions("")).toThrowError(/未返回识别结果/);
  });

  it("拒绝非文本题目与超量结果", () => {
    expect(() => parseImageQuestions('{"questions":[1]}')).toThrowError(
      /非文本题目/,
    );
    const tooMany = JSON.stringify({
      questions: Array.from({ length: 31 }, (_, index) => `题目 ${index}`),
    });
    expect(() => parseImageQuestions(tooMany)).toThrowError(/最多导入 30 道/);
  });
});

describe("buildImageImportMessages", () => {
  it("把图片作为 data URL 附带在用户消息中", () => {
    const messages = buildImageImportMessages([IMAGE, { ...IMAGE, mediaType: "image/jpeg" }]);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(typeof messages[0].content).toBe("string");

    const content = messages[1].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts[0].type).toBe("text");
    expect(parts).toHaveLength(3);
    expect(parts[1]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgo=" },
    });
    expect(parts[2]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,iVBORw0KGgo=" },
    });
  });

  function userText(messages: ReturnType<typeof buildImageImportMessages>): string {
    const parts = messages[1].content as Array<{ type: string; text?: string }>;
    return parts.find((part) => part.type === "text")?.text ?? "";
  }

  it("未提供或空白附加要求时消息内容保持不变", () => {
    const baseline = userText(buildImageImportMessages([IMAGE]));
    expect(baseline).toBe("请转写这张图片中的全部题目。");
    expect(userText(buildImageImportMessages([IMAGE], { extraPrompt: "" }))).toBe(baseline);
    expect(userText(buildImageImportMessages([IMAGE], { extraPrompt: "  \n\t " }))).toBe(
      baseline,
    );
  });

  it("附加要求 trim 后追加到用户消息末尾", () => {
    const messages = buildImageImportMessages([IMAGE], { extraPrompt: " 只要第 5–8 题 " });
    expect(userText(messages)).toBe("请转写这张图片中的全部题目。\n\n用户附加要求：只要第 5–8 题");
    // system 仍为内置默认提示词，附加要求不参与 system 覆盖
    expect(messages[0].content).toContain("题目录入助手");
  });

  it("2000 字符附加要求正常接受", () => {
    const long = "a".repeat(2000);
    const messages = buildImageImportMessages([IMAGE], { extraPrompt: long });
    expect(userText(messages)).toBe(`请转写这张图片中的全部题目。\n\n用户附加要求：${long}`);
  });

  it("自定义 systemPrompt 与附加要求组合时互不影响", () => {
    const messages = buildImageImportMessages([IMAGE], {
      systemPrompt: "自定义系统提示词",
      extraPrompt: "只转写选择题",
    });
    expect(messages[0].content).toBe("自定义系统提示词");
    expect(userText(messages)).toBe("请转写这张图片中的全部题目。\n\n用户附加要求：只转写选择题");
  });
});
