import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

/** 拇指最小高度，避免长内容时 thumb 小到难以抓取 */
const MIN_THUMB_HEIGHT = 32;

interface OverviewScrollbarProps {
  children: ReactNode;
  className?: string;
  /** 透传给内部滚动容器的布局类（保持原容器的 flex 结构） */
  scrollClassName?: string;
}

/**
 * VSCode 风格的概览滚动条：容器隐藏原生滚动条，右侧叠加一条概览轨道。
 * thumb 高度即视口占比；支持点击轨道跳转与拖拽平移，hover/拖拽时加宽。
 * 内容高度变化（流式输出、图片加载）通过 ResizeObserver 同步。
 */
export function OverviewScrollbar({ children, className, scrollClassName }: OverviewScrollbarProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetY: number } | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [active, setActive] = useState(false);

  const sync = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    const { scrollTop, scrollHeight, clientHeight } = node;
    // 溢出判断只依赖滚动容器本身：轨道尚未渲染（首次出现溢出）时也能触发显示
    const overflow = scrollHeight > clientHeight + 1;
    setHasOverflow(overflow);
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!overflow || !track || !thumb) return;
    const trackH = track.clientHeight;
    if (trackH <= 0) return;
    const maxScroll = scrollHeight - clientHeight;
    const h = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * trackH);
    const top = maxScroll > 0 ? (scrollTop / maxScroll) * (trackH - h) : 0;
    thumb.style.height = `${Math.round(h)}px`;
    thumb.style.transform = `translateY(${Math.round(top)}px)`;
  }, []);

  // 轨道首次渲染后立即计算一次 thumb 几何
  useEffect(() => {
    if (hasOverflow) sync();
  }, [hasOverflow, sync]);

  // sync 通过 ref 保持最新引用，观察器只绑定一次
  const syncRef = useRef(sync);
  syncRef.current = sync;

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    syncRef.current();
    const onScroll = () => syncRef.current();
    node.addEventListener("scroll", onScroll, { passive: true });
    // 容器自身尺寸变化（窗口缩放等）
    const resizeObserver = new ResizeObserver(() => syncRef.current());
    resizeObserver.observe(node);
    // 内容变化（流式输出、骨架屏替换、图片加载）：rAF 批量同步，避免高频布局读
    let raf = 0;
    const mutationObserver = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncRef.current();
      });
    });
    mutationObserver.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /** 把 thumb 顶部拖到指定视口位置，同步滚动位置 */
  const dragThumbTo = useCallback((clientY: number) => {
    const node = scrollRef.current;
    const track = trackRef.current;
    if (!node || !track) return;
    const { scrollHeight, clientHeight } = node;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) return;
    const rect = track.getBoundingClientRect();
    const trackH = rect.height;
    if (trackH <= 0) return;
    const h = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * trackH);
    const top = clientY - rect.top;
    const ratio = Math.min(1, Math.max(0, top / (trackH - h)));
    node.scrollTop = ratio * maxScroll;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const thumb = thumbRef.current;
      if (!thumb) return;
      const thumbRect = thumb.getBoundingClientRect();
      const inThumb = event.clientY >= thumbRect.top && event.clientY <= thumbRect.bottom;
      // 点在 thumb 上：记录指针相对 thumb 顶部的偏移；点在轨道上：thumb 中心跳到点击处
      const offsetY = inThumb ? event.clientY - thumbRect.top : thumbRect.height / 2;
      dragRef.current = { offsetY };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 指针已失效（合成事件/快速点击）时忽略捕获失败，拖拽逻辑照常执行
      }
      setActive(true);
      dragThumbTo(event.clientY - offsetY);
    },
    [dragThumbTo],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragThumbTo(event.clientY - drag.offsetY);
    },
    [dragThumbTo],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setActive(false);
  }, []);

  return (
    <div className={cn("relative min-h-0", className)}>
      <div
        ref={scrollRef}
        onScroll={sync}
        className={cn("overview-scroll h-full overflow-y-auto", scrollClassName)}
      >
        {children}
      </div>
      {hasOverflow ? (
        <div
          ref={trackRef}
          role="scrollbar"
          aria-orientation="vertical"
          aria-label={t("workspace.overviewScrollbar")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute inset-y-0 right-0 z-20 w-2.5 cursor-pointer touch-none"
        >
          <div
            ref={thumbRef}
            className={cn(
              "absolute right-0 rounded-full bg-ink/20 transition-[width,background-color] duration-150",
              active ? "w-1.5 bg-ink/40" : "w-1 hover:w-1.5 hover:bg-ink/40",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
