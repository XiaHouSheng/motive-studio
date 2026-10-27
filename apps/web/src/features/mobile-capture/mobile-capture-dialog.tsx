import { useEffect, useState } from "react";
import { AlertCircle, Check, Copy, Info, Loader2, RefreshCw } from "lucide-react";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface MobileCaptureDialogProps {
  workspace: WorkspaceApi;
}

const STEPS = [
  "确保手机与电脑连接同一 Wi-Fi 网络。",
  "用手机相机扫码，或复制地址到手机浏览器打开。",
  "拍照上传题目，识别确认后导入对应题组。",
];

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
      setCopyError("复制失败，请长按地址手动复制");
    }
  };

  return (
    <Dialog
      open={mobileLinkOpen}
      onClose={closeMobileLink}
      title="手机拍照导入"
      description="生成临时访问二维码，在手机上拍照上传题目"
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
            重新生成凭证
          </Button>
          <Button variant="primary" size="sm" onClick={closeMobileLink}>
            完成
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {mobileLinkLoading ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-line bg-elevated/40 px-4 py-10">
            <Loader2 size={20} className="animate-spin text-ink-faint" />
            <p className="text-[12px] text-ink-faint">正在生成访问凭证…</p>
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
                    二维码加载失败，可复制下方地址访问
                  </p>
                </div>
              ) : (
                <img
                  src={`/api/mobile/qr.svg?url=${encodeURIComponent(preferred)}`}
                  alt="手机拍照导入二维码"
                  className="block h-[184px] w-[184px]"
                  onError={() => setQrFailed(true)}
                />
              )}
            </div>
            <p className="text-[11px] text-ink-faint">手机相机扫码即可打开拍照导入页</p>
          </div>
        ) : null}

        {mobileLinkUrls.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[11.5px] font-medium text-ink-soft">
                选择手机可访问的地址
              </p>
              <span className="text-[10.5px] text-ink-faint">
                二维码会跟随所选地址
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
                  aria-label={`使用 ${url} 生成二维码`}
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
                  {copiedIndex === index ? "已复制" : "复制"}
                </button>
              </div>
            ))}
            {copyError ? <p className="text-[11px] text-danger">{copyError}</p> : null}
          </div>
        ) : !mobileLinkLoading && !mobileLinkError ? (
          <div className="rounded-md border border-line bg-elevated/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-soft">
            未检测到局域网地址：请确认手机与电脑连接同一网络，检查防火墙是否放行服务端口后点击「重新生成凭证」。
          </div>
        ) : null}

        <ol className="list-decimal space-y-1 pl-4 text-[11.5px] leading-relaxed text-ink-soft">
          {STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        <div className="flex items-start gap-2 rounded-md border border-line bg-elevated/40 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
          <Info size={13} className="mt-0.5 shrink-0" />
          <span>
            访问凭证由本机生成，24 小时内有效且仅限局域网访问；服务重启后需重新扫码，不带凭证的设备无法打开该页面。
          </span>
        </div>
      </div>
    </Dialog>
  );
}
