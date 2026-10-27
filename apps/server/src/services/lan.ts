import os from "node:os";

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 192 && b === 168) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** 常见家用/办公 Wi-Fi 网段优先；172.16-31 多为 Docker/WSL 等虚拟网卡，排最后 */
function addressRank(address: string): number {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4) return 4;
  const [a, b] = parts;
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 3;
  if (isPrivateIPv4(address)) return 2;
  return 4;
}

function getLocalIPv4Addresses(): string[] {
  const result: string[] = [];
  for (const addresses of Object.values(os.networkInterfaces())) {
    if (!addresses) continue;
    for (const item of addresses) {
      if (item.family !== "IPv4" || item.internal) continue;
      if (!result.includes(item.address)) result.push(item.address);
    }
  }
  // 按网段优先级排序，同优先级保持系统顺序
  return result
    .map((address, index) => ({ address, index }))
    .sort((left, right) => addressRank(left.address) - addressRank(right.address) || left.index - right.index)
    .map((item) => item.address);
}

/** 返回局域网可访问的裸 origin 列表（不含路径与凭证）。 */
export function getLanAddresses(port: number): string[] {
  return getLocalIPv4Addresses().map((address) => `http://${address}:${port}`);
}

/** 校验二维码目标 URL 必须指向本机，避免变成任意地址二维码生成器。 */
export function isAllowedQrUrl(rawUrl: string, port: number): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:") return false;
    if (url.port && url.port !== String(port)) return false;
    if (!url.port && port !== 80) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "127.0.0.1" || hostname === "localhost") return true;
    return getLocalIPv4Addresses().includes(hostname);
  } catch {
    return false;
  }
}
