import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** 退场动画时长，与 --motion-fast 保持一致 */
const EXIT_DURATION = 120;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  // 先播放 120ms 淡出，卸载前保证动效完成；重复触发不叠加定时器
  const requestClose = useCallback(() => {
    setClosing((value) => {
      if (value) return value;
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setClosing(false);
        onClose();
      }, EXIT_DURATION);
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setClosing(false);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, requestClose]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className={cn(
          "absolute inset-0 bg-black/40",
          closing ? "animate-fade-out" : "animate-fade-in",
        )}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "relative z-10 flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-soft",
          closing ? "animate-dialog-out" : "animate-dialog-in",
          className,
        )}
      >
        <div className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-faint">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="关闭"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-(--duration-fast) hover:bg-selection hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="shrink-0 border-t border-line bg-elevated/40 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
