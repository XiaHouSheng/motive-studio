import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Check, Crop, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MIN_SIZE = 48;
const STAGE_PADDING = 16;

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 图片在舞台中的展示区域（contain-fit 结果） */
interface ImageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface DragState {
  mode: "move" | HandleId;
  startRect: Rect;
  startX: number;
  startY: number;
}

const HANDLES: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CLASS: Record<HandleId, string> = {
  nw: "-top-1.5 -left-1.5 cursor-nwse-resize",
  n: "-top-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  ne: "-top-1.5 -right-1.5 cursor-nesw-resize",
  e: "top-1/2 -right-1.5 -translate-y-1/2 cursor-ew-resize",
  se: "-bottom-1.5 -right-1.5 cursor-nwse-resize",
  s: "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize",
  sw: "-bottom-1.5 -left-1.5 cursor-nesw-resize",
  w: "top-1/2 -left-1.5 -translate-y-1/2 cursor-ew-resize",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 将选框限制在图片区域内，且不小于 MIN_SIZE */
function clampRect(rect: Rect, bounds: ImageBounds): Rect {
  const width = clamp(rect.width, MIN_SIZE, bounds.width);
  const height = clamp(rect.height, MIN_SIZE, bounds.height);
  return {
    width,
    height,
    x: clamp(rect.x, bounds.left, bounds.left + bounds.width - width),
    y: clamp(rect.y, bounds.top, bounds.top + bounds.height - height),
  };
}

function moveRect(startRect: Rect, dx: number, dy: number, bounds: ImageBounds): Rect {
  return {
    ...startRect,
    x: clamp(
      startRect.x + dx,
      bounds.left,
      bounds.left + bounds.width - startRect.width,
    ),
    y: clamp(
      startRect.y + dy,
      bounds.top,
      bounds.top + bounds.height - startRect.height,
    ),
  };
}

function resizeRect(
  mode: HandleId,
  startRect: Rect,
  dx: number,
  dy: number,
  bounds: ImageBounds,
): Rect {
  let { x, y, width, height } = startRect;

  if (mode.includes("w")) {
    x = clamp(x + dx, bounds.left, x + width - MIN_SIZE);
    width = startRect.x + startRect.width - x;
  }
  if (mode.includes("e")) {
    width = clamp(width + dx, MIN_SIZE, bounds.left + bounds.width - x);
  }
  if (mode.includes("n")) {
    y = clamp(y + dy, bounds.top, y + height - MIN_SIZE);
    height = startRect.y + startRect.height - y;
  }
  if (mode.includes("s")) {
    height = clamp(height + dy, MIN_SIZE, bounds.top + bounds.height - y);
  }

  return { x, y, width, height };
}

interface ImageCropEditorProps {
  dataUrl: string;
  filename: string;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}

/** 全屏裁剪编辑器：拖动选框移动、拖动 8 个手柄缩放，确认后按原始分辨率输出裁剪图 */
export function ImageCropEditor({
  dataUrl,
  filename,
  onCancel,
  onApply,
}: ImageCropEditorProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const initializedRef = useRef<string | null>(null);

  const [bounds, setBounds] = useState<ImageBounds | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  // Escape 用捕获阶段拦截，避免同时触发底下导入弹窗的关闭逻辑
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onCancel]);

  // 量测舞台尺寸，按 contain-fit 计算图片展示区域，并初始化/校正选框
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const image = imageRef.current;
    if (!stage || !image || !image.naturalWidth) return;

    setError(null);
    const availableWidth = Math.max(
      stage.clientWidth - STAGE_PADDING * 2,
      MIN_SIZE,
    );
    const availableHeight = Math.max(
      stage.clientHeight - STAGE_PADDING * 2,
      MIN_SIZE,
    );
    const scale = Math.min(
      availableWidth / image.naturalWidth,
      availableHeight / image.naturalHeight,
    );
    const nextBounds: ImageBounds = {
      left: (stage.clientWidth - image.naturalWidth * scale) / 2,
      top: (stage.clientHeight - image.naturalHeight * scale) / 2,
      width: image.naturalWidth * scale,
      height: image.naturalHeight * scale,
    };
    setBounds(nextBounds);

    setRect((current) => {
      if (initializedRef.current !== dataUrl) {
        initializedRef.current = dataUrl;
        // 首次量测：居中放置 86% 的初始选框
        return {
          x: nextBounds.left + nextBounds.width * 0.07,
          y: nextBounds.top + nextBounds.height * 0.07,
          width: nextBounds.width * 0.86,
          height: nextBounds.height * 0.86,
        };
      }
      return current ? clampRect(current, nextBounds) : null;
    });
  }, [dataUrl]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measure]);

  // 缓存命中时 load 事件可能已经错过，这里兜底量测一次
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) measure();
  }, [measure]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!bounds || !rect || applying || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const mode =
      (target.dataset.handle as HandleId | undefined) ??
      (target.closest("[data-crop-box]") ? ("move" as const) : null);
    if (!mode) return; // 框外按下不响应，避免误建选区
    event.preventDefault();
    dragRef.current = {
      mode,
      startRect: rect,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !bounds) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setRect(
      drag.mode === "move"
        ? moveRect(drag.startRect, dx, dy, bounds)
        : resizeRect(drag.mode, drag.startRect, dx, dy, bounds),
    );
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const applyCrop = () => {
    const image = imageRef.current;
    if (!image || !bounds || !rect || applying) return;
    setApplying(true);
    try {
      // 舞台是缩放展示，换算回原始分辨率再裁剪
      const scale = image.naturalWidth / bounds.width;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(Math.round(rect.width * scale), 1);
      canvas.height = Math.max(Math.round(rect.height * scale), 1);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas context");
      context.drawImage(
        image,
        (rect.x - bounds.left) * scale,
        (rect.y - bounds.top) * scale,
        rect.width * scale,
        rect.height * scale,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const mime = /^data:([^;]+)/.exec(dataUrl)?.[1] ?? "image/jpeg";
      onApply(canvas.toDataURL(mime, mime === "image/png" ? undefined : 0.92));
    } catch {
      setApplying(false);
      setError("裁剪失败，请重试");
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black/92">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <Crop size={16} className="text-brand" />
          <span className="text-[13px] font-medium text-ink">裁剪图片</span>
        </div>
        <span className="hidden text-[11px] text-ink-faint sm:block">
          拖动选框调整区域，拖动边角手柄缩放
        </span>
        <button
          type="button"
          aria-label="关闭裁剪编辑器"
          onClick={onCancel}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-white/10 hover:text-ink"
        >
          <X size={15} />
        </button>
      </header>

      <div
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        className="relative min-h-0 flex-1 touch-none select-none overflow-hidden"
      >
        <img
          ref={imageRef}
          src={dataUrl}
          alt={filename}
          draggable={false}
          onLoad={measure}
          onError={() => setError("图片加载失败，请返回后重试")}
          className="pointer-events-none absolute"
          style={
            bounds
              ? {
                  left: bounds.left,
                  top: bounds.top,
                  width: bounds.width,
                  height: bounds.height,
                }
              : { opacity: 0 }
          }
        />

        {bounds && rect ? (
          <div
            data-crop-box
            className="absolute cursor-move border border-brand shadow-[0_0_0_9999px_rgba(0,0,0,0.62)]"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
          >
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/3 top-0 h-full w-px bg-white/25" />
              <div className="absolute left-2/3 top-0 h-full w-px bg-white/25" />
              <div className="absolute left-0 top-1/3 h-px w-full bg-white/25" />
              <div className="absolute left-0 top-2/3 h-px w-full bg-white/25" />
            </div>
            {HANDLES.map((handle) => (
              <span
                key={handle}
                data-handle={handle}
                className={cn(
                  "absolute h-3 w-3 rounded-full border border-black/40 bg-brand",
                  HANDLE_CLASS[handle],
                )}
              />
            ))}
          </div>
        ) : null}

        {error ? (
          bounds ? (
            <div className="absolute inset-x-3 bottom-3 rounded-md border border-danger/40 bg-black/80 px-3 py-2 text-center text-[11.5px] text-danger">
              {error}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12.5px] text-danger">
              {error}
            </div>
          )
        ) : null}
      </div>

      <footer className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0 truncate text-[11px] text-ink-faint">
          {filename}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={applyCrop}
            disabled={!bounds || !rect || applying}
          >
            {applying ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Check size={13} />
            )}
            {applying ? "裁剪中…" : "确认裁剪"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
