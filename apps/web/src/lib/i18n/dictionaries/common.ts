/** 通用动作词条（跨域共享） */
export const commonZh = {
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
  "common.refresh": "刷新",
} as const;

export const commonEn: Record<keyof typeof commonZh, string> = {
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.confirm": "Confirm",
  "common.delete": "Delete",
  "common.retry": "Retry",
  "common.save": "Save",
  "common.back": "Back",
  "common.loading": "Loading…",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.expand": "Expand",
  "common.collapse": "Collapse",
  "common.settings": "Settings",
  "common.refresh": "Refresh",
};
