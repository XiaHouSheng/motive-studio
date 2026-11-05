import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { isFrameless, isInteractiveTarget } from "@/lib/desktop";
import { useT } from "@/lib/i18n/use-i18n";

/**
 * 无边框窗口的右上角控制按钮：最小化 + 最大化/还原 + 关闭（红底悬停，Windows 惯例）。
 * 最大化图标随窗口状态切换（还原图标为两个叠置方框）；拖拽区双击同样可切换。
 * 非桌面壳环境整体不渲染。
 */
export function WindowControls() {
  const t = useT();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isFrameless) return;
    const bridge = window.motiveWindow;
    if (!bridge) return;
    let cancelled = false;
    void bridge.isMaximized().then((value) => {
      if (!cancelled) setMaximized(value);
    });
    const unsubscribe = bridge.onMaximizeChange(setMaximized);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (!isFrameless) return null;
  return (
    <div className="ml-1 flex items-center" data-no-drag>
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
      <button
        type="button"
        aria-label={t("topbar.minimize")}
        title={t("topbar.minimize")}
        onClick={() => window.motiveWindow?.minimize()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink"
      >
        <Minus size={16} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label={maximized ? t("topbar.restore") : t("topbar.maximize")}
        title={maximized ? t("topbar.restore") : t("topbar.maximize")}
        onClick={() => window.motiveWindow?.toggleMaximize()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-selection hover:text-ink"
      >
        {maximized ? (
          <Copy size={14} strokeWidth={1.8} />
        ) : (
          <Square size={13} strokeWidth={1.8} />
        )}
      </button>
      <button
        type="button"
        aria-label={t("topbar.close")}
        title={t("topbar.close")}
        onClick={() => window.motiveWindow?.close()}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-danger/70 hover:text-white"
      >
        <X size={16} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/** 拖拽区双击最大化/还原；命中交互元素时忽略 */
export function onAppDragDoubleClick(event: React.MouseEvent<HTMLElement>): void {
  if (!(event.target instanceof Element)) return;
  if (isInteractiveTarget(event.target)) return;
  window.motiveWindow?.toggleMaximize();
}
