import { Download, ExternalLink, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { GithubIcon } from "@/components/shared/github-icon";
import { Markdown } from "@/components/shared/markdown";
import { GITHUB_REPO_URL, openExternal } from "@/lib/app";
import { useT } from "@/lib/i18n/use-i18n";
import { Button } from "@/components/ui/button";
import type { ReleaseInfo, UpdateCheckState } from "./use-update-check";

function formatPublishedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

/**
 * 更新检查模态框：
 * - 启动静默检查发现新版本时弹出（仅 release 链接，不做自动下载）
 * - 设置关于页手动检查时展示完整检查状态
 */
export function UpdateDialog({
  open,
  state,
  onClose,
}: {
  open: boolean;
  state: UpdateCheckState;
  onClose: () => void;
}) {
  const t = useT();
  const release: ReleaseInfo | null =
    state.phase === "available" ? state.release : null;
  const publishedAt = release ? formatPublishedAt(release.publishedAt) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("update.title")}
      description={
        state.phase === "available"
          ? t("update.availableVersion", { version: release?.name ?? release?.tagName ?? "" })
          : undefined
      }
      className="max-w-[480px]"
      footer={
        state.phase === "available" ? (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("update.later")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => openExternal(release?.htmlUrl ?? GITHUB_REPO_URL)}
            >
              <Download size={13} />
              {t("update.download")}
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t("ui.close")}
            </Button>
          </div>
        )
      }
    >
      {state.phase === "checking" ? (
        <div className="flex items-center gap-2 py-2 text-[12.5px] text-ink-soft">
          <Loader2 size={15} className="animate-spin text-ink-faint" />
          {t("update.checking")}
        </div>
      ) : null}

      {state.phase === "upToDate" ? (
        <div className="flex items-start gap-3 py-1">
          <GithubIcon size={18} className="mt-0.5 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("update.upToDate")}</p>
            <button
              type="button"
              onClick={() => openExternal(GITHUB_REPO_URL)}
              className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline"
            >
              GitHub Releases
              <ExternalLink size={11} />
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <p className="py-1 text-[12.5px] leading-relaxed text-ink-soft">{t("update.failed")}</p>
      ) : null}

      {state.phase === "available" && release ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/5 px-3 py-2.5">
            <GithubIcon size={16} className="text-brand" />
            <span className="font-mono text-[12.5px] font-medium text-ink">{release.tagName}</span>
            {publishedAt ? (
              <span className="ml-auto text-[11px] text-ink-faint">
                {t("update.publishedAt", { date: publishedAt })}
              </span>
            ) : null}
          </div>
          {release.body ? (
            <div className="max-h-[260px] overflow-y-auto rounded-md border border-line bg-elevated/40 px-3 py-2.5">
              <p className="mb-1 text-[11px] font-medium text-ink-soft">{t("update.notes")}</p>
              <Markdown content={release.body} className="text-[11.5px]" />
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => openExternal(release.htmlUrl)}
            className="inline-flex items-center gap-1 text-[11.5px] text-brand hover:underline"
          >
            {t("update.viewRelease")}
            <ExternalLink size={11} />
          </button>
        </div>
      ) : null}
    </Dialog>
  );
}
