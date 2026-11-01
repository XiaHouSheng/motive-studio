import { useEffect, useState } from "react";
import { AlertCircle, Check, Copy, Info, Loader2, RefreshCw } from "lucide-react";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

interface MobileCaptureDialogProps {
  workspace: WorkspaceApi;
}

const STEPS = ["mobile.step1", "mobile.step2", "mobile.step3"] as const;

export function MobileCaptureDialog({ workspace }: MobileCaptureDialogProps) {
  const {
    mobileLinkOpen,
    mobileLinkLoading,
    mobileLinkError,
    mobileLinkUrls,
    openMobileLink,
    closeMobileLink,
  } = workspace;

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const t = useT();
  // 本机可能有多张网卡（含虚拟网卡），默认第一优先，可手动切换二维码目标地址
  const [selectedIndex, setSelectedIndex] = useState(0);

  const preferred = mobileLinkUrls[selectedIndex] ?? mobileLinkUrls[0] ?? null;

  useEffect(() => {
    if (mobileLinkOpen) return;
    setCopiedIndex(null);
    setCopyError(null);
    setQrFailed(false);
    setSelectedIndex(0);
  }, [mobileLinkOpen]);

  useEffect(() => {
    setQrFailed(false);
    setSelectedIndex((current) => (current < mobileLinkUrls.length ? current : 0));
  }, [mobileLinkUrls]);

  const copyUrl = async (url: string, index: number) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedIndex(index);
      setCopyError(null);
      window.setTimeout(
        () => setCopiedIndex((current) => (current === index ? null : current)),
        1600,
      );
    } catch {
      setCopyError(t("mobile.copyFailed"));
    }
  };

  return (
    <Dialog
      open={mobileLinkOpen}
      onClose={closeMobileLink}
      title={t("mobile.title")}
      description={t("mobile.description")}
      className="max-w-[420px]"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={mobileLinkLoading}
            onClick={() => void openMobileLink()}
          >
            <RefreshCw size={13} />
            {t("mobile.regenerate")}
          </Button>
          <Button variant="primary" size="sm" onClick={closeMobileLink}>
            {t("mobile.done")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {mobileLinkLoading ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-elevated/40 px-4 py-10">
            <Loader2 size={20} className="animate-spin text-ink-faint" />
            <p className="text-[12px] text-ink-faint">{t("mobile.generating")}</p>
          </div>
        ) : null}

        {mobileLinkError ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{mobileLinkError}</span>
          </div>
        ) : null}

        {!mobileLinkLoading && preferred ? (
          <div className="flex flex-col items-center gap-2">
            <div className="rounded-xl border border-line bg-white p-3 shadow-soft">
              {qrFailed ? (
                <div className="flex h-[184px] w-[184px] flex-col items-center justify-center gap-1.5 text-center">
                  <AlertCircle size={18} className="text-ink-faint" />
                  <p className="px-3 text-[11px] leading-relaxed text-ink-faint">
                    {t("mobile.qrFailed")}
                  </p>
                </div>
              ) : (
                <img
                  src={`/api/mobile/qr.svg?url=${encodeURIComponent(preferred)}`}
                  alt={t("mobile.qrAlt")}
                  className="block h-[184px] w-[184px]"
                  onError={() => setQrFailed(true)}
                />
              )}
            </div>
            <p className="text-[11px] text-ink-faint">{t("mobile.scanHint")}</p>
          </div>
        ) : null}

        {mobileLinkUrls.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11.5px] font-medium text-ink-soft">
                {t("mobile.chooseUrl")}
              </p>
              <span className="text-[10.5px] text-ink-faint">
                {t("mobile.qrFollowsUrl")}
              </span>
            </div>
            {mobileLinkUrls.map((url, index) => (
              <div
                key={url}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                  index === selectedIndex
                    ? "border-brand/50 bg-brand/5"
                    : "border-line bg-field hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="mobile-capture-url"
                  aria-label={t("mobile.useUrlAria", { url })}
                  checked={index === selectedIndex}
                  onChange={() => setSelectedIndex(index)}
                  className="h-3 w-3 shrink-0 accent-brand"
                />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">
                  {url}
                </span>
                <button
                  type="button"
                  onClick={() => void copyUrl(url, index)}
                  className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-ink-faint transition-colors hover:bg-selection hover:text-ink"
                >
                  {copiedIndex === index ? <Check size={12} /> : <Copy size={12} />}
                  {copiedIndex === index ? t("mobile.copied") : t("mobile.copy")}
                </button>
              </div>
            ))}
            {copyError ? <p className="text-[11px] text-danger">{copyError}</p> : null}
          </div>
        ) : !mobileLinkLoading && !mobileLinkError ? (
          <div className="rounded-md border border-line bg-elevated/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
            {t("mobile.noLanAddress")}
          </div>
        ) : null}

        <ol className="list-decimal space-y-1 pl-4 text-[11.5px] leading-relaxed text-ink-soft">
          {STEPS.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>

        <div className="flex items-start gap-2 rounded-md border border-line bg-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>{t("mobile.tokenInfo")}</span>
        </div>
      </div>
    </Dialog>
  );
}
