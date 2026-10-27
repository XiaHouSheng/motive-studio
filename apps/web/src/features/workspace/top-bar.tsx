import { useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ChevronRight,
  DatabaseBackup,
  Download,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  Smartphone,
  Terminal,
  Upload,
} from "lucide-react";
import { useUiStore } from "@/stores/ui";
import { cn } from "@/lib/utils";
import { ThemeMenu } from "@/features/theme/theme-menu";
import type { WorkspaceApi } from "./use-workspace";
import { Skeleton } from "@/components/ui/skeleton";

const menuItemClass =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-ink-soft outline-none select-none data-[highlighted]:bg-selection data-[highlighted]:text-ink";

type ServerStatus = "checking" | "online" | "offline";

function useServerStatus(): ServerStatus {
  const [status, setStatus] = useState<ServerStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("health check failed");
        const body = (await response.json()) as { status?: string };
        setStatus(body.status === "ok" ? "online" : "offline");
      })
      .catch(() => setStatus("offline"))
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return status;
}

interface TopBarProps {
  workspace: WorkspaceApi;
}

export function TopBar({ workspace }: TopBarProps) {
  const {
    selectedGroup,
    question,
    loading,
    exportBackup,
    importBackup,
    openMobileLink,
  } = workspace;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const chatVisible = useUiStore((state) => state.chatVisible);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const toggleChat = useUiStore((state) => state.toggleChat);
  const openMobileNav = useUiStore((state) => state.openMobileNav);
  const openMobileChat = useUiStore((state) => state.openMobileChat);
  const openSettings = useUiStore((state) => state.openSettings);
  const status = useServerStatus();
  const ChatIcon = chatVisible ? PanelRightClose : PanelRightOpen;
  const questionIndex =
    question && selectedGroup ? selectedGroup.questionIds.indexOf(question.id) + 1 : 0;

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-panel px-2.5">
      <button
        type="button"
        onClick={openMobileNav}
        aria-label="打开题组导航"
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink md:hidden"
      >
        <Menu size={17} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        className="hidden h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink md:inline-flex"
      >
        {sidebarCollapsed ? (
          <PanelLeft size={17} strokeWidth={1.8} />
        ) : (
          <PanelLeftClose size={17} strokeWidth={1.8} />
        )}
      </button>

      <div className="ml-0.5 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[12px] font-bold text-white dark:text-[#062b27]">
          M
        </span>
        <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Motive Studio</span>
        <span className="hidden rounded border border-line px-1.5 py-px text-[9.5px] font-medium tracking-[0.08em] text-ink-faint uppercase sm:inline">
          Local
        </span>
      </div>

      <div className="mx-1 hidden h-4 w-px bg-line lg:block" />

      <div className="hidden min-w-0 flex-1 items-center gap-1.5 text-[12px] lg:flex">
        {loading ? (
          <Skeleton className="h-3.5 w-40" />
        ) : (
          <>
            <span className="shrink-0 text-ink-soft">{selectedGroup?.title ?? "未选择题组"}</span>
            {question ? (
              <>
                <ChevronRight size={12} className="shrink-0 text-ink-faint" />
                <span className="shrink-0 text-ink-faint">第 {questionIndex} 题</span>
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <span
          className="mr-1 hidden items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-ink-faint xl:flex"
          title="本地 Express 服务状态"
        >
          <Terminal size={12} strokeWidth={1.8} />
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "online" && "bg-success",
              status === "checking" && "animate-pulse bg-ink-faint",
              status === "offline" && "bg-danger",
            )}
          />
          {status === "online" ? "本地服务已连接" : status === "checking" ? "检测服务…" : "服务未连接"}
        </span>
        <button
          type="button"
          onClick={() => void openMobileLink()}
          aria-label="手机拍照导入"
          title="手机拍照导入"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink"
        >
          <Smartphone size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={openSettings}
          aria-label="模型设置"
          title="模型设置"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink"
        >
          <Settings2 size={16} strokeWidth={1.8} />
        </button>
        <ThemeMenu />
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label="数据备份"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink data-[state=open]:bg-selection data-[state=open]:text-ink"
            >
              <DatabaseBackup size={16} strokeWidth={1.8} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-[184px] rounded-xl border border-line bg-elevated p-1 shadow-soft"
            >
              <DropdownMenu.Label className="px-2.5 pt-1.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
                本地数据
              </DropdownMenu.Label>
              <DropdownMenu.Item onSelect={exportBackup} className={menuItemClass}>
                <Download size={14} strokeWidth={1.8} className="text-ink-faint" />
                <span className="flex-1">导出备份</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => fileInputRef.current?.click()}
                className={menuItemClass}
              >
                <Upload size={14} strokeWidth={1.8} className="text-ink-faint" />
                <span className="flex-1">导入备份</span>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-line" />
              <p className="px-2.5 py-1 text-[10.5px] leading-relaxed text-ink-faint">
                导入会替换当前全部数据。
              </p>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importBackup(file);
            event.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={openMobileChat}
          aria-label="打开讨论面板"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink xl:hidden"
        >
          <MessageSquare size={16} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={toggleChat}
          aria-label={chatVisible ? "收起讨论面板" : "展开讨论面板"}
          className="hidden h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink xl:inline-flex"
        >
          <ChatIcon size={17} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
