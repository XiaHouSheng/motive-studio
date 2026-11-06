import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Link2,
  Loader2,
  MessageSquareText,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { formatDay, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { Markdown } from "@/components/shared/markdown";
import { ThinkingDots } from "@/components/shared/thinking-dots";
import { Skeleton } from "@/components/ui/skeleton";

interface ChatPanelProps {
  workspace: WorkspaceApi;
  onClose: () => void;
}

export function ChatPanel({ workspace, onClose }: ChatPanelProps) {
  const {
    loading,
    activeStep,
    messages,
    thinking,
    streaming,
    sendFailed,
    sendMessage,
    stopGeneration,
    retryFailedSend,
  } = workspace;
  const openSettings = useUiStore((state) => state.openSettings);
  const { t, locale } = useI18n();
  const suggestions = [
    t("chat.suggestion.why"),
    t("chat.suggestion.alternative"),
    t("chat.suggestion.relation"),
  ];
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isStreaming = Boolean(streaming);
  const canSend = Boolean(activeStep) && !isStreaming && draft.trim().length > 0;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, thinking, activeStep?.id]);

  const firstDay = useMemo(
    () => (messages.length > 0 ? formatDay(messages[0].createdAt, locale, t("chat.today")) : null),
    [messages, locale, t],
  );

  const submit = () => {
    if (!canSend) return;
    sendMessage(draft);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const fillSuggestion = (text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="shrink-0 border-b border-line px-4 pt-3 pb-3">
        <div className="flex items-center gap-1.5">
          <Sparkles size={12.5} strokeWidth={1.9} className="text-brand" />
          <span className="text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
            {t("chat.header")}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={onClose}
              aria-label={t("chat.close")}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-selection hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          {activeStep ? (
            <>
              <Badge tone="brand" className="shrink-0">
                {t("chat.stepBadge", { number: String(activeStep.order).padStart(2, "0") })}
              </Badge>
              <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
                {activeStep.title}
              </span>
            </>
          ) : (
            <span className="text-[13px] font-semibold text-ink">{t("chat.noStep")}</span>
          )}
        </div>

        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
          {t("chat.entryHint")}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-surface/50 px-3.5 py-4"
      >
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-9 w-3/5" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="ml-auto h-9 w-2/3" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !activeStep ? (
          <EmptyState
            icon={MessageSquareText}
            title={t("chat.empty.selectStep")}
            description={t("chat.empty.selectStepDesc")}
            compact
            className="pt-16"
          />
        ) : messages.length === 0 && !thinking ? (
          <div className="pt-10">
            <EmptyState
              icon={MessageSquareText}
              title={t("chat.empty.ask")}
              description={t("chat.empty.askDesc")}
              compact
            />
            <div className="mx-auto mt-1 flex max-w-[280px] flex-col gap-1.5">
              {suggestions.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => fillSuggestion(text)}
                  className="rounded-lg border border-line bg-panel px-3 py-2 text-left text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-selection/60 hover:text-ink"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {firstDay ? (
              <div className="flex items-center gap-2 text-[10px] tracking-[0.08em] text-ink-faint uppercase">
                <span className="h-px flex-1 bg-line" />
                {firstDay}
                <span className="h-px flex-1 bg-line" />
              </div>
            ) : null}

            {messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="animate-rise flex flex-col items-end gap-1">
                  <div className="max-w-[86%] rounded-xl rounded-tr-sm bg-selection px-3 py-2.5 text-[12.8px] leading-relaxed whitespace-pre-wrap text-ink">
                    {message.content}
                  </div>
                  <span className="pr-1 text-[10px] text-ink-faint">
                    {formatTime(message.createdAt, locale)}
                    {message.failed ? ` · ${t("chat.unsent")}` : null}
                  </span>
                </div>
              ) : (
                <div key={message.id} className="animate-rise space-y-1.5">
                  <div className="rounded-xl rounded-tl-sm border border-line/80 bg-elevated/70 px-3 py-2.5">
                    <Markdown content={message.content} className="md-compact" />
                    {message.streaming ? (
                      <span className="mt-1.5 inline-block h-3 w-[2px] animate-pulse bg-brand align-middle" />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-0.5">
                    {message.streaming ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
                        <Loader2 size={10.5} className="animate-spin" />
                        {streaming?.stopping ? t("chat.stopping") : t("chat.generating")}
                      </span>
                    ) : message.tagStatus === "pending" ? (
                      <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-faint">
                        <Loader2 size={10.5} className="animate-spin" />
                        {t("chat.tagging")}
                      </span>
                    ) : message.tags.length > 0 ? (
                      message.tags.map((tag) => (
                        <span
                          key={tag.stepId}
                          className="inline-flex max-w-[190px] items-center gap-1 rounded border border-line bg-panel px-1.5 py-0.5 text-[10.5px] text-ink-faint"
                        >
                          <Link2 size={9.5} strokeWidth={2} />
                          <span className="truncate">{tag.title}</span>
                        </span>
                      ))
                    ) : (
                      <span className="text-[10.5px] text-ink-faint">{t("chat.unlinked")}</span>
                    )}
                    {message.generationStatus === "interrupted" ? (
                      <span className="text-[10.5px] text-warning">· {t("chat.interrupted")}</span>
                    ) : null}
                    <span className="ml-auto text-[10px] text-ink-faint">
                      {formatTime(message.createdAt, locale)}
                    </span>
                  </div>
                </div>
              ),
            )}

            {thinking ? (
              <div className="animate-rise space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-xl rounded-tl-sm border border-line/80 bg-elevated/70 px-3 py-2.5">
                  <ThinkingDots />
                  <span className="text-[11.5px] text-ink-faint">{t("chat.thinking")}</span>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-panel px-3 py-2.5">
        {sendFailed ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11.5px] text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="leading-relaxed">{sendFailed.message}</p>
              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => retryFailedSend()}
                  className="font-medium underline underline-offset-2 transition-opacity hover:opacity-80"
                >
                  {t("chat.retry")}
                </button>
                <button
                  type="button"
                  onClick={openSettings}
                  className="text-ink-soft underline underline-offset-2 transition-opacity hover:opacity-80"
                >
                  {t("chat.modelSettings")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div
          className={cn(
            "rounded-xl border border-line bg-field transition-colors focus-within:border-brand/50",
            !activeStep && "opacity-70",
          )}
        >
          <textarea
            ref={textareaRef}
            value={draft}
            disabled={!activeStep || isStreaming}
            rows={2}
            onChange={(event) => {
              setDraft(event.target.value);
              const node = event.target;
              node.style.height = "auto";
              node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={
              activeStep ? t("chat.placeholder.active") : t("chat.placeholder.inactive")
            }
            className="max-h-[132px] min-h-[52px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[12.8px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
          />
          <div className="flex items-center gap-2 px-2 pt-1 pb-2">
            <span className="text-[10.5px] text-ink-faint">
              {isStreaming
                ? streaming?.stopping
                  ? t("chat.stopping")
                  : t("chat.replying")
                : t("chat.autoLinkHint")}
            </span>
            {isStreaming ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => stopGeneration()}
                disabled={streaming?.stopping}
                className="ml-auto"
              >
                {streaming?.stopping ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Square size={10.5} strokeWidth={2.4} />
                )}
                {streaming?.stopping ? t("chat.stopPending") : t("chat.stop")}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={submit}
                disabled={!canSend}
                className="ml-auto"
              >
                <Send size={12.5} strokeWidth={2} />
                {t("chat.send")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
