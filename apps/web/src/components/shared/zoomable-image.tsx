import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const WHEEL_STEP = 1.2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface ViewState {
  scale: number;
  /** 相对容器中心的平移量（px） */
  x: number;
  y: number;
}

const RESET_VIEW: ViewState = { scale: 1, x: 0, y: 0 };

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** 容器尺寸类（如 h-[70vh]） */
  className?: string;
  /** 操作提示文案（走 i18n，由调用方传入） */
  hint?: string;
}

/**
 * 可交互图片查看器：滚轮以光标为中心缩放，按住拖拽平移，双击复位。
 * 缩放/平移仅通过 transform 实现，容器自身不产生滚动，也不影响对话框布局。
 */
export function ZoomableImage({ src, alt, className, hint }: ZoomableImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>(RESET_VIEW);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  /** 以 (clientX, clientY) 为中心缩放，保持光标下的图像内容不动 */
  const zoomAt = useCallback((clientX: number, clientY: number, deltaY: number) => {
    const node = containerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setView((prev) => {
      const factor = deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      const scale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
      if (scale === prev.scale) return prev;
      if (scale === MIN_SCALE) return RESET_VIEW;
      const pointerX = clientX - rect.left - rect.width / 2;
      const pointerY = clientY - rect.top - rect.height / 2;
      const ratio = scale / prev.scale;
      const limitX = (rect.width * scale) / 2;
      const limitY = (rect.height * scale) / 2;
      return {
        scale,
        x: clamp(pointerX - (pointerX - prev.x) * ratio, -limitX, limitX),
        y: clamp(pointerY - (pointerY - prev.y) * ratio, -limitY, limitY),
      };
    });
  }, []);

  // React 的 onWheel 是 passive 监听，无法 preventDefault；这里挂原生非 passive 监听
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [zoomAt]);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || view.scale <= MIN_SCALE) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        baseX: view.x,
        baseY: view.y,
      };
      setDragging(true);
    },
    [view.scale, view.x, view.y],
  );

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setView((prev) => ({
      ...prev,
      x: drag.baseX + (event.clientX - drag.startClientX),
      y: drag.baseY + (event.clientY - drag.startClientY),
    }));
  }, []);

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative w-full select-none overflow-hidden rounded-lg border border-line bg-field/40",
        view.scale > MIN_SCALE && (dragging ? "cursor-grabbing" : "cursor-grab"),
        className,
      )}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => setView(RESET_VIEW)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="absolute top-1/2 left-1/2 max-h-full max-w-full"
        style={{
          transform: `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`,
        }}
      />
      {view.scale !== 1 ? (
        <span className="pointer-events-none absolute bottom-2 left-2 rounded-md border border-line bg-panel/85 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-soft backdrop-blur-sm">
          {Math.round(view.scale * 100)}%
        </span>
      ) : null}
      {hint ? (
        <span className="pointer-events-none absolute right-2 bottom-2 rounded-md bg-panel/70 px-1.5 py-0.5 text-[10px] text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
