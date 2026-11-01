import { useState } from "react";
import {
  ArrowLeft,
  Languages,
  Monitor,
  Moon,
  Server,
  Sparkles,
  Sun,
} from "lucide-react";
import type { UiLanguage } from "@motive/shared";
import { useThemeStore } from "@/stores/theme";
import { usePreferencesStore } from "@/stores/preferences";
import { useUiStore } from "@/stores/ui";
import { useT } from "@/lib/i18n/use-i18n";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { cn } from "@/lib/utils";
import { PromptsSettings } from "./prompts-settings";
import { ProviderSettingsForm } from "./provider-settings-form";

type SectionId = "general" | "prompts" | "provider";

const SECTIONS: Array<{
  id: SectionId;
  labelKey: DictionaryKey;
  icon: typeof Languages;
}> = [
  { id: "general", labelKey: "settings.sectionGeneral", icon: Languages },
  { id: "prompts", labelKey: "settings.sectionPrompts", icon: Sparkles },
  { id: "provider", labelKey: "settings.sectionProvider", icon: Server },
];

const LANGUAGE_OPTIONS: Array<{ value: UiLanguage; labelKey: DictionaryKey }> = [
  { value: "zh-CN", labelKey: "settings.languageZh" },
  { value: "en", labelKey: "settings.languageEn" },
];

const THEME_OPTIONS: Array<{
  mode: "light" | "dark" | "system";
  labelKey: DictionaryKey;
  icon: typeof Sun;
}> = [
  { mode: "light", labelKey: "theme.light", icon: Sun },
  { mode: "dark", labelKey: "theme.dark", icon: Moon },
  { mode: "system", labelKey: "theme.system", icon: Monitor },
];

const sectionHeadingClass = "text-[13px] font-semibold text-ink";
const hintClass = "text-[11px] leading-relaxed text-ink-faint";

/** 通用：界面语言 + 主题模式 */
function GeneralSettings() {
  const t = useT();
  const language = usePreferencesStore((state) => state.language);
  const setLanguage = usePreferencesStore((state) => state.setLanguage);
  const themeMode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setMode);

  return (
    <div className="space-y-6">
      <section className="space-y-2.5" aria-label={t("settings.languageLabel")}>
        <h2 className={sectionHeadingClass}>{t("settings.languageLabel")}</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("settings.languageLabel")}>
          {LANGUAGE_OPTIONS.map(({ value, labelKey }) => {
            const active = language === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setLanguage(value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] transition-colors",
                  active
                    ? "border-brand/50 bg-brand/5 font-medium text-ink"
                    : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
                )}
              >
                {t(labelKey)}
                {value === "zh-CN" ? <span className="text-[10px] text-ink-faint">中文</span> : null}
              </button>
            );
          })}
        </div>
        <p className={hintClass}>{t("settings.languageHint")}</p>
      </section>

      <section className="space-y-2.5" aria-label={t("settings.themeLabel")}>
        <h2 className={sectionHeadingClass}>{t("settings.themeLabel")}</h2>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("settings.themeLabel")}>
          {THEME_OPTIONS.map(({ mode, labelKey, icon: Icon }) => {
            const active = themeMode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setThemeMode(mode)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12.5px] transition-colors",
                  active
                    ? "border-brand/50 bg-brand/5 font-medium text-ink"
                    : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
                )}
              >
                <Icon size={13} className={active ? "text-brand" : "text-ink-faint"} />
                {t(labelKey)}
              </button>
            );
          })}
        </div>
        <p className={hintClass}>{t("settings.themeHint")}</p>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const t = useT();
  const closeSettings = useUiStore((state) => state.closeSettings);
  const [section, setSection] = useState<SectionId>("general");

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-surface text-ink">
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3 md:px-4">
        <button
          type="button"
          onClick={closeSettings}
          aria-label={t("settings.backAria")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-selection hover:text-ink"
        >
          <ArrowLeft size={16} strokeWidth={1.8} />
        </button>
        <span className="text-[13.5px] font-semibold">{t("settings.pageTitle")}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand text-[12px] font-bold text-white dark:text-[#062b27]">
            M
          </span>
          <span className="text-[12px] font-medium text-ink-soft">Motive Studio</span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* 桌面端左侧导航 */}
        <nav
          className="hidden w-[196px] shrink-0 flex-col gap-1 border-r border-line bg-sidebar p-2 md:flex"
          aria-label={t("settings.navAria")}
        >
          {SECTIONS.map(({ id, labelKey, icon: Icon }) => {
            const active = section === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-md px-3 text-[12.5px] transition-colors",
                  active
                    ? "bg-selection font-medium text-ink"
                    : "text-ink-soft hover:bg-selection/60 hover:text-ink",
                )}
              >
                <Icon size={14} className={active ? "text-brand" : "text-ink-faint"} />
                {t(labelKey)}
              </button>
            );
          })}
        </nav>

        {/* 移动端横向分区 tab */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden"
            role="tablist"
            aria-label={t("settings.navAria")}
          >
            {SECTIONS.map(({ id, labelKey, icon: Icon }) => {
              const active = section === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSection(id)}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12px] transition-colors",
                    active
                      ? "border-brand/50 bg-brand/5 font-medium text-ink"
                      : "border-line bg-field text-ink-soft",
                  )}
                >
                  <Icon size={13} className={active ? "text-brand" : "text-ink-faint"} />
                  {t(labelKey)}
                </button>
              );
            })}
          </div>

          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[640px] space-y-5 px-4 py-6">
              {section === "general" ? <GeneralSettings /> : null}
              {section === "prompts" ? <PromptsSettings /> : null}
              {section === "provider" ? <ProviderSettingsForm /> : null}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
