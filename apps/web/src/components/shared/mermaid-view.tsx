import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, Maximize2 } from "lucide-react";
import { createMermaidPlugin } from "@streamdown/mermaid";
import { useThemeStore } from "@/stores/theme";
import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";
import { Dialog } from "@/components/ui/dialog";
import { ZoomableImage } from "@/components/shared/zoomable-image";

/**
 * 模块级渲染缓存：key = `${theme}::${源码}`，value = 渲染好的 SVG 字符串。
 * Streamdown 内置实现对每次挂载都重新跑 mermaid 解析（打开题目必然闪烁），
 * 这里命中缓存后跳过解析，重开题目近乎即时显示。
 */
const svgCache = new Map<string, string>();
const CACHE_LIMIT = 50;

/** 自适应放大上限：小图最多放大到原始尺寸的 2 倍，避免少量节点被拉成巨幅空框 */
const MAX_UPSCALE = 2;
/** 自适应高度上限（× 可视高度）：竖长图铺满宽度会撑满整屏，按比例截住 */
const MAX_HEIGHT_VIEWPORT_RATIO = 0.7;

const diagramPlugin = createMermaidPlugin();

const cacheKey = (theme: string, code: string) => `${theme}::${code}`;
const hashKey = (key: string) => {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

function rememberCache(key: string, svg: string) {
  if (!svgCache.has(key) && svgCache.size >= CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  svgCache.set(key, svg);
}

interface MermaidViewProps {
  code: string;
  isIncomplete: boolean;
}

/**
 * mermaid 示意图渲染器（经 Streamdown renderers 按 language=mermaid 接管）。
 * 加载期占位与成图高度解耦：占位区域预留较大高度，成图后以淡入呈现，
 * 避免内容区从空到高的瞬间跳动。
 * 成图后按容器宽度自适应缩放（上限 MAX_UPSCALE 倍原始尺寸），
 * 面板拖宽/窗口缩放时跟随重新适配。
 */
export function MermaidView({ code, isIncomplete }: MermaidViewProps) {
  const t = useT();
  const theme = useThemeStore((state) => state.resolved);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  // 缓存命中的标记：用于首帧跳过淡入动画，视觉上等同"早就渲染好了"
  const fromCacheRef = useRef(false);
  /** 图容器 ref：自适应缩放按其宽度计算可用空间 */
  const fitHostRef = useRef<HTMLDivElement>(null);

  /** mermaid SVG 无外部引用（securityLevel: strict），可直接作为 img 源复用缩放查看器 */
  const svgDataUrl = useMemo(
    () => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null),
    [svg],
  );

  /** 从 SVG 字符串解析 viewBox 原始尺寸（允许负原点），作为自适应缩放的基准 */
  const naturalSize = useMemo(() => {
    if (!svg) return null;
    const match = /viewBox="\s*(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s+(-?[\d.e+-]+)\s*"/.exec(
      svg,
    );
    if (!match) return null;
    const width = Number.parseFloat(match[3]);
    const height = Number.parseFloat(match[4]);
    if (!(width > 0) || !(height > 0)) return null;
    return { width, height };
  }, [svg]);

  // 自适应缩放：铺满容器宽度，上限 MAX_UPSCALE 倍原始尺寸（矢量放大不失真）。
  // useLayoutEffect 确保缩放在首帧绘制前完成，缓存命中时也不会闪出原始尺寸。
  useLayoutEffect(() => {
    const host = fitHostRef.current;
    if (!host || !naturalSize) return;
    let raf = 0;
    const applyFit = () => {
      const svgEl = host.querySelector("svg");
      if (!svgEl) return;
      const available = host.clientWidth;
      if (available <= 0) return;
      // 宽度铺满（上限 2 倍），同时限制缩放后高度不超过可视高度的 70%（竖长图）
      const maxHeight = window.innerHeight * MAX_HEIGHT_VIEWPORT_RATIO;
      const scale = Math.min(
        available / naturalSize.width,
        MAX_UPSCALE,
        maxHeight / naturalSize.height,
      );
      // mermaid 把 max-width 写成 style 属性，CSS 类盖不掉，只能改内联样式
      svgEl.style.maxWidth = "none";
      svgEl.style.width = `${Math.round(naturalSize.width * scale)}px`;
      svgEl.style.height = "auto";
    };
    applyFit();
    // 容器宽度变化（侧栏拖宽、窗口缩放、Tab 切换）时重新适配；
    // rAF 节流拖动期间的连续回调
    const observer = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyFit();
      });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [naturalSize]);

  useEffect(() => {
    if (isIncomplete) return;
    const key = cacheKey(theme, code);
    const cached = svgCache.get(key);
    if (cached) {
      fromCacheRef.current = true;
      setSvg(cached);
      setError(null);
      return;
    }

    let cancelled = false;
    fromCacheRef.current = false;
    setError(null);
    void (async () => {
      try {
        const instance = diagramPlugin.getMermaid({
          theme: theme === "dark" ? "dark" : "default",
          // 与应用正文一致的字体，示意图标签不会显得突兀
          fontFamily: "system-ui, 'Microsoft YaHei', sans-serif",
        });
        const { svg: rendered } = await instance.render(`mmd-${hashKey(key)}`, code);
        if (cancelled) return;
        if (!rendered) throw new Error("mermaid 未返回 SVG");
        rememberCache(key, rendered);
        setSvg(rendered);
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : String(renderError));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, theme, isIncomplete]);

  return (
    <div
      className="group relative my-4 w-full rounded-xl border border-line bg-panel p-4"
      data-mermaid-card=""
    >
      {svg ? (
        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          aria-label={t("markdown.mermaidExpand")}
          title={t("markdown.mermaidExpand")}
          className="absolute top-2.5 right-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-selection hover:text-ink"
        >
          <Maximize2 size={12} strokeWidth={1.8} />
        </button>
      ) : null}
      <div
        ref={fitHostRef}
        role={svg ? "button" : undefined}
        aria-label={svg ? t("markdown.mermaidExpand") : undefined}
        onClick={svg ? () => setZoomOpen(true) : undefined}
        className={cn(
          "flex min-h-[200px] items-center justify-center overflow-x-auto",
          svg && "cursor-zoom-in",
        )}
      >
        {error ? (
          <div className="flex max-w-full flex-col gap-1.5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5">
            <span className="text-[12px] font-medium text-danger">
              {t("markdown.mermaidError")}
            </span>
            <pre className="max-h-28 max-w-[560px] overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-danger/80">
              {error}
            </pre>
          </div>
        ) : svg ? (
          <div
            className={cn(fromCacheRef.current ? "" : "animate-fade-in")}
            // mermaid 输出受 securityLevel: strict 约束，此处仅为呈现其渲染结果
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-ink-faint">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("markdown.mermaidLoading")}</span>
          </div>
        )}
      </div>

      <Dialog
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        title={t("markdown.mermaidDialogTitle")}
        className="max-w-[960px]"
      >
        {svgDataUrl ? (
          <ZoomableImage
            src={svgDataUrl}
            alt={t("markdown.mermaidAriaLabel")}
            className="h-[70vh]"
            hint={t("solution.asset.zoomHint")}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
