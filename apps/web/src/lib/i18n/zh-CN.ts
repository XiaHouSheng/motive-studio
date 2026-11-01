/**
 * 简体中文词条源（应用的基准语言）。
 * key 使用「域.名称」扁平命名；`as const` 保证 key 类型收窄。
 * en.ts 以 Dictionary 类型标注，缺失 key 会直接编译报错。
 */
export const zhCN = {
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.confirm": "确认",
  "common.delete": "删除",
  "common.retry": "重试",
  "common.save": "保存",
  "common.back": "返回",
  "common.loading": "加载中…",
  "common.copy": "复制",
  "common.copied": "已复制",
  "common.expand": "展开",
  "common.collapse": "收起",
  "common.settings": "设置",
} as const;

export type Dictionary = Record<keyof typeof zhCN, string>;
export type DictionaryKey = keyof typeof zhCN;
