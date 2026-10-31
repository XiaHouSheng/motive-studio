/**
 * 移动端局域网监听运行时接口。
 *
 * 桌面版由 apps/server/src/desktop.ts 注入实现；Web 版本不传入该参数，
 * 移动路由保持原有行为。路由层只依赖此接口，不感知 Electron 与监听器实现。
 */
export interface MobileRuntime {
  /**
   * 确保局域网监听已启动（懒启动）。
   * 返回裸 origin 列表（不含路径与凭证），访问凭证由路由层拼接。
   * 启动失败时抛出明确错误；主服务不受影响。
   */
  ensureLanListener(): Promise<{ host: string; port: number; urls: string[] }>;

  /** 刷新局域网监听空闲计时；仅应在配对成功或移动凭证校验通过后调用。 */
  touch(): void;

  /** 当前局域网监听端口；未运行返回 null。用于二维码地址校验放行移动监听端口。 */
  getLanPort(): number | null;
}
