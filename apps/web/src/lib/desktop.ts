/**
 * 桌面壳环境探测：Electron preload 通过 contextBridge 注入 window.motiveWindow，
 * 纯浏览器环境（直开 5173 或 web 部署）不存在该桥，窗口控件自动降级不渲染。
 */

export interface MotiveWindowBridge {
  isFrameless: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}

declare global {
  interface Window {
    motiveWindow?: MotiveWindowBridge;
  }
}

/** preload 在页面生命周期内恒定存在，模块加载时判定一次即可 */
export const isFrameless: boolean =
  typeof window !== "undefined" && window.motiveWindow?.isFrameless === true;

/**
 * 双击拖拽区最大化/还原时，命中交互元素（按钮/输入/链接等）不触发，
 * 避免在控件上快速双击误切换最大化状态。
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("button, input, a, [role='button'], [data-no-drag]") !== null
  );
}
