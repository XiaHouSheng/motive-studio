import { useCallback, useRef, useState } from "react";
import { Check, Copy, Download, Maximize2 } from "lucide-react";
import { extractTableDataFromElement, tableDataToCSV, tableDataToMarkdown } from "streamdown";
import { useT } from "@/lib/i18n/use-i18n";
import { Dialog } from "@/components/ui/dialog";

/**
 * 表头内嵌的表格操作栏（复制 / 下载 / 放大）。
 * 由 markdown 渲染器注入到 thead 最后一个单元格内，
 * 布局上属于表头行的一部分，不是悬浮层。
 */

function copyTable(table: HTMLTableElement): Promise<void> {
  const markdown = tableDataToMarkdown(extractTableDataFromElement(table));
  const item = new ClipboardItem({
    "text/plain": new Blob([markdown], { type: "text/plain" }),
    "text/html": new Blob([table.outerHTML], { type: "text/html" }),
  });
  return navigator.clipboard.write([item]);
}

function downloadTable(table: HTMLTableElement) {
  const csv = tableDataToCSV(extractTableDataFromElement(table));
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "table.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function TableToolbar() {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [fullscreenHtml, setFullscreenHtml] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);

  const handleCopy = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const table = event.currentTarget.closest("table");
    if (!table) return;
    void copyTable(table)
      .then(() => {
        setCopied(true);
        if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {
        // 剪贴板写入失败（权限等）静默忽略，按钮保持原状可重试
      });
  }, []);

  const handleDownload = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const table = event.currentTarget.closest("table");
    if (!table) return;
    downloadTable(table);
  }, []);

  const handleFullscreen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const table = event.currentTarget.closest("table");
    if (!table) return;
    // 克隆并去掉内嵌工具栏：全屏视图里按钮不可用，避免误导
    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.querySelectorAll(".md-th-toolbar").forEach((node) => node.remove());
    setFullscreenHtml(clone.outerHTML);
  }, []);

  return (
    <>
      <span className="md-th-toolbar">
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? t("markdown.copied") : t("markdown.copyTable")}
          aria-label={copied ? t("markdown.copied") : t("markdown.copyTable")}
        >
          {copied ? <Check size={15} strokeWidth={2} /> : <Copy size={15} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          onClick={handleDownload}
          title={t("markdown.downloadTable")}
          aria-label={t("markdown.downloadTable")}
        >
          <Download size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={handleFullscreen}
          title={t("markdown.tableFullscreen")}
          aria-label={t("markdown.tableFullscreen")}
        >
          <Maximize2 size={15} strokeWidth={1.8} />
        </button>
      </span>

      <Dialog
        open={fullscreenHtml !== null}
        onClose={() => setFullscreenHtml(null)}
        title={t("markdown.tableFullscreen")}
        className="max-w-[1100px]"
      >
        {fullscreenHtml ? (
          <div
            className="md md-table-fullscreen overflow-y-auto"
            // 表格 DOM 的克隆（本地渲染结果，不含脚本），用于全屏查看
            dangerouslySetInnerHTML={{ __html: fullscreenHtml }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
