/**
 * 简体中文词条（应用的基准语言）。
 * 按域拆分在 dictionaries/ 下维护，此处仅做聚合；
 * key 使用「域.名称」扁平命名，`as const` 保证 key 类型收窄。
 * en.ts 以 Dictionary 类型聚合英文词条，缺失 key 会直接编译报错。
 */
import { commonZh } from "./dictionaries/common";
import { errorsZh } from "./dictionaries/errors";
import { panelsZh } from "./dictionaries/panels";
import { solutionsZh } from "./dictionaries/solutions";
import { workspaceZh } from "./dictionaries/workspace";

export const zhCN = {
  ...commonZh,
  ...errorsZh,
  ...workspaceZh,
  ...solutionsZh,
  ...panelsZh,
} as const;

export type Dictionary = Record<keyof typeof zhCN, string>;
export type DictionaryKey = keyof typeof zhCN;
