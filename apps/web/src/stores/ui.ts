import { create } from "zustand";

export const SIDEBAR_WIDTH_LIMITS = { min: 200, max: 420, default: 252 } as const;
export const CHAT_WIDTH_LIMITS = { min: 320, max: 560, default: 380 } as const;

interface WidthLimits {
  min: number;
  max: number;
  default: number;
}

const STORAGE_PREFIX = "motive.ui.";

const clampWidth = (width: number, limits: WidthLimits) =>
  Math.min(limits.max, Math.max(limits.min, width));

function readStoredWidth(key: string, limits: WidthLimits): number {
  if (typeof window === "undefined") return limits.default;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    const value = raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(value)) return limits.default;
    return clampWidth(value, limits);
  } catch {
    return limits.default;
  }
}

function persistWidth(key: string, width: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, String(Math.round(width)));
  } catch {
    // 持久化失败时静默忽略，宽度仍会在当前会话生效
  }
}

function readStoredFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function persistFlag(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STORAGE_PREFIX + key, "1");
    else window.localStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // 持久化失败时静默忽略，偏好仍会在当前会话生效
  }
}

interface UiState {
  selectedGroupId: string | null;
  /** 选中的试卷分组（题组之下的二级分组）；null 表示跟随题组首个试卷分组 */
  selectedPaperGroupId: string | null;
  selectedQuestionId: string | null;
  activeStepId: string | null;
  /** 中栏题解视图：分步题解 / 题目详解 双 Tab */
  solutionView: "steps" | "explanation";
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatVisible: boolean;
  chatWidth: number;
  mobileNavOpen: boolean;
  mobileChatOpen: boolean;
  settingsOpen: boolean;
  /** 导出备份时是否内嵌题目图片 */
  backupIncludeImages: boolean;
  setBackupIncludeImages: (value: boolean) => void;
  selectGroup: (groupId: string) => void;
  selectPaperGroup: (groupId: string, paperGroupId: string) => void;
  selectQuestion: (questionId: string) => void;
  initializeSelection: (groupId: string, questionId: string | null) => void;
  resetSelection: () => void;
  setSolutionView: (view: "steps" | "explanation") => void;
  openDiscussion: (stepId: string) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  setSidebarWidth: (width: number) => void;
  setChatWidth: (width: number) => void;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  openMobileChat: () => void;
  closeMobileChat: () => void;
  openSettings: () => void;
  closeSettings: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  selectedGroupId: null,
  selectedPaperGroupId: null,
  selectedQuestionId: null,
  activeStepId: null,
  solutionView: "steps",
  sidebarCollapsed: false,
  sidebarWidth: readStoredWidth("sidebarWidth", SIDEBAR_WIDTH_LIMITS),
  chatVisible: true,
  chatWidth: readStoredWidth("chatWidth", CHAT_WIDTH_LIMITS),
  mobileNavOpen: false,
  mobileChatOpen: false,
  settingsOpen: false,
  backupIncludeImages: readStoredFlag("backupIncludeImages"),
  setBackupIncludeImages: (value) => {
    persistFlag("backupIncludeImages", value);
    set({ backupIncludeImages: value });
  },
  selectGroup: (groupId) =>
    set({
      selectedGroupId: groupId,
      selectedPaperGroupId: null,
      selectedQuestionId: null,
      activeStepId: null,
      solutionView: "steps",
      mobileNavOpen: false,
      mobileChatOpen: false,
    }),
  selectPaperGroup: (groupId, paperGroupId) =>
    set({
      selectedGroupId: groupId,
      selectedPaperGroupId: paperGroupId,
      selectedQuestionId: null,
      activeStepId: null,
      solutionView: "steps",
      mobileNavOpen: false,
      mobileChatOpen: false,
    }),
  selectQuestion: (questionId) =>
    set({
      selectedQuestionId: questionId,
      activeStepId: null,
      solutionView: "steps",
      mobileNavOpen: false,
      mobileChatOpen: false,
    }),
  initializeSelection: (groupId, questionId) =>
    set({
      selectedGroupId: groupId,
      selectedPaperGroupId: null,
      selectedQuestionId: questionId,
      activeStepId: null,
      solutionView: "steps",
    }),
  resetSelection: () =>
    set({
      selectedGroupId: null,
      selectedPaperGroupId: null,
      selectedQuestionId: null,
      activeStepId: null,
      solutionView: "steps",
    }),
  setSolutionView: (view) => set({ solutionView: view }),
  openDiscussion: (stepId) =>
    set({
      activeStepId: stepId,
      chatVisible: true,
      mobileChatOpen:
        typeof window !== "undefined" &&
        window.matchMedia("(max-width: 1279px)").matches,
    }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleChat: () => set((state) => ({ chatVisible: !state.chatVisible })),
  setSidebarWidth: (width) => {
    const clamped = clampWidth(width, SIDEBAR_WIDTH_LIMITS);
    persistWidth("sidebarWidth", clamped);
    set({ sidebarWidth: clamped });
  },
  setChatWidth: (width) => {
    const clamped = clampWidth(width, CHAT_WIDTH_LIMITS);
    persistWidth("chatWidth", clamped);
    set({ chatWidth: clamped });
  },
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  openMobileChat: () => set({ mobileChatOpen: true }),
  closeMobileChat: () => set({ mobileChatOpen: false }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}));
