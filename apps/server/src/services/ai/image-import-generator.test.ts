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
});
