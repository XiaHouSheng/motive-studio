import { commonEn } from "./dictionaries/common";
import { errorsEn } from "./dictionaries/errors";
import { panelsEn } from "./dictionaries/panels";
import { solutionsEn } from "./dictionaries/solutions";
import { workspaceEn } from "./dictionaries/workspace";
import type { Dictionary } from "./zh-CN";

/** 英文词条；Dictionary 类型标注保证与 zh-CN 的 key 完全一致（缺失即编译报错） */
export const en: Dictionary = {
  ...commonEn,
  ...errorsEn,
  ...workspaceEn,
  ...solutionsEn,
  ...panelsEn,
};
