import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  KeyRound,
  Loader2,
} from "lucide-react";
import type {
  ProviderConfig,
  ProviderSettingsView,
  ProviderTestResult,
} from "@motive/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useUiStore } from "@/stores/ui";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  baseUrl: string;
  model: string;
  temperature: string;
  maxTokens: string;
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
  };
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "操作失败，请重试";
}

export function ProviderSettingsDialog() {
  const open = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);

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
    if (!open) return;

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
        if (!cancelled) setError(toMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

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
    }));
    setActivePreset(preset.name);
    setNotice(null);
    setError(null);
    setTestResult(null);
  }, []);

  const buildProvider = useCallback((): ProviderConfig | null => {
    if (!form.name.trim()) {
      setError("请填写服务名称");
      return null;
    }
    if (!form.baseUrl.trim()) {
      setError("请填写 Base URL");
      return null;
    }
    if (!form.model.trim()) {
      setError("请填写模型名称");
      return null;
    }

    let temperature: number | undefined;
    if (form.temperature.trim() !== "") {
      temperature = Number(form.temperature);
      if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
        setError("temperature 需要是 0 到 2 之间的数字");
        return null;
      }
    }

    let maxTokens: number | undefined;
    if (form.maxTokens.trim() !== "") {
      maxTokens = Number(form.maxTokens);
      if (!Number.isInteger(maxTokens) || maxTokens < 1) {
        setError("maxTokens 需要是大于 0 的整数");
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
    };
  }, [form, view]);

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
          setNotice("设置已保存");
        }
      } catch (saveError) {
        setError(toMessage(saveError));
      } finally {
        setSaving(false);
      }
    },
    [persist],
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
      setNotice("API Key 已清除");
    } catch (clearError) {
      setError(toMessage(clearError));
    } finally {
      setSaving(false);
    }
  }, [buildProvider]);

  const hasApiKey = view?.hasApiKey ?? false;

  return (
    <Dialog
      open={open}
      onClose={closeSettings}
      title="模型设置"
      description="仅支持 OpenAI Chat Completions 兼容接口。API Key 只保存在本地服务进程内存中，不写入数据库与备份。"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">
            重启服务后需重新输入 API Key
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleSave(true)}
              disabled={saving || loading}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              保存并测试
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave(false)}
              disabled={saving || loading}
            >
              保存
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-[12px] text-ink-faint">
          <Loader2 size={14} className="animate-spin" />
          正在读取设置…
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className={labelClass}>常用服务商预设</span>
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
                      图片
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <span className="block text-[11px] text-ink-faint">
              点击自动填入名称、地址与模型；带「图片」的模型支持拍照导入的图像识别。API
              Key 请按所选服务商重新填写。
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelClass}>服务名称</span>
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="例如 OpenAI"
                autoFocus
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>模型名称</span>
              <input
                className={inputClass}
                value={form.model}
                onChange={(event) => updateField("model", event.target.value)}
                placeholder="例如 gpt-4o-mini"
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
              必须使用 HTTPS；localhost / 127.0.0.1 允许 HTTP。地址中的
              /chat/completions 会自动拼接。
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className={labelClass}>temperature（可选）</span>
              <input
                className={inputClass}
                value={form.temperature}
                onChange={(event) => updateField("temperature", event.target.value)}
                inputMode="decimal"
                placeholder="0.5"
              />
            </label>
            <label className="space-y-1.5">
              <span className={labelClass}>max tokens（可选）</span>
              <input
                className={inputClass}
                value={form.maxTokens}
                onChange={(event) => updateField("maxTokens", event.target.value)}
                inputMode="numeric"
                placeholder="留空则由服务端决定"
              />
            </label>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={labelClass}>API Key</span>
              <Badge tone={hasApiKey ? "success" : "warning"}>
                {hasApiKey ? "已配置" : "未配置"}
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
                placeholder={hasApiKey ? "留空则保持当前 Key" : "sk-..."}
                autoComplete="off"
              />
            </div>
            {hasApiKey ? (
              <button
                type="button"
                onClick={() => void handleClearKey()}
                disabled={saving}
                className="text-[11px] text-danger transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                清除已保存的 Key
              </button>
            ) : null}
          </div>

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
                连接成功：{testResult.model}，响应耗时 {testResult.latencyMs} ms
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
