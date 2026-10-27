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

interface UiState {
  selectedGroupId: string | null;
  selectedQuestionId: string | null;
  activeStepId: string | null;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  chatVisible: boolean;
  chatWidth: number;
  mobileNavOpen: boolean;
  mobileChatOpen: boolean;
  settingsOpen: boolean;
  selectGroup: (groupId: string) => void;
  selectQuestion: (questionId: string) => void;
  initializeSelection: (groupId: string, questionId: string | null) => void;
  resetSelection: () => void;
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
  selectedQuestionId: null,
  activeStepId: null,
  sidebarCollapsed: false,
  sidebarWidth: readStoredWidth("sidebarWidth", SIDEBAR_WIDTH_LIMITS),
  chatVisible: true,
  chatWidth: readStoredWidth("chatWidth", CHAT_WIDTH_LIMITS),
  mobileNavOpen: false,
  mobileChatOpen: false,
  settingsOpen: false,
  selectGroup: (groupId) =>
    set({
      selectedGroupId: groupId,
      selectedQuestionId: null,
      activeStepId: null,
      mobileNavOpen: false,
      mobileChatOpen: false,
    }),
  selectQuestion: (questionId) =>
    set({
      selectedQuestionId: questionId,
      activeStepId: null,
      mobileNavOpen: false,
      mobileChatOpen: false,
    }),
  initializeSelection: (groupId, questionId) =>
    set({
      selectedGroupId: groupId,
      selectedQuestionId: questionId,
      activeStepId: null,
    }),
  resetSelection: () =>
    set({ selectedGroupId: null, selectedQuestionId: null, activeStepId: null }),
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
