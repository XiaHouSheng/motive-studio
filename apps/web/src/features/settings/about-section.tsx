import { useEffect, useState } from "react";
import { ExternalLink, Info } from "lucide-react";
import { GithubIcon } from "@/components/shared/github-icon";
import { api } from "@/lib/api";
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL, openExternal } from "@/lib/app";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

interface AppInfo {
  name: string;
  version: string;
  repoUrl: string;
}

const hintClass = "text-[11px] leading-relaxed text-ink-faint";

/**
 * 「关于」设置区：应用信息、版本、GitHub 跳转与检查更新入口。
 * 检查更新按钮由 use-update-check 提供能力（发现新版本时弹出更新模态框）。
 */
export function AboutSection({ onUpdateCheck }: { onUpdateCheck?: () => void }) {
  const t = useT();
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAppInfo()
      .then((view) => {
        if (!cancelled) setInfo(view);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-label={t("settings.sectionAbout")}>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-[22px] font-bold text-white dark:text-[#062b27]">
            M
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              {info?.name ?? "Motive Studio"}
              <Info size={13} className="text-ink-faint" />
            </h2>
            <p className={cn("mt-0.5", hintClass)}>{t("settings.aboutTagline")}</p>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border border-line bg-elevated/40 px-3 py-2">
          <span className="text-[12px] text-ink-soft">{t("settings.aboutVersionLabel")}</span>
          <span className="font-mono text-[12px] tabular-nums text-ink">
            {info?.version ?? t("settings.aboutVersionUnknown")}
          </span>
        </div>
        <p className={hintClass}>{t("settings.aboutDesc")}</p>
        <p className={hintClass}>{t("settings.aboutTech")}</p>
      </section>

      <section className="space-y-2.5" aria-label={t("settings.aboutLinks")}>
        <h2 className="text-[13px] font-semibold text-ink">{t("settings.aboutLinks")}</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => openExternal(info?.repoUrl ?? GITHUB_REPO_URL)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink"
          >
            <GithubIcon size={14} />
            {t("settings.aboutGithub")}
            <ExternalLink size={11} className="text-ink-faint" />
          </button>
          <button
            type="button"
            onClick={() => openExternal(GITHUB_ISSUES_URL)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink"
          >
            {t("settings.aboutIssues")}
            <ExternalLink size={11} className="text-ink-faint" />
          </button>
        </div>
      </section>

      {onUpdateCheck ? (
        <section className="space-y-2.5" aria-label={t("settings.updateSection")}>
          <h2 className="text-[13px] font-semibold text-ink">{t("settings.updateSection")}</h2>
          <div>
            <button
              type="button"
              onClick={onUpdateCheck}
              className="inline-flex h-8 items-center rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink"
            >
              {t("settings.checkUpdate")}
            </button>
          </div>
          <p className={hintClass}>{t("settings.checkUpdateHint")}</p>
        </section>
      ) : null}
    </div>
  );
}
