import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  ImagePlus,
  Link2,
  Loader2,
  MessageSquareText,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { formatDay, formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import {
  CHAT_MAX_IMAGES,
  ChatImageError,
  attachmentFromStored,
  filesToAttachments,
  type ChatImageAttachment,
} from "@/lib/chat-images";
import { clearChatDraft, loadChatDraft, saveChatDraft } from "@/lib/chat-drafts";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { Markdown } from "@/components/shared/markdown";
import { ThinkingDots } from "@/components/shared/thinking-dots";
import { ZoomableImage } from "@/components/shared/zoomable-image";
import { Skeleton } from "@/components/ui/skeleton";

/** 输入框可拉伸的高度阈值范围（px） */
const INPUT_MIN_HEIGHT = 52;
const INPUT_MAX_HEIGHT = 280;

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
    providerSupportsVision,
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
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  /** 手动拖拽设定的输入框高度；null 时按内容自适应 */
  const [manualHeight, setManualHeight] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 悬浮输入区实际高度：滚动区据此预留底部空间，避免最后一条消息被遮挡 */
  const composerRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const resizeState = useRef<{ startY: number; baseHeight: number } | null>(null);

  const isStreaming = Boolean(streaming);
  const canSend =
    Boolean(activeStep) && !isStreaming && (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, thinking, activeStep?.id, composerHeight]);

  // 悬浮输入区高度变化时同步滚动区底部预留
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setComposerHeight(node.offsetHeight));
    observer.observe(node);
    setComposerHeight(node.offsetHeight);
    return () => observer.disconnect();
  }, []);

  const applyTextareaHeight = useCallback(
    (node: HTMLTextAreaElement) => {
      node.style.height = "auto";
      const auto = node.scrollHeight;
      const target = Math.min(Math.max(auto, manualHeight ?? 0), INPUT_MAX_HEIGHT);
      node.style.height = `${target}px`;
    },
    [manualHeight],
  );

  // 内容或手动高度变化后统一应用输入框高度（含草稿恢复的场景）
  useEffect(() => {
    if (textareaRef.current) applyTextareaHeight(textareaRef.current);
  }, [draft, manualHeight, applyTextareaHeight]);

  const firstDay = useMemo(
    () => (messages.length > 0 ? formatDay(messages[0].createdAt, locale, t("chat.today")) : null),
    [messages, locale, t],
  );

  // 切换步骤时恢复该步骤的草稿（文字 + 附图）
  useEffect(() => {
    const stepId = activeStep?.id;
    setManualHeight(null);
    setImageError(null);
    if (!stepId) {
      setDraft("");
      setAttachments([]);
      return;
    }
    const saved = loadChatDraft(stepId);
    setDraft(saved?.text ?? "");
    setAttachments(
      (saved?.images ?? []).slice(0, CHAT_MAX_IMAGES).map((image) =>
        attachmentFromStored(image.mediaType, image.data),
      ),
    );
  }, [activeStep?.id]);

  // 草稿防抖持久化：切换步骤 / 重开应用后可恢复
  useEffect(() => {
    const stepId = activeStep?.id;
    if (!stepId) return;
    const timer = window.setTimeout(() => {
      if (draft.trim() === "" && attachments.length === 0) {
        clearChatDraft(stepId);
        return;
      }
      saveChatDraft(stepId, {
        text: draft,
        images: attachments.map(({ mediaType, data }) => ({ mediaType, data })),
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [activeStep?.id, draft, attachments]);

  const addFiles = useCallback(
    async (files: File[]) => {
      try {
        const { attachments: next, overflow } = await filesToAttachments(
          files,
          attachments.length,
        );
        if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
        setImageError(
          overflow > 0 ? t("chat.imageLimitExceeded", { count: String(CHAT_MAX_IMAGES) }) : null,
        );
      } catch (error) {
        if (error instanceof ChatImageError) {
          const key =
            error.code === "tooLarge"
              ? "chat.imageTooLarge"
              : error.code === "unsupported"
                ? "chat.imageUnsupported"
                : "chat.imageDecodeFailed";
          setImageError(t(key));
        } else {
          setImageError(t("chat.imageDecodeFailed"));
        }
      }
    },
    [attachments.length, t],
  );

  const submit = () => {
    if (!canSend || !activeStep) return;
    const stepId = activeStep.id;
    sendMessage(
      draft,
      attachments.map(({ mediaType, data }) => ({ mediaType, data })),
    );
    setDraft("");
    setAttachments([]);
    setImageError(null);
    setManualHeight(null);
    clearChatDraft(stepId);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const fillSuggestion = (text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  };

  /** 顶部拖拽手柄：按住上下拖动调整输入框高度（有阈值范围） */
  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = textareaRef.current?.offsetHeight ?? INPUT_MIN_HEIGHT;
    resizeState.current = { startY: event.clientY, baseHeight: current };
  };

  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeState.current;
    if (!state) return;
    const next = state.baseHeight + (state.startY - event.clientY);
    setManualHeight(Math.min(Math.max(next, INPUT_MIN_HEIGHT), INPUT_MAX_HEIGHT));
  };

  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeState.current) return;
    resizeState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-panel">
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
        className="min-h-0 flex-1 overflow-y-auto bg-surface/50 px-3.5 pt-4"
        style={{ paddingBottom: composerHeight > 0 ? composerHeight + 16 : 168 }}
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
                  {message.content ? (
                    <div className="max-w-[86%] rounded-xl rounded-tr-sm bg-selection px-3 py-2.5 text-[12.8px] leading-relaxed whitespace-pre-wrap text-ink">
                      {message.content}
                    </div>
                  ) : null}
                  {message.images && message.images.length > 0 ? (
                    <div className="flex max-w-[86%] flex-wrap justify-end gap-1.5">
                      {message.images.map((image, index) => (
                        <button
                          key={`${image.url}-${index}`}
                          type="button"
                          onClick={() => setPreviewUrl(image.url)}
                          aria-label={t("chat.viewImage")}
                          className="overflow-hidden rounded-lg border border-line bg-panel transition-opacity hover:opacity-85"
                        >
                          <img
                            src={image.url}
                            alt=""
                            draggable={false}
                            className="h-16 max-w-[150px] object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
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

      {/* 悬浮输入区：不占滚动区布局，消息从其下方穿过 */}
      <div
        ref={composerRef}
        className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2"
      >
        {sendFailed ? (
          <div className="pointer-events-auto flex items-start gap-2 rounded-xl border border-danger/30 bg-panel/95 px-2.5 py-2 text-[11.5px] text-danger shadow-soft backdrop-blur-sm">
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
            "pointer-events-auto rounded-2xl border border-line bg-field shadow-soft transition-colors focus-within:border-brand/50",
            !activeStep && "opacity-80",
          )}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length === 0) return;
            event.preventDefault();
            void addFiles(files);
          }}
        >
          <div
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            aria-label={t("chat.resizeInput")}
            title={t("chat.resizeInput")}
            className="flex h-3 w-full cursor-ns-resize touch-none items-center justify-center rounded-t-2xl"
          >
            <span className="h-0.5 w-9 rounded-full bg-line-strong/50 transition-colors hover:bg-line-strong" />
          </div>

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-2 px-3 pt-1">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group/attachment relative">
                  <button
                    type="button"
                    onClick={() => setPreviewUrl(attachment.dataUrl)}
                    aria-label={t("chat.viewImage")}
                    className="block h-14 w-14 overflow-hidden rounded-lg border border-line bg-panel"
                  >
                    <img
                      src={attachment.dataUrl}
                      alt=""
                      draggable={false}
                      className="h-full w-full object-cover"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))
                    }
                    aria-label={t("chat.removeImage")}
                    className="absolute -top-1.5 -right-1.5 hidden h-4.5 w-4.5 items-center justify-center rounded-full border border-line bg-elevated text-ink-faint transition-colors hover:border-danger/40 hover:text-danger group-hover/attachment:flex"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {attachments.length > 0 && providerSupportsVision === false ? (
            <div className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle size={12} className="shrink-0" />
              <span>{t("chat.imageVisionWarning")}</span>
            </div>
          ) : null}

          {imageError ? (
            <p className="mx-3 mt-2 text-[11px] text-danger">{imageError}</p>
          ) : null}

          <textarea
            ref={textareaRef}
            value={draft}
            disabled={!activeStep || isStreaming}
            rows={2}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
            onPaste={(event) => {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.length === 0) return;
              event.preventDefault();
              void addFiles(files);
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
            className="mt-1 w-full resize-none bg-transparent px-3 pb-1 text-[12.8px] leading-relaxed text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
            style={{ minHeight: INPUT_MIN_HEIGHT }}
          />

          <div className="flex items-center gap-1.5 px-2 pb-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(event) => {
                void addFiles(Array.from(event.target.files ?? []));
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("chat.attachImage")}
              title={t("chat.attachImage")}
              disabled={!activeStep || attachments.length >= CHAT_MAX_IMAGES}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-selection hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ImagePlus size={15} strokeWidth={1.8} />
            </button>
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-faint">
              {isStreaming
                ? streaming?.stopping
                  ? t("chat.stopping")
                  : t("chat.replying")
                : t("chat.autoLinkHint")}
            </span>
            {isStreaming ? (
              <button
                type="button"
                onClick={() => stopGeneration()}
                disabled={streaming?.stopping}
                aria-label={streaming?.stopping ? t("chat.stopPending") : t("chat.stop")}
                title={streaming?.stopping ? t("chat.stopPending") : t("chat.stop")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-ink-soft transition-colors hover:border-danger/40 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
              >
                {streaming?.stopping ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Square size={11} strokeWidth={2.2} />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                aria-label={t("chat.send")}
                title={t("chat.send")}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowUp size={16} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={previewUrl !== null}
        onClose={() => setPreviewUrl(null)}
        title={t("chat.viewImage")}
        className="max-w-[820px]"
      >
        {previewUrl ? (
          <ZoomableImage
            src={previewUrl}
            alt={t("chat.viewImage")}
            className="h-[65vh]"
            hint={t("solution.asset.zoomHint")}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

/** 面板拖宽等场景下 props 引用稳定时可整体跳过重渲染（宽度状态只影响布局层） */
export const ChatPanelMemo = memo(ChatPanel);
