import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";

/**
 * RAG（检索增强问答）入口弹窗：
 * 功能尚未上线，展示服务端状态与规划说明，占位承接后续检索问答能力。
 */
export function RagDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEnabled(null);
    api
      .getRagStatus()
      .then((status) => {
        if (!cancelled) setEnabled(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} title={t("rag.title")} className="max-w-[480px]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
          <BookMarked size={18} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("rag.description")}</p>
          <p className="rounded-md border border-line bg-elevated/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
            {t("rag.preparing")}
          </p>
          <p className="text-[11px] text-ink-faint">
            {enabled === null
              ? t("rag.statusUnavailable")
              : enabled
                ? t("rag.statusReady")
                : t("rag.statusPreparing")}
          </p>
        </div>
      </div>
    </Dialog>
  );
}
