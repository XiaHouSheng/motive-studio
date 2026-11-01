import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
} from "lucide-react";
import type {
  CredentialStorageMode,
  ProviderConfig,
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
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

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
    [persist, t],
  );

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
      setNotice(t("settings.keyCleared"));
    } catch (clearError) {
      setError(describeError(t, clearError));
    } finally {
      setSaving(false);
    }
  }, [buildProvider, t]);

  const hasApiKey = view?.hasApiKey ?? false;

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
