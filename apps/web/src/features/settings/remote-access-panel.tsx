import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, Loader2, QrCode, RefreshCw } from "lucide-react";
import type { RemoteAccessView } from "@motive/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { translateApiError } from "@/lib/i18n/errors";

const inputClass =
  "h-8 w-full rounded-md border border-line bg-field px-2.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand/50";
const hintClass = "text-[11px] leading-relaxed text-ink-faint";
const sectionHeadingClass = "text-[13px] font-semibold text-ink";

function describeError(t: (key: DictionaryKey) => string, error: unknown): string {
  if (error instanceof Error) return translateApiError(t, error);
  return t("settings.operationFailed");
}

/**
 * 远程访问设置面板：服务广播开关（内嵌 frpc）、服务器与 frps 令牌、
 * 访问密钥管理与一键访问链接/二维码。
 * 密钥本体仅在本机回环请求下由服务端返回；远程设备打开面板时自动隐藏。
 */
export function RemoteAccessPanel() {
  const t = useT();

  const [view, setView] = useState<RemoteAccessView | null>(null);
  const [publicOrigin, setPublicOrigin] = useState("");
  const [serverAddr, setServerAddr] = useState("");
  const [frpsToken, setFrpsToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getRemoteAccess()
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setPublicOrigin(next.publicOrigin);
        setServerAddr(next.serverAddr);
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

  const refresh = useCallback(async () => {
    const next = await api.getRemoteAccess();
    setView(next);
    setPublicOrigin(next.publicOrigin);
    setServerAddr(next.serverAddr);
  }, []);

  const run = useCallback(
    async (id: string, action: () => Promise<void>, successKey: DictionaryKey) => {
      setBusy(id);
      setError(null);
      setNotice(null);
      try {
        await action();
        setNotice(t(successKey));
      } catch (actionError) {
        setError(describeError(t, actionError));
      } finally {
        setBusy(null);
      }
    },
    [t],
  );

  const copy = useCallback(async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      // 剪贴板不可用时忽略：用户可手动选中文本复制
    }
  }, []);

  const toggleEnabled = () =>
    run(
      "toggle",
      async () => {
        const next = await api.saveRemoteAccess({ enabled: !view?.enabled });
        setView(next);
      },
      view?.enabled ? "settings.remoteDisabled" : "settings.remoteEnabled",
    );

  const saveServer = () =>
    run(
      "server",
      async () => {
        const next = await api.saveRemoteAccess({ serverAddr, publicOrigin });
        setView(next);
      },
      "settings.remoteServerSaved",
    );

  const saveFrpsToken = () =>
    run(
      "frpsToken",
      async () => {
        const next = await api.setFrpsToken(frpsToken.trim());
        setView(next);
        setFrpsToken("");
      },
      "settings.frpsTokenSaved",
    );

  const rotate = () =>
    run(
      "rotate",
      async () => {
        await api.rotateRemoteAccessToken();
        await refresh();
      },
      "settings.remoteRotated",
    );

  const revoke = () => {
    if (!window.confirm(t("settings.remoteRevokeConfirm"))) return;
    run(
      "revoke",
      async () => {
        await api.deleteRemoteAccessToken();
        await refresh();
      },
      "settings.remoteRevoked",
    );
  };

  const gateActive = view?.enabled === true && view.hasToken;
  const isLocal = view?.token !== undefined;
  const frpc = view?.frpc;
  const accessUrl = isLocal && view?.accessUrl ? view.accessUrl : null;
  const tokenValue = isLocal ? view?.token ?? null : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12.5px] text-ink-soft">
        <Loader2 size={14} className="animate-spin" />
        {t("settings.remoteLoading")}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 服务广播开关（桌面版联动内嵌 frpc；web 版仅为门卫开关） */}
      <section className="space-y-2.5">
        <h2 className={sectionHeadingClass}>{t("settings.sectionRemote")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={busy !== null}
            aria-pressed={view?.enabled === true}
            className={
              view?.enabled
                ? "inline-flex h-8 items-center gap-1.5 rounded-md border border-brand/50 bg-brand/5 px-3 text-[12.5px] font-medium text-ink disabled:opacity-60"
                : "inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-60"
            }
          >
            {busy === "toggle" ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
            {view?.enabled ? t("settings.remoteDisable") : t("settings.remoteEnable")}
          </button>
          {frpc ? (
            <span
              className={
                frpc.status === "running"
                  ? "inline-flex items-center gap-1 text-[11.5px] text-brand"
                  : frpc.status === "error"
                    ? "inline-flex items-center gap-1 text-[11.5px] text-red-500"
                    : "inline-flex items-center gap-1 text-[11.5px] text-ink-faint"
              }
            >
              <span
                className={
                  frpc.status === "running"
                    ? "h-1.5 w-1.5 rounded-full bg-brand"
                    : frpc.status === "error"
                      ? "h-1.5 w-1.5 rounded-full bg-red-500"
                      : "h-1.5 w-1.5 rounded-full bg-ink-faint"
                }
              />
              {frpc.status === "running"
                ? t("settings.frpcStatusRunning")
                : frpc.status === "error"
                  ? t("settings.frpcStatusError")
                  : t("settings.frpcStatusStopped")}
            </span>
          ) : null}
          <span className={hintClass}>
            {gateActive ? t("settings.remoteActive") : t("settings.remoteInactive")}
          </span>
        </div>
        {frpc?.detail ? <p className="text-[11.5px] leading-relaxed text-red-500">{frpc.detail}</p> : null}
        <p className={hintClass}>{t("settings.remoteEnabledHint")}</p>
      </section>

      {/* 服务器与公网入口 */}
      <section className="space-y-2.5">
        <h2 className={sectionHeadingClass}>{t("settings.remoteServer")}</h2>
        {frpc ? (
          <div className="space-y-1.5">
            <label className="block text-[11.5px] font-medium text-ink-soft" htmlFor="remote-server-addr">
              {t("settings.remoteServerAddr")}
            </label>
            <input
              id="remote-server-addr"
              type="text"
              value={serverAddr}
              onChange={(event) => setServerAddr(event.target.value)}
              placeholder="123.45.67.89 或 motive.example.com"
              autoComplete="off"
              spellCheck={false}
              className={inputClass}
            />
            <p className={hintClass}>{t("settings.remoteServerAddrHint")}</p>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label className="block text-[11.5px] font-medium text-ink-soft" htmlFor="remote-public-origin">
            {t("settings.remotePublicOrigin")}
          </label>
          <input
            id="remote-public-origin"
            type="url"
            value={publicOrigin}
            onChange={(event) => setPublicOrigin(event.target.value)}
            placeholder="https://motive.example.duckdns.org:39222"
            className={inputClass}
          />
          <p className={hintClass}>{t("settings.remotePublicOriginHint")}</p>
        </div>
        <button
          type="button"
          onClick={saveServer}
          disabled={busy !== null || (serverAddr === view?.serverAddr && publicOrigin === view?.publicOrigin)}
          className="inline-flex h-8 items-center rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-50"
        >
          {busy === "server" ? <Loader2 size={13} className="animate-spin" /> : t("settings.remoteSave")}
        </button>
      </section>

      {/* frps 认证令牌（仅桌面版本机显示） */}
      {frpc && isLocal ? (
        <section className="space-y-2.5">
          <h2 className={sectionHeadingClass}>{t("settings.frpsToken")}</h2>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={frpsToken}
              onChange={(event) => setFrpsToken(event.target.value)}
              placeholder={
                view?.frpsTokenSet ? t("settings.frpsTokenSetPlaceholder") : t("settings.frpsTokenPlaceholder")
              }
              autoComplete="new-password"
              className={inputClass}
            />
            <button
              type="button"
              onClick={saveFrpsToken}
              disabled={busy !== null || !frpsToken.trim()}
              className="inline-flex h-8 shrink-0 items-center rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-50"
            >
              {busy === "frpsToken" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                t("settings.frpsTokenSave")
              )}
            </button>
          </div>
          <p className={hintClass}>
            {view?.frpsTokenSet ? t("settings.frpsTokenSet") : t("settings.frpsTokenUnset")}
            {t("settings.frpsTokenHint")}
          </p>
        </section>
      ) : null}

      {/* 访问密钥 */}
      <section className="space-y-2.5">
        <h2 className={sectionHeadingClass}>{t("settings.remoteToken")}</h2>
        {tokenValue ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-field px-2.5 py-1.5 font-mono text-[12px] text-ink">
                {tokenValue}
              </code>
              <button
                type="button"
                onClick={() => copy("token", tokenValue)}
                aria-label={t("settings.remoteCopy")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-field text-ink-soft transition-colors hover:bg-selection hover:text-ink"
              >
                {copied === "token" ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={rotate}
                disabled={busy !== null}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-60"
              >
                {busy === "rotate" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {t("settings.remoteRotate")}
              </button>
              <button
                type="button"
                onClick={revoke}
                disabled={busy !== null}
                className="inline-flex h-8 items-center rounded-md border border-line bg-field px-3 text-[12.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-60"
              >
                {t("settings.remoteRevoke")}
              </button>
            </div>
            <p className={hintClass}>{t("settings.remoteRotateHint")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={rotate}
              disabled={busy !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand/50 bg-brand/5 px-3 text-[12.5px] font-medium text-ink disabled:opacity-60"
            >
              {busy === "rotate" ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              {t("settings.remoteGenerate")}
            </button>
            {!isLocal ? <p className={hintClass}>{t("settings.remoteTokenRemoteHint")}</p> : null}
          </div>
        )}
        <p className={hintClass}>{t("settings.remoteRevokeHint")}</p>
      </section>

      {/* 访问链接与二维码 */}
      {accessUrl ? (
        <section className="space-y-2.5">
          <h2 className={sectionHeadingClass}>{t("settings.remoteAccessUrl")}</h2>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-field px-2.5 py-1.5 font-mono text-[12px] text-ink">
              {accessUrl}
            </code>
            <button
              type="button"
              onClick={() => copy("url", accessUrl)}
              aria-label={t("settings.remoteCopy")}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-line bg-field text-ink-soft transition-colors hover:bg-selection hover:text-ink"
            >
              {copied === "url" ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <p className={hintClass}>{t("settings.remoteAccessUrlHint")}</p>
          <div className="w-fit rounded-lg border border-line bg-white p-2">
            <img
              src={`/api/mobile/qr.svg?url=${encodeURIComponent(accessUrl)}`}
              alt={t("settings.remoteQr")}
              width={168}
              height={168}
              className="block"
            />
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
            <QrCode size={12} />
            {t("settings.remoteQrHint")}
          </div>
        </section>
      ) : null}

      {error ? <p className="text-[12px] leading-relaxed text-red-500">{error}</p> : null}
      {notice ? <p className="text-[12px] leading-relaxed text-brand">{notice}</p> : null}
    </div>
  );
}
