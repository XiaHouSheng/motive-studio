import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import type {
  CredentialStorageMode,
  ProviderConfig,
  ProviderProfileSummary,
  ProviderProfilesView,
  ProviderSettingsView,
  ProviderTestResult,
} from "@motive/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { useT } from "@/lib/i18n/use-i18n";
import { translateApiError } from "@/lib/i18n/errors";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  baseUrl: string;
  model: string;
  temperature: string;
  maxTokens: string;
  supportsVision: boolean;
}

interface ProviderPreset {
  name: string;
  baseUrl: string;
  model: string;
  /** 模型是否支持图片输入（拍照导入识别需要） */
  vision?: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  baseUrl: "",
  model: "",
  temperature: "",
  maxTokens: "",
  supportsVision: true,
};

/** 常用服务商预设：仅填入名称/地址/模型，API Key 需用户自行填写 */
const PROVIDER_PRESETS: ProviderPreset[] = [
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  {
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
    vision: true,
  },
  {
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4v-flash",
    vision: true,
  },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", vision: true },
];

/** 密钥在本机的存储方式（服务端按平台选择，仅展示名称、不含路径） */
const STORAGE_LABELS: Record<CredentialStorageMode, DictionaryKey> = {
  dpapi: "settings.storageDpapi",
  keychain: "settings.storageKeychain",
  "secret-service": "settings.storageSecretService",
  "encrypted-file": "settings.storageEncryptedFile",
};

const inputClass =
  "h-8 w-full rounded-md border border-line bg-field px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50";
const labelClass = "text-[11.5px] font-medium text-ink-soft";

function toForm(provider: ProviderConfig): FormState {
  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    temperature:
      provider.temperature === undefined ? "" : String(provider.temperature),
    maxTokens: provider.maxTokens === undefined ? "" : String(provider.maxTokens),
    supportsVision: provider.supportsVision !== false,
  };
}

/**
 * 把错误转换为用户提示：ApiError 按错误码词条翻译（未知码保留服务端消息），
 * 普通 Error 保留原始 message，其余值展示固定兜底词条。
 */
function describeError(
  t: (key: DictionaryKey) => string,
  error: unknown,
): string {
  if (error instanceof Error) return translateApiError(t, error);
  return t("settings.operationFailed");
}

/**
 * 模型服务设置表单（原 ProviderSettingsDialog 的表单体）。
 * 加载、校验、保存、测试连接、脱敏展示与错误提示行为与原对话框完全一致，
 * 仅去掉 Dialog 外壳，供设置页「模型服务」分区嵌入。
 */
export function ProviderSettingsForm() {
  const t = useT();

  const [view, setView] = useState<ProviderSettingsView | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);
  const [profiles, setProfiles] = useState<ProviderProfilesView | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  /** 讨论模型覆盖：undefined 表示尚未加载完成 */
  const [chatProfileId, setChatProfileId] = useState<string | null | undefined>(undefined);
  const [chatModelSaving, setChatModelSaving] = useState(false);

  const refreshProfiles = useCallback(() => {
    api
      .getProviderProfiles()
      .then((next) => setProfiles(next))
      .catch(() => setProfiles(null));
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    setApiKey("");
    setActivePreset(null);

    api
      .getProviderSettings()
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setForm(toForm(next.provider));
      })
      .catch((loadError) => {
        if (!cancelled) setError(describeError(t, loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const updateField = useCallback(
    (field: keyof FormState, value: string) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      if (field === "name" || field === "baseUrl" || field === "model") {
        setActivePreset(null);
      }
      setNotice(null);
      setError(null);
      setTestResult(null);
    },
    [],
  );

  const applyPreset = useCallback((preset: ProviderPreset) => {
    setForm((prev) => ({
      ...prev,
      name: preset.name,
      baseUrl: preset.baseUrl,
      model: preset.model,
      supportsVision: preset.vision === true,
    }));
    setActivePreset(preset.name);
    setNotice(null);
    setError(null);
    setTestResult(null);
  }, []);

  /** 表单相对当前已保存配置是否有未保存修改（切换配置前提示用） */
  const isFormDirty = useCallback((): boolean => {
    if (!view) return false;
    const baseline = toForm(view.provider);
    return (Object.keys(baseline) as Array<keyof FormState>).some(
      (key) => baseline[key] !== form[key],
    );
  }, [form, view]);

  const handleSwitchProfile = useCallback(
    async (profile: ProviderProfileSummary) => {
      if (profile.isActive || profileBusy) return;
      if (isFormDirty() && !window.confirm(t("settings.profileSwitchDirtyConfirm"))) return;

      setProfileBusy(true);
      setError(null);
      setNotice(null);
      setTestResult(null);
      try {
        const next = await api.switchProviderProfile(profile.config.id);
        setView(next);
        setForm(toForm(next.provider));
        setApiKey("");
        setActivePreset(null);
        refreshProfiles();
        setNotice(t("settings.profileSwitched", { name: next.provider.name }));
      } catch (switchError) {
        setError(describeError(t, switchError));
      } finally {
        setProfileBusy(false);
      }
    },
    [isFormDirty, profileBusy, refreshProfiles, t],
  );

  /** 切换讨论模型覆盖（null = 跟随主模型），立即保存生效 */
  const handleChatModelChange = useCallback(
    async (profileId: string | null) => {
      if (chatModelSaving || chatProfileId === profileId) return;
      setChatModelSaving(true);
      setError(null);
      setNotice(null);
      try {
        const next = await api.saveChatModelSetting({ profileId });
        setChatProfileId(next.profileId);
        const name = (profiles?.profiles ?? []).find(
          (profile) => profile.config.id === next.profileId,
        )?.config.name;
        setNotice(
          name
            ? t("settings.chatModelSaved", { name })
            : t("settings.chatModelFollowSaved"),
        );
      } catch (saveError) {
        setError(describeError(t, saveError));
      } finally {
        setChatModelSaving(false);
      }
    },
    [chatModelSaving, chatProfileId, profiles, t],
  );

  const handleDeleteProfile = useCallback(
    async (profile: ProviderProfileSummary) => {
      if (profile.isActive || profileBusy) return;
      if (!window.confirm(t("settings.profileDeleteConfirm", { name: profile.config.name }))) {
        return;
      }

      setProfileBusy(true);
      setError(null);
      setNotice(null);
      try {
        const next = await api.deleteProviderProfile(profile.config.id);
        setProfiles(next);
        setNotice(t("settings.profileDeleted", { name: profile.config.name }));
      } catch (deleteError) {
        setError(describeError(t, deleteError));
      } finally {
        setProfileBusy(false);
      }
    },
    [profileBusy, t],
  );

  const buildProvider = useCallback((): ProviderConfig | null => {
    if (!form.name.trim()) {
      setError(t("settings.nameRequired"));
      return null;
    }
    if (!form.baseUrl.trim()) {
      setError(t("settings.baseUrlRequired"));
      return null;
    }
    if (!form.model.trim()) {
      setError(t("settings.modelRequired"));
      return null;
    }

    let temperature: number | undefined;
    if (form.temperature.trim() !== "") {
      temperature = Number(form.temperature);
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        setError(t("settings.temperatureInvalid"));
        return null;
      }
    }

    let maxTokens: number | undefined;
    if (form.maxTokens.trim() !== "") {
      maxTokens = Number(form.maxTokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1) {
        setError(t("settings.maxTokensInvalid"));
        return null;
      }
    }

    return {
      id: view?.provider.id ?? "default",
      name: form.name.trim(),
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      protocol: "openai-chat-completions",
      temperature,
      maxTokens,
      supportsVision: form.supportsVision,
    };
  }, [form, view, t]);

  const persist = useCallback(async () => {
    const provider = buildProvider();
    if (!provider) return null;

    const next = await api.saveProviderSettings({
      provider,
      apiKey: apiKey.trim() || undefined,
    });
    setView(next);
    setForm(toForm(next.provider));
    setApiKey("");
    return next;
  }, [apiKey, buildProvider]);

  const handleSave = useCallback(
    async (withTest: boolean) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      setTestResult(null);

      try {
        const saved = await persist();
        if (!saved) return;
        refreshProfiles();

        if (withTest) {
          const result = await api.testProvider();
          setTestResult(result);
        } else {
          setNotice(t("settings.saved"));
        }
      } catch (saveError) {
        setError(describeError(t, saveError));
      } finally {
        setSaving(false);
      }
    },
    [persist, refreshProfiles, t],
  );

  /** 以表单当前内容另存为新配置（名称取表单服务名称，重名由客户端预检 + 服务端兜底） */
  const handleSaveAsNewProfile = useCallback(async () => {
    const provider = buildProvider();
    if (!provider) return;
    const name = provider.name;
    if (profiles?.profiles.some((profile) => profile.config.name === name)) {
      setError(t("settings.profileDuplicateName", { name }));
      return;
    }

    setProfileBusy(true);
    setError(null);
    setNotice(null);
    setTestResult(null);
    try {
      const next = await api.saveProviderProfile({ name, provider });
      setView(next);
      setForm(toForm(next.provider));
      setApiKey("");
      setActivePreset(null);
      refreshProfiles();
      setNotice(t("settings.profileSavedNew", { name: next.provider.name }));
    } catch (saveError) {
      setError(describeError(t, saveError));
    } finally {
      setProfileBusy(false);
    }
  }, [buildProvider, profiles, refreshProfiles, t]);

  const handleClearKey = useCallback(async () => {
    const provider = buildProvider();
    if (!provider) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    setTestResult(null);

    try {
      const next = await api.saveProviderSettings({
        provider,
        clearApiKey: true,
      });
      setView(next);
      setApiKey("");
      refreshProfiles();
      setNotice(t("settings.keyCleared"));
    } catch (clearError) {
      setError(describeError(t, clearError));
    } finally {
      setSaving(false);
    }
  }, [buildProvider, refreshProfiles, t]);

  const hasApiKey = view?.hasApiKey ?? false;
  /** 额外设置是否偏离默认值：折叠状态下给出「已自定义」提醒，避免隐藏字段被遗忘 */
  const advancedCustomized =
    form.temperature.trim() !== "" || form.maxTokens.trim() !== "" || !form.supportsVision;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-ink-faint">
          {view
            ? t("settings.keyStorageLabel", {
                storage: t(STORAGE_LABELS[view.credentialStorage]),
              })
            : t("settings.keyStorageFallback")}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleSave(true)}
            disabled={saving || loading}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("settings.saveAndTest")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave(false)}
            disabled={saving || loading}
          >
            {t("settings.save")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[12px] text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
          {t("settings.loading")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={labelClass}>{t("settings.profilesLabel")}</span>
              <button
                type="button"
                onClick={() => void handleSaveAsNewProfile()}
                disabled={profileBusy || loading}
                title={t("settings.profileSaveAsNewHint")}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-field px-2 text-[11px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus size={12} />
                {t("settings.profileSaveAsNew")}
              </button>
            </div>
            {profiles && profiles.profiles.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {profiles.profiles.map((profile) => (
                  <div key={profile.config.id} className="group/profile relative">
                    <button
                      type="button"
                      onClick={() => void handleSwitchProfile(profile)}
                      disabled={profileBusy || loading || profile.isActive}
                      title={`${profile.config.name} · ${profile.config.model}`}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors",
                        profile.isActive
                          ? "border-brand/50 bg-brand/5 text-ink disabled:cursor-default"
                          : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink disabled:cursor-not-allowed",
                      )}
                    >
                      {profile.config.name}
                      <span className="max-w-[120px] truncate text-[10px] text-ink-faint">
                        {profile.config.model}
                      </span>
                      {profile.config.supportsVision !== false ? (
                        <span className="rounded bg-brand/10 px-1 text-[10px] leading-4 text-brand">
                          {t("settings.visionBadge")}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          profile.hasApiKey ? "bg-success" : "bg-warning",
                        )}
                        title={profile.hasApiKey ? t("settings.profileKeyOk") : t("settings.profileKeyMissing")}
                      />
                    </button>
                    {!profile.isActive ? (
                      <button
                        type="button"
                        onClick={() => void handleDeleteProfile(profile)}
                        aria-label={t("settings.profileDeleteAria", { name: profile.config.name })}
                        className="absolute -right-1.5 -top-1.5 hidden h-4 w-4 items-center justify-center rounded-full border border-line bg-elevated text-ink-faint transition-colors hover:border-danger/40 hover:text-danger group-hover/profile:flex"
                      >
                        <X size={10} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            <span className="block text-[11px] text-ink-faint">
              {t("settings.profilesHint")}
            </span>
          </div>

          <div className="space-y-1.5 rounded-md border border-line bg-sidebar/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={labelClass}>{t("settings.chatModelLabel")}</span>
              {chatModelSaving ? (
                <Loader2 size={12} className="animate-spin text-ink-faint" />
              ) : null}
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
            <span className="block text-[11px] text-ink-faint">
              {t("settings.chatModelHint")}
            </span>
          </div>

          <div className="space-y-1.5">
            <span className={labelClass}>{t("settings.presetsLabel")}</span>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors",
                    activePreset === preset.name
                      ? "border-brand/50 bg-brand/5 text-ink"
                      : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
                  )}
                >
                  {preset.name}
                  {preset.vision ? (
                    <span className="rounded bg-brand/10 px-1 text-[10px] leading-4 text-brand">
                      {t("settings.visionBadge")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <span className="block text-[11px] text-ink-faint">
              {t("settings.presetsHint")}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelClass}>{t("settings.nameLabel")}</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder={t("settings.namePlaceholder")}
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>{t("settings.modelLabel")}</span>
              <input
                className={inputClass}
                value={form.model}
                onChange={(event) => updateField("model", event.target.value)}
                placeholder={t("settings.modelPlaceholder")}
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className={labelClass}>Base URL</span>
            <input
              className={inputClass}
              value={form.baseUrl}
              onChange={(event) => updateField("baseUrl", event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <span className="block text-[11px] text-ink-faint">
              {t("settings.baseUrlHint")}
            </span>
          </label>

          {/* 额外设置默认折叠：必填项只有名称 / 模型 / Base URL / API Key */}
          <button
            type="button"
            onClick={() => setAdvancedOpen((value) => !value)}
            aria-expanded={advancedOpen}
            className="inline-flex w-full items-center gap-1.5 rounded-md border border-line bg-field/60 px-3 py-2 text-[11.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink"
          >
            <ChevronDown
              size={13}
              className={cn("transition-transform duration-150", advancedOpen && "rotate-180")}
            />
            {t("settings.advancedToggle")}
            {!advancedOpen && advancedCustomized ? (
              <span className="ml-auto rounded bg-brand/10 px-1.5 py-px text-[10px] text-brand">
                {t("settings.advancedCustomized")}
              </span>
            ) : null}
          </button>

          {advancedOpen ? (
            <div className="space-y-3 rounded-md border border-line bg-sidebar/60 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className={labelClass}>{t("settings.temperatureLabel")}</span>
                  <input
                    className={inputClass}
                    value={form.temperature}
                    onChange={(event) => updateField("temperature", event.target.value)}
                    inputMode="decimal"
                    placeholder="0.5"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className={labelClass}>{t("settings.maxTokensLabel")}</span>
                  <input
                    className={inputClass}
                    value={form.maxTokens}
                    onChange={(event) => updateField("maxTokens", event.target.value)}
                    inputMode="numeric"
                    placeholder={t("settings.maxTokensPlaceholder")}
                  />
                </label>
              </div>

              <label className="flex items-start gap-2.5 rounded-md border border-line bg-field px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5 accent-brand"
                  checked={form.supportsVision}
                  onChange={(event) => {
                    setForm((prev) => ({ ...prev, supportsVision: event.target.checked }));
                    setNotice(null);
                    setError(null);
                    setTestResult(null);
                  }}
                />
                <span className="space-y-0.5">
                  <span className={labelClass}>{t("settings.supportsVisionLabel")}</span>
                  <span className="block text-[11px] leading-relaxed text-ink-faint">
                    {t("settings.supportsVisionHint")}
                  </span>
                </span>
              </label>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={labelClass}>API Key</span>
              <Badge tone={hasApiKey ? "success" : "warning"}>
                {hasApiKey ? t("settings.keyConfigured") : t("settings.keyNotConfigured")}
              </Badge>
            </div>
            <div className="relative">
              <KeyRound
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                className={cn(inputClass, "pl-7")}
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  setNotice(null);
                  setError(null);
                  setTestResult(null);
                }}
                placeholder={hasApiKey ? t("settings.keyPlaceholderKeep") : "sk-..."}
                autoComplete="off"
              />
            </div>
            {hasApiKey && view ? (
              <div className="space-y-1 rounded-md border border-line bg-field/60 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[12px] text-ink">
                    <KeyRound size={12} className="text-brand" />
                    {view.apiKeyMasked ?? "••••••••"}
                  </span>
                  <span className="text-[10.5px] text-ink-faint">
                    {view.apiKeySavedAt
                      ? t("settings.keySavedAt", { time: formatTime(view.apiKeySavedAt) })
                      : t("settings.keyEncrypted")}
                  </span>
                </div>
                <span className="block text-[11px] text-ink-faint">
                  {t("settings.keyInfoPrefix", { name: view.provider.name })}
                  {t(STORAGE_LABELS[view.credentialStorage])}
                  {t("settings.keyInfoSuffix")}
                </span>
              </div>
            ) : null}
            {hasApiKey ? (
              <button
                type="button"
                onClick={() => void handleClearKey()}
                disabled={saving}
                className="text-[11px] text-danger transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {t("settings.clearKey")}
              </button>
            ) : null}
          </div>

          {view?.credentialIssue ? (
            <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{view.credentialIssue}</span>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {notice ? (
            <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11.5px] text-success">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span>{notice}</span>
            </div>
          ) : null}

          {testResult ? (
            <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-[11.5px] text-success">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              <span>
                {t("settings.testSuccess", {
                  model: testResult.model,
                  latencyMs: testResult.latencyMs,
                })}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
