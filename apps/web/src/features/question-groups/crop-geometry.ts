/**
 * 裁剪选框旋转的纯几何计算（桌面端与手机拍照页共用同一套公式与参数；
 * 手机页为内联脚本无法直接导入模块，但必须保持公式逐字一致）。
 *
 * 坐标系约定：
 * - 交互一律使用图片显示坐标（CSS px，y 轴向下）；
 * - 输出画布时按 scaleX/scaleY 换算到原始图片像素，禁止重复应用缩放；
 * - 角度统一使用度数，三角函数计算时转换为弧度。
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 归一化角度到 [-180, 180)，避免跨越 ±180° 时的角度跳变 */
export function normalizeAngle(angle: number): number {
  return (((angle + 180) % 360) + 360) % 360 - 180;
}

/** 指针相对选框中心的角度（度，屏幕坐标 y 轴向下，与 CSS rotate 正方向一致） */
export function pointerAngle(
  centerX: number,
  centerY: number,
  pointerX: number,
  pointerY: number,
): number {
  return (Math.atan2(pointerY - centerY, pointerX - centerX) * 180) / Math.PI;
}

const SNAP_DEGREES = 3;

/**
 * 由拖动开始时的选框角度与指针角度差计算新角度。
 * 使用归一化角度差保证旋转连续，绝对角度 ≤3° 时吸附回 0°。
 */
export function rotatedAngle(
  startAngle: number,
  startPointerAngle: number,
  currentPointerAngle: number,
): number {
  const delta = normalizeAngle(currentPointerAngle - startPointerAngle);
  const angle = normalizeAngle(startAngle + delta);
  return Math.abs(angle) <= SNAP_DEGREES ? 0 : angle;
}

/** 把屏幕位移旋转到选框局部坐标系（用于缩放手柄跟随选框方向） */
export function toLocalDelta(
  dx: number,
  dy: number,
  angle: number,
): { dx: number; dy: number } {
  const rotated = rotatePoint(dx, dy, -angle);
  return { dx: rotated.x, dy: rotated.y };
}

/** 绕原点旋转（度） */
export function rotatePoint(x: number, y: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

/**
 * 缩放后校正选框位置：resizeRect 在局部（未旋转）坐标系里保持锚点固定，
 * 但选框绕自身中心旋转，中心随缩放平移会让锚点在屏幕上漂移。
 * 设局部中心位移为 s，校正量 corr = Rot(θ)·s − s，把锚点的屏幕位置拉回原处。
 * 0° 时 corr 为零，行为与未旋转版本完全一致。
 */
export function shiftAnchor(start: Rect, resized: Rect, angle: number): Rect {
  const shiftX = resized.x + resized.width / 2 - (start.x + start.width / 2);
  const shiftY = resized.y + resized.height / 2 - (start.y + start.height / 2);
  const rotated = rotatePoint(shiftX, shiftY, angle);
  return {
    x: resized.x + rotated.x - shiftX,
    y: resized.y + rotated.y - shiftY,
    width: resized.width,
    height: resized.height,
  };
}
