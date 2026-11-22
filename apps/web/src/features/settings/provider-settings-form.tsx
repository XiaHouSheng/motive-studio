import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
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
import { Dialog } from "@/components/ui/dialog";
import { ChatModelSection } from "./chat-model-selector";
import { api } from "@/lib/api";
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

function buildProviderPayload(form: FormState): ProviderConfig {
  return {
    // add 模式下 id 由服务端生成；edit 模式由调用方以目标配置 id 覆盖
    id: "new",
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    protocol: "openai-chat-completions",
    temperature: form.temperature.trim() === "" ? undefined : Number(form.temperature),
    maxTokens: form.maxTokens.trim() === "" ? undefined : Number(form.maxTokens),
    supportsVision: form.supportsVision,
  };
}

interface PastedProvider {
  name?: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

/** 从 config 对象中提取 Base URL / Key / 模型（兼容 cc-switch 的多种形态） */
function extractFromConfigObject(config: Record<string, unknown>):
  | Omit<PastedProvider, "name">
  | null {
  const env = config.env;
  const envMap =
    env && typeof env === "object" ? (env as Record<string, unknown>) : undefined;
  const baseUrl =
    envMap?.ANTHROPIC_BASE_URL ??
    envMap?.OPENAI_BASE_URL ??
    config.baseUrl ??
    config.base_url ??
    (typeof config.config === "string"
      ? /^\s*base_url\s*=\s*"([^"]+)"/m.exec(config.config)?.[1]
      : undefined);
  if (typeof baseUrl !== "string" || !baseUrl.trim()) return null;

  const auth = config.auth;
  const authMap =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>) : undefined;
  const apiKey =
    (authMap
      ? Object.values(authMap).find(
          (value) => typeof value === "string" && value.trim().length >= 8,
        )
      : undefined) ??
    envMap?.ANTHROPIC_AUTH_TOKEN ??
    envMap?.OPENAI_API_KEY ??
    config.apiKey;
  const model = (typeof config.config === "string"
    ? /^\s*model\s*=\s*"([^"]+)"/m.exec(config.config)?.[1]
    : undefined) ?? envMap?.ANTHROPIC_MODEL ?? config.model;

  return {
    baseUrl: baseUrl.trim(),
    apiKey: typeof apiKey === "string" ? apiKey.trim() : undefined,
    model: typeof model === "string" ? model.trim() : undefined,
  };
}

/** 递归收集粘贴内容里所有可识别的配置（数组 / providers 映射 / 单对象均可） */
function collectPastedProviders(node: unknown, out: PastedProvider[], depth: number): void {
  if (depth > 6 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectPastedProviders(item, out, depth + 1);
    return;
  }
  const extracted = extractFromConfigObject(node as Record<string, unknown>);
  if (extracted) {
    const name =
      typeof (node as Record<string, unknown>).name === "string"
        ? ((node as Record<string, unknown>).name as string).trim()
        : undefined;
    out.push({ name, ...extracted });
    return; // 命中配置对象后不再深入，避免重复提取
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectPastedProviders(value, out, depth + 1);
  }
}

/** 解析用户粘贴的配置文本（cc-switch 复制的 JSON / 自定义 JSON 对象 / 数组） */
export function parsePastedProviders(text: string): PastedProvider[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const out: PastedProvider[] = [];
  collectPastedProviders(parsed, out, 0);
  // 按名称 + Base URL 去重
  const seen = new Set<string>();
  return out.filter((item) => {
    const key = `${item.name ?? ""}|${item.baseUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface ProviderSettingsFormProps {
  /** add = 新建（保存即创建并启用）；edit = 编辑指定配置（Key 沿用原值） */
  mode: "add" | "edit";
  /** edit 模式的目标配置 */
  profile?: ProviderProfileSummary;
  /** 保存成功后的回调（编辑模式：保存后由父级关闭模态框） */
  onSaved?: () => void;
  /** CCSWITCH 复制导入成功后的回调（父级刷新配置列表） */
  onImported?: () => void;
}

/**
 * 模型配置表单（设置页「添加模型 / 编辑配置」模态框内）。
 *
 * - add：表单初始为空，保存 = 创建为新配置并启用（绝不覆盖已有配置）；
 *   API Key 随新配置保存，Base URL 与已有配置相同时可留空自动复制。
 * - edit：预填目标配置，保存原位更新；不展示 Key（沿用原值），
 *   仅提供显式「清除该配置的 API Key」按钮。
 */
export function ProviderSettingsForm({
  mode,
  profile,
  onSaved,
  onImported,
}: ProviderSettingsFormProps) {
  const t = useT();
  const isEdit = mode === "edit" && profile !== undefined;

  const [view, setView] = useState<ProviderSettingsView | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    isEdit && profile ? toForm(profile.config) : EMPTY_FORM,
  );
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<ProviderTestResult | null>(null);

  // 凭据存储信息 / 全局凭据异常提示（读取很快，静默刷新）
  useEffect(() => {
    let cancelled = false;
    api
      .getProviderSettings()
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch(() => {
        if (!cancelled) setView(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "name" || field === "baseUrl" || field === "model") {
      setActivePreset(null);
    }
    setNotice(null);
    setError(null);
    setTestResult(null);
  }, []);

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

  /** 自定义：清空表单回到空白草稿 */
  const applyCustom = useCallback(() => {
    setForm(EMPTY_FORM);
    setApiKey("");
    setActivePreset("custom");
    setNotice(null);
    setError(null);
    setTestResult(null);
  }, []);

  /** CCSWITCH 配置导入：从剪贴板读取配置 JSON，复制为新增模型（不改激活状态） */
  const [importing, setImporting] = useState(false);
  const handleCcSwitchImport = useCallback(async () => {
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const text = await navigator.clipboard.readText();
      const parsed = parsePastedProviders(text ?? "");
      if (parsed.length === 0) {
        setError(t("settings.ccSwitchParseFailed"));
        return;
      }
      const providers = parsed.map((item) => ({
        name:
          item.name ||
          (() => {
            try {
              return new URL(item.baseUrl).hostname;
            } catch {
              return t("settings.importDefaultName");
            }
          })(),
        baseUrl: item.baseUrl,
        apiKey: item.apiKey,
        model: item.model,
      }));
      const result = await api.importProviderCopies({ providers });
      setActivePreset("ccswitch");
      setNotice(
        result.skipped.length > 0
          ? t("settings.ccSwitchImportedSkipped", {
              count: String(result.imported.length),
              skipped: String(result.skipped.length),
            })
          : t("settings.ccSwitchImported", { count: String(result.imported.length) }),
      );
      onImported?.();
    } catch (importError) {
      setError(describeError(t, importError));
    } finally {
      setImporting(false);
    }
  }, [onImported, t]);

  /** 额外设置是否偏离默认值：折叠状态下给出「已自定义」提醒，避免隐藏字段被遗忘 */
  const advancedCustomized =
    form.temperature.trim() !== "" || form.maxTokens.trim() !== "" || !form.supportsVision;

  const handleSave = useCallback(
    async (withTest: boolean) => {
      setSaving(true);
      setError(null);
      setNotice(null);
      setTestResult(null);

      try {
        if (isEdit && profile) {
          // 编辑：原位更新目标配置；Key 沿用原值（除非显式清除）
          const next = await api.updateProviderProfile(profile.config.id, {
            provider: { ...buildProviderPayload(form), id: profile.config.id },
          });
          setView(next);
          setNotice(t("settings.updated", { name: next.provider.name }));
          onSaved?.();
        } else {
          // 新建：创建为新配置并启用（重名由服务端校验兜底）
          const next = await api.saveProviderProfile({
            name: form.name.trim(),
            provider: buildProviderPayload(form),
            apiKey: apiKey.trim() || undefined,
          });
          if (withTest) {
            const result = await api.testProvider();
            setTestResult(result);
          } else {
            setNotice(t("settings.profileSavedNew", { name: next.provider.name }));
            onSaved?.();
            // 保存成功后重置草稿，方便连续添加多个模型
            setForm(EMPTY_FORM);
            setApiKey("");
            setActivePreset(null);
          }
          setView(next);
        }
      } catch (saveError) {
        setError(describeError(t, saveError));
      } finally {
        setSaving(false);
      }
    },
    [apiKey, form, isEdit, onSaved, profile, t],
  );

  /** 编辑模式：显式清除该配置已保存的 API Key（沿用语义的反向操作） */
  const handleClearKey = useCallback(async () => {
    if (!profile) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.clearProviderProfileKey(profile.config.id);
      setView(next);
      setNotice(t("settings.keyClearedProfile"));
    } catch (clearError) {
      setError(describeError(t, clearError));
    } finally {
      setSaving(false);
    }
  }, [profile, t]);

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
          {isEdit ? null : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSave(true)}
              disabled={saving}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              {t("settings.saveAndTest")}
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave(false)}
            disabled={saving}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : null}
            {t("settings.save")}
          </Button>
        </div>
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
          <button
            type="button"
            onClick={applyCustom}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors",
              activePreset === "custom"
                ? "border-brand/50 bg-brand/5 text-ink"
                : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
            )}
          >
            {t("settings.presetCustom")}
          </button>
          <button
            type="button"
            onClick={() => void handleCcSwitchImport()}
            disabled={importing}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11.5px] transition-colors",
              activePreset === "ccswitch"
                ? "border-brand/50 bg-brand/5 text-ink"
                : "border-line bg-field text-ink-soft hover:bg-selection hover:text-ink",
              importing && "opacity-60",
            )}
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : null}
            {t("settings.presetCcSwitch")}
          </button>
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

      {isEdit ? (
        /* 编辑模式：不展示 Key 输入，沿用已保存的 Key，仅提供显式清除 */
        <div className="space-y-1.5 rounded-md border border-line bg-sidebar/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className={labelClass}>API Key</span>
            <Badge tone={profile?.hasApiKey ? "success" : "warning"}>
              {profile?.hasApiKey ? t("settings.keyConfigured") : t("settings.keyNotConfigured")}
            </Badge>
          </div>
          <span className="block text-[11px] leading-relaxed text-ink-faint">
            {t("settings.keyKeepNote")}
          </span>
          {profile?.hasApiKey ? (
            <button
              type="button"
              onClick={() => void handleClearKey()}
              disabled={saving}
              className="text-[11px] text-danger transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {t("settings.clearProfileKey")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-1.5">
          <span className={labelClass}>API Key</span>
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
              placeholder="sk-..."
              autoComplete="off"
            />
          </div>
          <span className="block text-[11px] leading-relaxed text-ink-faint">
            {t("settings.keyNewHint")}
          </span>
        </div>
      )}

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
  );
}

const PROFILES_CACHE_KEY = "motive.providerProfiles";

function readProfilesCache(): ProviderProfilesView | null {
  try {
    const raw = window.localStorage.getItem(PROFILES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ProviderProfilesView;
    if (!Array.isArray(parsed.profiles) || typeof parsed.activeId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProfilesCache(view: ProviderProfilesView): void {
  try {
    window.localStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(view));
  } catch {
    // 持久化失败静默忽略：缓存只用于瞬时显示
  }
}

type DialogState = { mode: "add" } | { mode: "edit"; profile: ProviderProfileSummary } | null;

/**
 * 设置页「模型服务」分区：
 * - 已保存配置列表（localStorage 缓存瞬时显示，后台静默刷新），行内切换 / 编辑 / 删除
 * - 讨论模型选择保留在页面
 * - 「添加模型」打开新建模态框，编辑打开预填模态框（不展示 Key）
 */
export function ProviderSettingsSection() {
  const t = useT();
  const [profiles, setProfiles] = useState<ProviderProfilesView | null>(() =>
    readProfilesCache(),
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  /** 模态框关闭 / 列表变化后递增，驱动讨论模型选择器刷新 */
  const [chatModelRefreshKey, setChatModelRefreshKey] = useState(0);
  const dialogWasOpen = useRef(false);

  const refreshProfiles = useCallback(() => {
    api
      .getProviderProfiles()
      .then((next) => {
        setProfiles(next);
        writeProfilesCache(next);
      })
      .catch(() => {
        // 刷新失败保留缓存显示
      });
  }, []);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  // 关闭模态框（保存后）刷新列表与讨论模型选择器
  useEffect(() => {
    if (dialog) {
      dialogWasOpen.current = true;
      return;
    }
    if (!dialogWasOpen.current) return;
    dialogWasOpen.current = false;
    setChatModelRefreshKey((value) => value + 1);
    refreshProfiles();
  }, [dialog, refreshProfiles]);

  const refreshAll = useCallback(() => {
    refreshProfiles();
    setChatModelRefreshKey((value) => value + 1);
  }, [refreshProfiles]);

  const handleSwitchProfile = useCallback(
    async (profile: ProviderProfileSummary) => {
      if (profile.isActive || listBusy) return;
      setListBusy(true);
      setListError(null);
      try {
        await api.switchProviderProfile(profile.config.id);
        refreshAll();
      } catch (switchError) {
        setListError(describeError(t, switchError));
      } finally {
        setListBusy(false);
      }
    },
    [listBusy, refreshAll, t],
  );

  const handleDeleteProfile = useCallback(
    async (profile: ProviderProfileSummary) => {
      if (listBusy) return;
      if (!window.confirm(t("settings.profileDeleteConfirm", { name: profile.config.name }))) {
        return;
      }
      setListBusy(true);
      setListError(null);
      try {
        await api.deleteProviderProfile(profile.config.id);
        refreshAll();
      } catch (deleteError) {
        // 激活中的配置服务端拒绝删除：错误原样展示
        setListError(describeError(t, deleteError));
      } finally {
        setListBusy(false);
      }
    },
    [listBusy, refreshAll, t],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line bg-sidebar/60 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <span className={labelClass}>{t("settings.profilesLabel")}</span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setDialog({ mode: "add" })}
            className="shrink-0"
          >
            <Plus size={13} />
            {t("settings.addModel")}
          </Button>
        </div>

        {profiles ? (
          <div className="mt-2.5 space-y-1">
            {profiles.profiles.map((profile) => (
              <div
                key={profile.config.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-2",
                  profile.isActive
                    ? "border-brand/40 bg-brand/5"
                    : "border-transparent bg-field/50",
                )}
              >
                <button
                  type="button"
                  onClick={() => void handleSwitchProfile(profile)}
                  disabled={listBusy || profile.isActive}
                  title={`${profile.config.name} · ${profile.config.baseUrl}`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                >
                  <span className="shrink-0 text-[12.5px] font-medium text-ink">
                    {profile.config.name}
                  </span>
                  <span className="min-w-0 truncate font-mono text-[11px] text-ink-faint">
                    {profile.config.model}
                  </span>
                  {profile.isActive ? (
                    <span className="shrink-0 rounded bg-brand/10 px-1.5 text-[10px] leading-4 text-brand">
                      {t("settings.profileActive")}
                    </span>
                  ) : null}
                  {profile.config.supportsVision !== false ? (
                    <span className="shrink-0 rounded bg-brand/10 px-1 text-[10px] leading-4 text-brand">
                      {t("settings.visionBadge")}
                    </span>
                  ) : null}
                </button>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    profile.hasApiKey ? "bg-success" : "bg-warning",
                  )}
                  title={profile.hasApiKey ? t("settings.profileKeyOk") : t("settings.profileKeyMissing")}
                />
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setDialog({ mode: "edit", profile })}
                    aria-label={t("settings.profilesEdit")}
                    title={t("settings.profilesEdit")}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteProfile(profile)}
                    aria-label={t("settings.profileDeleteAria", { name: profile.config.name })}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2.5 flex items-center gap-2 py-2 text-[12px] text-ink-faint">
            <Loader2 size={13} className="animate-spin" />
            {t("settings.loading")}
          </div>
        )}
        {listError ? (
          <p className="mt-2 text-[11px] text-danger">{listError}</p>
        ) : null}
      </div>

      <ChatModelSection refreshKey={chatModelRefreshKey} />

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === "edit"
            ? t("settings.editProfileTitle", { name: dialog.profile.config.name })
            : t("settings.providerDialogTitle")
        }
        description={
          dialog?.mode === "edit"
            ? t("settings.editProfileHint")
            : t("settings.providerDialogHint")
        }
        className="max-w-[680px]"
      >
        {dialog?.mode === "edit" ? (
          <ProviderSettingsForm
            mode="edit"
            profile={dialog.profile}
            onSaved={() => setDialog(null)}
          />
        ) : (
          <ProviderSettingsForm
            mode="add"
            onSaved={() => setDialog(null)}
            onImported={refreshAll}
          />
        )}
      </Dialog>
    </div>
  );
}
