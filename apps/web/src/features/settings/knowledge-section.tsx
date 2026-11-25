import { useEffect, useState } from "react";
import { BookMarked } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";

/**
 * 「知识库」设置区：后续 RAG（检索增强问答）能力的配置入口。
 * 当前功能尚未上线，展示服务端状态与规划说明；
 * 后续索引构建、检索问答开关与重建索引等操作在此扩展。
 */
export function KnowledgeSection() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2.5" aria-label={t("settings.sectionKnowledge")}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
            <BookMarked size={17} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold text-ink">{t("settings.knowledgeTitle")}</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
              {t("settings.knowledgeSubtitle")}
            </p>
          </div>
        </div>
        <p className="rounded-md border border-line bg-elevated/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-faint">
          {t("rag.preparing")}
        </p>
        <div className="flex items-center justify-between rounded-md border border-line px-3 py-2">
          <span className="text-[12px] text-ink-soft">{t("settings.knowledgeStatusLabel")}</span>
          <span className="text-[12px] text-ink">
            {enabled === null
              ? t("rag.statusUnavailable")
              : enabled
                ? t("rag.statusReady")
                : t("rag.statusPreparing")}
          </span>
        </div>
      </section>
    </div>
  );
}
