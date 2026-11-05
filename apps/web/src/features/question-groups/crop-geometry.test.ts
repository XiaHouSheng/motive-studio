import { describe, expect, it } from "vitest";
import {
  normalizeAngle,
  pointerAngle,
  rotatePoint,
  rotatedAngle,
  shiftAnchor,
  toLocalDelta,
} from "./crop-geometry";

describe("normalizeAngle", () => {
  it("归一化到 [-180, 180)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(45)).toBe(45);
    expect(normalizeAngle(-45)).toBe(-45);
    expect(normalizeAngle(180)).toBe(-180);
    expect(normalizeAngle(-180)).toBe(-180);
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(540)).toBe(-180);
  });
});

describe("pointerAngle", () => {
  it("按屏幕坐标（y 轴向下）计算指针相对中心的角度", () => {
    expect(pointerAngle(0, 0, 10, 0)).toBe(0);
    expect(pointerAngle(0, 0, 0, 10)).toBe(90);
    expect(pointerAngle(0, 0, -10, 0)).toBe(180);
    expect(pointerAngle(0, 0, 0, -10)).toBe(-90);
  });
});

describe("rotatedAngle", () => {
  it("跟随指针角度差连续旋转", () => {
    expect(rotatedAngle(0, 0, 45)).toBe(45);
    expect(rotatedAngle(10, 0, 55)).toBe(65);
    expect(rotatedAngle(30, 100, 40)).toBe(-30);
  });

  it("跨越 ±180° 时不发生跳变", () => {
    // 179°→-179° 的指针扫过角度差为 2°（而非 -358°），结果 2° 落在吸附区归零，但绝不会跳到 ±358°
    expect(rotatedAngle(0, 179, -179)).toBe(0);
    // 吸附区外的连续旋转：40°、150° 均按角度差正常跟随
    expect(rotatedAngle(0, 160, -160)).toBe(40);
    expect(rotatedAngle(170, 0, -20)).toBe(150);
    expect(rotatedAngle(-170, 0, 20)).toBe(-150);
  });

  it("绝对角度 ≤3° 时吸附回 0°", () => {
    expect(rotatedAngle(0, 0, 3)).toBe(0);
    expect(rotatedAngle(0, 0, -3)).toBe(0);
    expect(rotatedAngle(0, 0, 3.5)).toBeCloseTo(3.5);
    expect(rotatedAngle(0, 0, -4)).toBeCloseTo(-4);
  });
});

describe("toLocalDelta", () => {
  it("0° 时屏幕位移与局部位移一致", () => {
    expect(toLocalDelta(10, 5, 0)).toEqual({ dx: 10, dy: 5 });
  });

  it("90° 时把屏幕位移旋转到选框局部坐标系", () => {
    const right = toLocalDelta(10, 0, 90);
    expect(right.dx).toBeCloseTo(0);
    expect(right.dy).toBeCloseTo(-10);
    const down = toLocalDelta(0, 10, 90);
    expect(down.dx).toBeCloseTo(10);
    expect(down.dy).toBeCloseTo(0);
  });
});

describe("rotatePoint", () => {
  it("按屏幕坐标（y 轴向下）顺时针旋转", () => {
    const rotated = rotatePoint(10, 0, 90);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(10);
    const rotatedBack = rotatePoint(0, 10, -90);
    expect(rotatedBack.x).toBeCloseTo(10);
    expect(rotatedBack.y).toBeCloseTo(0);
  });
});

describe("shiftAnchor", () => {
  it("0° 时无需校正，与未旋转版本行为一致", () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const resized = { x: 0, y: 0, width: 150, height: 100 };
    expect(shiftAnchor(start, resized, 0)).toEqual(resized);
  });

  it("90° 缩放时校正位移，使固定锚点的屏幕位置不漂移", () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const resized = { x: 0, y: 0, width: 150, height: 100 };
    expect(shiftAnchor(start, resized, 90)).toEqual({
      x: -25,
      y: 25,
      width: 150,
      height: 100,
    });
  });

  it("45° 缩放时校正位移方向为对角", () => {
    const start = { x: 0, y: 0, width: 100, height: 100 };
    const resized = { x: 0, y: 0, width: 150, height: 100 };
    const shifted = shiftAnchor(start, resized, 45);
    // 局部中心位移 s=(25,0)，Rot(45°)·s≈(17.68,17.68)，corr≈(-7.32,17.68)
    expect(shifted.x).toBeCloseTo(-7.32, 2);
    expect(shifted.y).toBeCloseTo(17.68, 2);
    expect(shifted.width).toBe(150);
    expect(shifted.height).toBe(100);
  });
});
