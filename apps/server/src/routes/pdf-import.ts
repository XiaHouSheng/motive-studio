import { Router } from "express";
import type { Request, Response } from "express";
import { PDFParse } from "pdf-parse";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readBody, readOptionalString, readString } from "./validation.js";

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_BLOCKS = 200;
const MIN_BLOCK_LENGTH = 8;

/**
 * 把 PDF 提取出的连续文本拆成候选题目块：
 * 优先按空行分段；只得到一个大块时按行首题号（1. / 12、/（3）等）二次拆分。
 */
function splitQuestionBlocks(raw: string): string[] {
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    // pdf-parse 逐页文本自带的页码脚注
    .replace(/^--\s*\d+\s*of\s*\d+\s*--$/gm, "")
    .trim();
  if (!normalized) return [];

  let blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length >= MIN_BLOCK_LENGTH);

  if (blocks.length <= 1) {
    const byNumber = normalized
      .split(/(?<=\n)(?=\s*\d{1,3}\s*[.、．()）])/)
      .map((block) => block.trim())
      .filter((block) => block.length >= MIN_BLOCK_LENGTH);
    if (byNumber.length > blocks.length) blocks = byNumber;
  }

  return blocks.slice(0, MAX_BLOCKS);
}

/**
 * PDF 导入：解析文本并拆成候选题目块。
 * 建题复用 POST /api/questions 由前端逐条提交，试卷分组归属由创建接口校验。
 */
export function createPdfImportRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.post("/pdf-import", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    const groupId = readString(body, "groupId", { max: 200, label: "题组 ID" });
    readOptionalString(body, "paperGroupId", { max: 200, label: "试卷分组 ID" });
    const data = readString(body, "data", { max: 64_000_000, label: "PDF 数据" });

    repository.getGroupTitle(groupId);

    const buffer = Buffer.from(data, "base64");
    if (buffer.length === 0) {
      throw new HttpError(400, "INVALID_FIELD", "PDF 数据为空");
    }
    if (buffer.length > MAX_PDF_BYTES) {
      throw new HttpError(413, "TOO_LARGE", "PDF 文件超过 20MB");
    }

    let text = "";
    let pages = 0;
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      pages = result.total;
      // 用逐页文本拼接，避免文档级 text 中的页码脚注混入题目块
      text = result.pages.map((page) => page.text).join("\n\n");
      await parser.destroy();
    } catch {
      throw new HttpError(422, "PDF_PARSE_FAILED", "PDF 解析失败，可能是扫描版或文件已损坏");
    }

    res.json({ pages, blocks: splitQuestionBlocks(text) });
  });

  return router;
}
