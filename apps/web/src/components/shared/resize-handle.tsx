import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  /** 当前面板宽度（像素），用于增量拖拽与键盘调节 */
  width: number;
  min: number;
  max: number;
  /** 面板锚定的视口边缘：left = 面板贴左缘（向右拖增宽），right = 面板贴右缘（向左拖增宽） */
  anchor: "left" | "right";
  onResize: (width: number) => void;
  onDraggingChange?: (dragging: boolean) => void;
  label: string;
  className?: string;
}

const KEYBOARD_STEP = 16;

/**
 * 垂直拖拽分割条：按住水平拖动调整相邻面板宽度（阈值钳制由内部 min/max 完成），
 * 支持方向键微调。显示断点由调用方通过 className 控制（如 md:block / xl:block）。
 */
export function ResizeHandle({
  width,
  min,
  max,
  anchor,
  onResize,
  onDraggingChange,
  label,
  className,
}: ResizeHandleProps) {
  const draggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, width: 0 });
  const [dragging, setDragging] = useState(false);
  // 拖拽期间按帧合并宽度提交：pointermove 频率高于刷新率时避免多余的重排
  const frameRef = useRef<number | null>(null);
  const pendingWidthRef = useRef<number | null>(null);

  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, Math.round(value))),
    [min, max],
  );

  const setDraggingState = useCallback(
    (next: boolean) => {
      draggingRef.current = next;
      setDragging(next);
      onDraggingChange?.(next);
    },
    [onDraggingChange],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 指针已失效时忽略捕获失败，拖拽逻辑照常执行
      }
      dragStartRef.current = { x: event.clientX, width };
      setDraggingState(true);
    },
    [width, setDraggingState],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      const delta = event.clientX - dragStartRef.current.x;
      const target =
        anchor === "left"
          ? dragStartRef.current.width + delta
          : dragStartRef.current.width - delta;
      pendingWidthRef.current = clamp(target);
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          if (pendingWidthRef.current === null) return;
          onResize(pendingWidthRef.current);
          pendingWidthRef.current = null;
        });
      }
    },
    [anchor, clamp, onResize],
  );

  const endDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      // 松手时提交尚未落帧的最终宽度，避免停在中间值
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (pendingWidthRef.current !== null) {
        onResize(pendingWidthRef.current);
        pendingWidthRef.current = null;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraggingState(false);
    },
    [setDraggingState, onResize],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const widen = anchor === "left" ? "ArrowRight" : "ArrowLeft";
      const narrow = anchor === "left" ? "ArrowLeft" : "ArrowRight";
      if (event.key === widen) {
        event.preventDefault();
        onResize(clamp(width + KEYBOARD_STEP));
      } else if (event.key === narrow) {
        event.preventDefault();
        onResize(clamp(width - KEYBOARD_STEP));
      }
    },
    [anchor, clamp, onResize, width],
  );

  useEffect(() => {
    if (!dragging) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={handleKeyDown}
      className={cn(
        "group relative z-10 hidden h-full w-1 shrink-0 cursor-col-resize touch-none select-none bg-transparent transition-colors",
        "after:absolute after:inset-y-0 after:-left-1.5 after:-right-1.5 after:content-['']",
        "hover:bg-brand/30 focus-visible:bg-brand/50 focus-visible:outline-none",
        dragging && "bg-brand/50",
        className,
      )}
    />
  );
}
