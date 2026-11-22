import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProviderProfilesView } from "@motive/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import { translateApiError } from "@/lib/i18n/errors";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { cn } from "@/lib/utils";

const labelClass = "text-[11.5px] font-medium text-ink-soft";

/**
 * 讨论模型选择：直接放在设置页「模型服务」分区（不进添加模型的模态框）。
 * 默认「跟随主模型」，也可指定某个已存配置专门用于讨论对话；
 * 题解、详解与拍照识别始终使用主模型。切换即时保存生效。
 */
export function ChatModelSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const t = useT();
  const [profiles, setProfiles] = useState<ProviderProfilesView | null>(null);
  /** 讨论模型覆盖：undefined 表示尚未加载完成 */
  const [chatProfileId, setChatProfileId] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // refreshKey 变化（模态框保存/切换配置后关闭）时重新拉取
  useEffect(() => {
    let cancelled = false;
    api
      .getProviderProfiles()
      .then((next) => {
        if (!cancelled) setProfiles(next);
      })
      .catch(() => {
        if (!cancelled) setProfiles(null);
      });
    api
      .getChatModelSetting()
      .then((setting) => {
        if (!cancelled) setChatProfileId(setting.profileId);
      })
      .catch(() => {
        if (!cancelled) setChatProfileId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleChatModelChange = useCallback(
    async (profileId: string | null) => {
      if (saving || chatProfileId === profileId) return;
      setSaving(true);
      setError(null);
      try {
        const next = await api.saveChatModelSetting({ profileId });
        setChatProfileId(next.profileId);
      } catch (saveError) {
        if (saveError instanceof Error) setError(translateApiError(t, saveError));
        else setError(t("settings.operationFailed" as DictionaryKey));
      } finally {
        setSaving(false);
      }
    },
    [chatProfileId, saving, t],
  );

  return (
    <div className="space-y-1.5 rounded-md border border-line bg-sidebar/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass}>{t("settings.chatModelLabel")}</span>
        {saving ? <Loader2 size={12} className="animate-spin text-ink-faint" /> : null}
      </div>
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label={t("settings.chatModelLabel")}
      >
        <button
          type="button"
          role="radio"
          aria-checked={chatProfileId === null}
          onClick={() => void handleChatModelChange(null)}
          className={cn(
            "inline-flex h-7 items-center rounded-md border px-2 text-[11.5px] transition-colors",
            chatProfileId === null
              ? "border-brand/50 bg-brand/5 text-ink"
              : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
          )}
        >
          {t("settings.chatModelFollow")}
        </button>
        {(profiles?.profiles ?? []).map((profile) => (
          <button
            key={profile.config.id}
            type="button"
            role="radio"
            aria-checked={chatProfileId === profile.config.id}
            onClick={() => void handleChatModelChange(profile.config.id)}
            title={profile.config.model}
            className={cn(
              "inline-flex h-7 items-center rounded-md border px-2 text-[11.5px] transition-colors",
              chatProfileId === profile.config.id
                ? "border-brand/50 bg-brand/5 text-ink"
                : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
            )}
          >
            {profile.config.name}
          </button>
        ))}
      </div>
      <span className="block text-[11px] leading-relaxed text-ink-faint">
        {t("settings.chatModelHint")}
      </span>
      {error ? <span className="block text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
