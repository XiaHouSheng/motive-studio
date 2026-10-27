import { useEffect, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "./use-workspace";
import { GroupSidebar } from "@/features/question-groups/group-sidebar";
import { SolutionPanel } from "@/features/solutions/solution-panel";
import { ChatPanel } from "@/features/discussions/chat-panel";
import { ProviderSettingsDialog } from "@/features/settings/provider-settings-dialog";
import { ArchiveProposalDialog } from "@/features/archive/archive-proposal-dialog";
import { ImageImportDialog } from "@/features/question-groups/image-import-dialog";
import { MobileCaptureDialog } from "@/features/mobile-capture/mobile-capture-dialog";
import { ResizeHandle } from "@/components/shared/resize-handle";
import { CHAT_WIDTH_LIMITS, SIDEBAR_WIDTH_LIMITS } from "@/stores/ui";
import { TopBar } from "./top-bar";

interface WorkspaceShellProps {
  workspace: WorkspaceApi;
}

export function WorkspaceShell({ workspace }: WorkspaceShellProps) {
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
      if (mobileNavOpen) closeMobileNav();
      if (mobileChatOpen) closeMobileChat();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen, mobileChatOpen, closeMobileNav, closeMobileChat]);

  if (workspace.fatalError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-surface px-6 text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-[15px] font-bold text-white dark:text-[#062b27]">
          M
        </span>
        <div className="space-y-1.5">
          <p className="text-[14px] font-semibold text-ink">无法加载本地数据</p>
          <p className="max-w-sm text-[12.5px] leading-relaxed text-ink-soft">
            {workspace.fatalError}
          </p>
          <p className="text-[11.5px] text-ink-faint">
            请确认本地服务已启动，然后重试。
          </p>
        </div>
        <button
          type="button"
          onClick={workspace.retry}
          className="h-8 rounded-lg bg-brand px-3.5 text-[12.5px] font-medium text-white transition-colors hover:bg-brand-hover"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-surface text-ink">
      <TopBar workspace={workspace} />

      {workspace.error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-danger/25 bg-danger/10 px-3 py-1.5 text-[11.5px] text-danger">
          <AlertCircle size={13} strokeWidth={1.9} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{workspace.error}</span>
          <button
            type="button"
            onClick={workspace.dismissError}
            aria-label="关闭错误提示"
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
            label="调整题组栏宽度"
            onResize={setSidebarWidth}
            onDraggingChange={setResizing}
            className="border-r border-line bg-line/40 md:block"
          />
        )}

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <SolutionPanel workspace={workspace} />
        </main>

        {chatVisible ? (
          <>
            <ResizeHandle
              width={chatWidth}
              min={CHAT_WIDTH_LIMITS.min}
              max={CHAT_WIDTH_LIMITS.max}
              anchor="right"
              label="调整讨论栏宽度"
              onResize={setChatWidth}
              className="border-l border-line bg-line/40 xl:block"
            />
            <aside
              className="hidden shrink-0 border-l border-line bg-panel xl:flex xl:flex-col"
              style={{ width: chatWidth }}
            >
              <ChatPanel workspace={workspace} onClose={toggleChat} />
            </aside>
          </>
        ) : null}
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
        aria-label="题组导航"
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
            aria-label="关闭题组导航"
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
        aria-label="步骤讨论"
        aria-hidden={!mobileChatOpen}
        inert={!mobileChatOpen}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[400px] max-w-[94vw] flex-col border-l border-line bg-panel shadow-soft transition-transform duration-200 xl:hidden",
          mobileChatOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <ChatPanel workspace={workspace} onClose={closeMobileChat} />
      </aside>
      <ProviderSettingsDialog />
      <ArchiveProposalDialog workspace={workspace} />
      <ImageImportDialog workspace={workspace} />
      <MobileCaptureDialog workspace={workspace} />
    </div>
  );
}
