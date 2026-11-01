/** Agent workspace 域词条：工作台外壳 / 顶栏 / 数据 hook / 主题菜单 / 通用组件 */

export const workspaceZh = {
  // ── 工作台外壳 workspace-shell ──
  "workspace.loadFailed": "无法加载本地数据",
  "workspace.loadFailedHint": "请确认本地服务已启动，然后重试。",
  "workspace.retry": "重试",
  "workspace.dismissErrorAria": "关闭错误提示",
  "workspace.resizeSidebarAria": "调整题组栏宽度",
  "workspace.resizeChatAria": "调整讨论栏宽度",
  "workspace.groupNavAria": "题组导航",
  "workspace.closeGroupNavAria": "关闭题组导航",
  "workspace.stepChatAria": "步骤讨论",

  // ── 数据 hook use-workspace ──
  "workspace.operationFailed": "操作失败，请重试",
  "workspace.selectGroupFirst": "请先选择题组",
  "workspace.keepAtLeastOneQuestion": "请至少保留一道题目",
  "workspace.backupInvalidJson": "备份文件不是有效的 JSON",

  // ── 顶栏 top-bar ──
  "topbar.openGroupNavAria": "打开题组导航",
  "topbar.expandSidebarAria": "展开侧栏",
  "topbar.collapseSidebarAria": "收起侧栏",
  "topbar.noGroupSelected": "未选择题组",
  "topbar.questionIndex": "第 {index} 题",
  "topbar.serverStatusTitle": "本地 Express 服务状态",
  "topbar.serverOnline": "本地服务已连接",
  "topbar.serverChecking": "检测服务…",
  "topbar.serverOffline": "服务未连接",
  "topbar.mobileCapture": "手机拍照导入",
  "topbar.modelSettings": "模型设置",
  "topbar.backupAria": "数据备份",
  "topbar.localData": "本地数据",
  "topbar.exportBackup": "导出备份",
  "topbar.importBackup": "导入备份",
  "topbar.importWarning": "导入会替换当前全部数据。",
  "topbar.openChatAria": "打开讨论面板",
  "topbar.expandChatAria": "展开讨论面板",
  "topbar.collapseChatAria": "收起讨论面板",

  // ── 主题菜单 theme-menu ──
  "theme.light": "浅色",
  "theme.dark": "深色",
  "theme.system": "跟随系统",
  "theme.toggleAria": "切换主题",
  "theme.appearance": "外观",

  // ── 通用组件 dialog / thinking-dots ──
  "ui.close": "关闭",
  "ui.thinking": "正在思考",
} as const;

export const workspaceEn: Record<keyof typeof workspaceZh, string> = {
  // ── Workspace shell ──
  "workspace.loadFailed": "Failed to load local data",
  "workspace.loadFailedHint": "Make sure the local service is running, then try again.",
  "workspace.retry": "Retry",
  "workspace.dismissErrorAria": "Dismiss error",
  "workspace.resizeSidebarAria": "Resize groups sidebar",
  "workspace.resizeChatAria": "Resize chat panel",
  "workspace.groupNavAria": "Group navigation",
  "workspace.closeGroupNavAria": "Close group navigation",
  "workspace.stepChatAria": "Step discussion",

  // ── Data hook ──
  "workspace.operationFailed": "Operation failed. Please try again.",
  "workspace.selectGroupFirst": "Select a group first",
  "workspace.keepAtLeastOneQuestion": "Keep at least one question",
  "workspace.backupInvalidJson": "The backup file is not valid JSON",

  // ── Top bar ──
  "topbar.openGroupNavAria": "Open group navigation",
  "topbar.expandSidebarAria": "Expand sidebar",
  "topbar.collapseSidebarAria": "Collapse sidebar",
  "topbar.noGroupSelected": "No group selected",
  "topbar.questionIndex": "Question {index}",
  "topbar.serverStatusTitle": "Local Express server status",
  "topbar.serverOnline": "Local server connected",
  "topbar.serverChecking": "Checking server…",
  "topbar.serverOffline": "Server not connected",
  "topbar.mobileCapture": "Mobile capture",
  "topbar.modelSettings": "Model settings",
  "topbar.backupAria": "Data backup",
  "topbar.localData": "Local data",
  "topbar.exportBackup": "Export backup",
  "topbar.importBackup": "Import backup",
  "topbar.importWarning": "Importing replaces all current data.",
  "topbar.openChatAria": "Open chat panel",
  "topbar.expandChatAria": "Expand chat panel",
  "topbar.collapseChatAria": "Collapse chat panel",

  // ── Theme menu ──
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "theme.toggleAria": "Switch theme",
  "theme.appearance": "Appearance",

  // ── Shared UI components ──
  "ui.close": "Close",
  "ui.thinking": "Thinking",
};
