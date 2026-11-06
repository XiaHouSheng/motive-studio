import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "./use-workspace";
import { GroupSidebar } from "@/features/question-groups/group-sidebar";
import { SolutionPanel } from "@/features/solutions/solution-panel";
import { ChatPanel } from "@/features/discussions/chat-panel";
import { SettingsPage } from "@/features/settings/settings-page";
import { ImageImportDialog } from "@/features/question-groups/image-import-dialog";
import { MobileCaptureDialog } from "@/features/mobile-capture/mobile-capture-dialog";
import { ResizeHandle } from "@/components/shared/resize-handle";
import { CHAT_WIDTH_LIMITS, SIDEBAR_WIDTH_LIMITS } from "@/stores/ui";
import { TopBar } from "./top-bar";

interface WorkspaceShellProps {
  workspace: WorkspaceApi;
}

export function WorkspaceShell({ workspace }: WorkspaceShellProps) {
  const t = useT();
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const sidebarWidth = useUiStore((state) => state.sidebarWidth);
  const setSidebarWidth = useUiStore((state) => state.setSidebarWidth);
  const chatVisible = useUiStore((state) => state.chatVisible);
  const chatWidth = useUiStore((state) => state.chatWidth);
  const setChatWidth = useUiStore((state) => state.setChatWidth);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const mobileChatOpen = useUiStore((state) => state.mobileChatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);
  const closeMobileNav = useUiStore((state) => state.closeMobileNav);
  const closeMobileChat = useUiStore((state) => state.closeMobileChat);
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (settingsOpen) {
        closeSettings();
        return;
      }
      if (mobileNavOpen) closeMobileNav();
      if (mobileChatOpen) closeMobileChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    settingsOpen,
    closeSettings,
    mobileNavOpen,
    mobileChatOpen,
    closeMobileNav,
    closeMobileChat,
  ]);

  if (workspace.fatalError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-surface px-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-[15px] font-bold text-white dark:text-[#062b27]">
          M
        </span>
        <div className="space-y-1.5">
          <p className="text-[14px] font-semibold text-ink">{t("workspace.loadFailed")}</p>
          <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-soft">
            {workspace.fatalError}
          </p>
          <p className="text-[11.5px] text-ink-faint">
            {t("workspace.loadFailedHint")}
          </p>
        </div>
        <button
          type="button"
          onClick={workspace.retry}
          className="h-8 rounded-lg bg-brand px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          {t("workspace.retry")}
        </button>
      </div>
    );
  }

  // 设置页：整页视图替代工作台内容（顶栏齿轮进入，返回/Escape 离开）。
  // 工作台数据保存在 useWorkspace 中（父组件），进入设置页不会重置。
  if (settingsOpen) {
    return <SettingsPage />;
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-ink">
      <TopBar workspace={workspace} />

      {workspace.error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/25 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">
          <AlertCircle size={13} strokeWidth={1.9} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{workspace.error}</span>
          <button
            type="button"
            onClick={workspace.dismissError}
            aria-label={t("workspace.dismissErrorAria")}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "hidden shrink-0 overflow-hidden border-r border-line bg-sidebar transition-[width] duration-200 md:flex md:flex-col",
            sidebarCollapsed ? "w-0 border-r-0" : "border-r-0",
          )}
          style={
            sidebarCollapsed
              ? undefined
              : { width: sidebarWidth, transition: resizing ? "none" : undefined }
          }
          aria-hidden={sidebarCollapsed}
          inert={sidebarCollapsed}
        >
          <div className="h-full w-full min-w-[200px]">
            <GroupSidebar workspace={workspace} />
          </div>
        </aside>
        {sidebarCollapsed ? null : (
          <ResizeHandle
            width={sidebarWidth}
            min={SIDEBAR_WIDTH_LIMITS.min}
            max={SIDEBAR_WIDTH_LIMITS.max}
            anchor="left"
            label={t("workspace.resizeSidebarAria")}
            onResize={setSidebarWidth}
            onDraggingChange={setResizing}
            className="border-r border-line bg-line/40 md:block"
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <SolutionPanel workspace={workspace} />
        </main>

        {/* 讨论面板：常驻挂载，靠宽度与位移过渡实现展开/收起，避免收起时突然消失 */}
        <div
          className={cn(
            "hidden h-full shrink-0 transition-opacity duration-(--duration-normal) ease-(--ease-standard) xl:block",
            // 收起时把手一并归零：残留的 4px 占位会撑出文档级横向滚动条，
            // 横向滚动条再压缩 h-dvh 可用高度引发纵向滚动条，两者互相自持
            chatVisible ? "opacity-100" : "w-0 overflow-hidden pointer-events-none opacity-0",
          )}
          aria-hidden={!chatVisible}
          inert={!chatVisible}
        >
          <ResizeHandle
            width={chatWidth}
            min={CHAT_WIDTH_LIMITS.min}
            max={CHAT_WIDTH_LIMITS.max}
            anchor="right"
            label={t("workspace.resizeChatAria")}
            onResize={setChatWidth}
            onDraggingChange={setResizing}
            className="xl:block"
          />
        </div>
        <aside
          className={cn(
            "hidden shrink-0 overflow-hidden bg-panel transition-[width,border-color] duration-(--duration-normal) ease-(--ease-standard) xl:flex xl:flex-col",
            // 收起时去左边框：width:0 仍会被 border 撑出约 1px 占位
            chatVisible ? "border-l border-line" : "border-l-0",
          )}
          style={{
            width: chatVisible ? chatWidth : 0,
            transition: resizing ? "none" : undefined,
          }}
          aria-hidden={!chatVisible}
          inert={!chatVisible}
        >
          <div
            className={cn(
              "h-full shrink-0 transition-[opacity,transform] duration-(--duration-normal) ease-(--ease-standard)",
              chatVisible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
            )}
            style={{ width: chatWidth }}
          >
            <ChatPanel workspace={workspace} onClose={toggleChat} />
          </div>
        </aside>
      </div>

      {/* 移动端题组抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/35 transition-opacity duration-200 md:hidden",
          mobileNavOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={closeMobileNav}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal={mobileNavOpen}
        aria-label={t("workspace.groupNavAria")}
        aria-hidden={!mobileNavOpen}
        inert={!mobileNavOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[292px] max-w-[86vw] flex-col border-r border-line bg-sidebar shadow-soft transition-transform duration-200 md:hidden",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[12px] font-bold text-white dark:text-[#062b27]">
            M
          </span>
          <span className="text-[13px] font-semibold text-ink">Motive Studio</span>
          <button
            type="button"
            onClick={closeMobileNav}
            aria-label={t("workspace.closeGroupNavAria")}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-selection hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <GroupSidebar workspace={workspace} onNavigate={closeMobileNav} />
        </div>
      </aside>

      {/* 移动端讨论抽屉 */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/35 transition-opacity duration-200 xl:hidden",
          mobileChatOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={closeMobileChat}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal={mobileChatOpen}
        aria-label={t("workspace.stepChatAria")}
        aria-hidden={!mobileChatOpen}
        inert={!mobileChatOpen}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-[94vw] flex-col border-l border-line bg-panel shadow-soft transition-transform duration-200 xl:hidden",
          mobileChatOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <ChatPanel workspace={workspace} onClose={closeMobileChat} />
      </aside>
      <ImageImportDialog workspace={workspace} />
      <MobileCaptureDialog workspace={workspace} />
    </div>
  );
}
