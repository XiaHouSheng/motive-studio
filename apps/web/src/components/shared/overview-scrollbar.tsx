import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

/** 拇指最小高度，避免长内容时 thumb 小到难以抓取 */
const MIN_THUMB_HEIGHT = 32;
/** 缩略图克隆重建的防抖间隔（ms） */
const MINIMAP_REBUILD_DEBOUNCE = 250;
/** 缩略图缩放上限：内容较短时不无限放大 */
const MAX_MINIMAP_SCALE = 0.35;

interface OverviewScrollbarProps {
  children: ReactNode;
  className?: string;
  /** 透传给内部滚动容器的布局类（保持原容器的 flex 结构） */
  scrollClassName?: string;
  /** 开启后右侧渲染 VSCode 式内容缩略图（minimap），而非纯滚动轨道 */
  minimap?: boolean;
  /** 暂停缩略图克隆重建（如面板拖宽过程中），恢复后补一次重建 */
  rebuildPaused?: boolean;
}

/**
 * 滚动容器增强：隐藏原生滚动条，右侧渲染概览轨道。
 *
 * - 默认：细滚动轨道 + 视口比例 thumb（高度 = clientH/scrollHeight 占比）
 * - minimap：轨道加宽，内部以 transform scale 渲染整个内容的只读克隆，
 *   thumb 为视口位置指示框 —— 高度 = clientHeight×scale、位置 = scrollTop×scale，
 *   点击/拖拽按 1/scale 反算滚动位置，与缩略图像素精确对应
 *
 * 内容变化（流式输出、图片加载）通过 MutationObserver 同步：
 * rAF 批量更新几何，防抖重建缩略图克隆。
 */
export function OverviewScrollbar({
  children,
  className,
  scrollClassName,
  minimap = false,
  rebuildPaused = false,
}: OverviewScrollbarProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const minimapViewportRef = useRef<HTMLDivElement>(null);
  const cloneHostRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ offsetY: number } | null>(null);
  const cloneWidthRef = useRef(0);
  const bodyLeftRef = useRef(0);
  /** 当前克隆缩放（仅用于 host transform） */
  const minimapScaleRef = useRef(0);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [active, setActive] = useState(false);
  const [minimapScale, setMinimapScale] = useState(0);

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
    const maxScroll = scrollHeight - clientHeight;
    if (minimap && minimapViewportRef.current) {
      // minimap：内容 [0, scrollHeight] 线性映射到条内 [0, vpH]
      // （克隆剥离 padding 后与 scrollHeight 不成正比，必须用 vpH 而非 scale 换算）
      const vpH = minimapViewportRef.current.clientHeight;
      if (vpH > 0) {
        const h = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * vpH);
        const top = Math.min((scrollTop / scrollHeight) * vpH, vpH - h);
        thumb.style.height = `${Math.round(h)}px`;
        thumb.style.transform = `translateY(${Math.round(Math.max(top, 0))}px)`;
        return;
      }
    }
    const trackH = track.clientHeight;
    if (trackH <= 0) return;
    const h = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * trackH);
    const top = maxScroll > 0 ? (scrollTop / maxScroll) * (trackH - h) : 0;
    thumb.style.height = `${Math.round(h)}px`;
    thumb.style.transform = `translateY(${Math.round(top)}px)`;
  }, []);

  // sync 通过 ref 保持最新引用，让 rebuild/观察器始终调用最新闭包
  const syncRef = useRef(sync);
  syncRef.current = sync;

  // 面板拖宽等场景暂停重建：克隆代价高（全量子树布局），恢复后补一次即可
  const rebuildPausedRef = useRef(rebuildPaused);
  rebuildPausedRef.current = rebuildPaused;
  const rebuildPendingRef = useRef(false);

  /** 重建缩略图克隆：缩放 = 轨道可用高度 / 克隆实际高度（上限 0.35） */
  const rebuildMinimap = useCallback(() => {
    if (!minimap) return;
    if (rebuildPausedRef.current) {
      rebuildPendingRef.current = true;
      console.log("[ovs] paused, pending=true");
      return;
    }
    const node = scrollRef.current;
    const viewport = minimapViewportRef.current;
    const host = cloneHostRef.current;
    if (!node || !viewport || !host) return;
    const source = node.firstElementChild as HTMLElement | null;
    if (!source) {
      host.replaceChildren();
      minimapScaleRef.current = 0;
      setMinimapScale(0);
      return;
    }
    const clone = source.cloneNode(true) as HTMLElement;
    host.replaceChildren(clone);
    cloneWidthRef.current = node.clientWidth;
    // 克隆内 margin/padding 已被 CSS 清零：按其实际高度定缩放，纹理铺满无留白
    // （transform 不影响 offsetHeight，可同步测量）
    const cloneHeight = Math.max(1, clone.offsetHeight);
    const availableH = Math.max(1, viewport.clientHeight);
    const scale = Math.min(MAX_MINIMAP_SCALE, availableH / cloneHeight);
    if (scale <= 0) return;
    // 主体对齐兜底：量克隆内残余偏移（margin 清零后应为 0）
    const body = clone.firstElementChild as HTMLElement | null;
    bodyLeftRef.current = body
      ? Math.max(
          0,
          body.getBoundingClientRect().left - clone.getBoundingClientRect().left,
        )
      : 0;
    minimapScaleRef.current = scale;
    setMinimapScale(scale);
    // scale 已写入 ref：立即按新几何同步指示框（不依赖下一次滚动/变更）
    syncRef.current();
  }, [minimap]);

  const rebuildMinimapTimer = useRef(0);
  const rebuildMinimapSoon = useCallback(() => {
    if (!minimap) return;
    window.clearTimeout(rebuildMinimapTimer.current);
    rebuildMinimapTimer.current = window.setTimeout(rebuildMinimap, MINIMAP_REBUILD_DEBOUNCE);
  }, [minimap, rebuildMinimap]);

  /** 把 thumb 顶部拖到指定视口位置，同步滚动位置（minimap 按 1/scale 反算内容坐标） */
  const dragThumbTo = useCallback((clientY: number) => {
    const node = scrollRef.current;
    const track = trackRef.current;
    if (!node || !track) return;
    const { scrollHeight, clientHeight } = node;
    const maxScroll = scrollHeight - clientHeight;
    if (maxScroll <= 0) return;
    if (minimap && minimapViewportRef.current) {
      const vpH = minimapViewportRef.current.clientHeight;
      if (vpH > 0) {
        const drag = dragRef.current;
        if (!drag) return;
        const rect = minimapViewportRef.current.getBoundingClientRect();
        // thumb 顶部位置（条内 px）线性反算内容坐标
        const thumbTop = clientY - drag.offsetY - rect.top;
        node.scrollTop = Math.min(Math.max((thumbTop / vpH) * scrollHeight, 0), maxScroll);
        return;
      }
    }
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
      // 点在 thumb/指示框上：记录指针相对其顶部的偏移；点在轨道上：中心跳到点击处
      const offsetY = inThumb ? event.clientY - thumbRect.top : thumbRect.height / 2;
      dragRef.current = { offsetY };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 指针已失效（合成事件/快速点击）时忽略捕获失败，拖拽逻辑照常执行
      }
      setActive(true);
      // dragThumbTo 内部自行扣除 offsetY（offsetY 已写入 dragRef）
      dragThumbTo(event.clientY);
    },
    [dragThumbTo],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragThumbTo(event.clientY);
    },
    [dragThumbTo],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setActive(false);
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    syncRef.current();
    const onScroll = () => syncRef.current();
    node.addEventListener("scroll", onScroll, { passive: true });
    // 容器自身尺寸变化（窗口缩放、侧栏拖宽）：同步几何并防抖重建缩略图（scale 依赖宽度）
    const resizeObserver = new ResizeObserver(() => {
      syncRef.current();
      rebuildMinimapSoon();
    });
    resizeObserver.observe(node);
    // 内容变化（流式输出、骨架屏替换、图片加载）：rAF 批量同步几何 + 防抖重建克隆
    let raf = 0;
    const mutationObserver = new MutationObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncRef.current();
        rebuildMinimapSoon();
      });
    });
    mutationObserver.observe(node, { childList: true, subtree: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(rebuildMinimapTimer.current);
    };
  }, [rebuildMinimapSoon]);

  // 轨道首次渲染后立即计算一次 thumb 几何与缩略图；暂停结束（拖宽结束）后补重建
  useEffect(() => {
    if (hasOverflow) {
      sync();
      rebuildMinimap();
    }
  }, [hasOverflow, sync, rebuildMinimap]);

  useEffect(() => {
    console.log("[ovs] unpause-effect", { rebuildPaused, pending: rebuildPendingRef.current });
    if (rebuildPaused || !rebuildPendingRef.current) return;
    rebuildPendingRef.current = false;
    rebuildMinimap();
  }, [rebuildPaused, rebuildMinimap]);

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
          className={cn(
            "absolute inset-y-0 right-0 z-20 cursor-pointer touch-none",
            minimap ? "w-20" : "w-2.5",
          )}
        >
          {minimap ? (
            <div ref={minimapViewportRef} className="minimap-viewport">
              <div
                ref={cloneHostRef}
                className="minimap-clone-host"
                style={
                  minimapScale > 0
                    ? {
                        width: cloneWidthRef.current,
                        transform: `scale(${minimapScale}) translateX(${-bodyLeftRef.current}px)`,
                      }
                    : undefined
                }
              />
            </div>
          ) : null}
          <div
            ref={thumbRef}
            className={cn(
              "absolute inset-x-0.5 rounded-md",
              minimap
                ? "border border-brand/30 bg-brand/8"
                : cn(
                    "right-0 inset-x-auto w-1 rounded-full bg-ink/20 transition-[width,background-color] duration-150",
                    active ? "w-1.5 bg-ink/40" : "hover:w-1.5 hover:bg-ink/40",
                  ),
              active && minimap && "border-brand/60 bg-brand/20",
            )}
          />
        </div>
      ) : null}
    </div>
  );
}
