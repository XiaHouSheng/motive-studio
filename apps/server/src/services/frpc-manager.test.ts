import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFrpcConfig, FrpcManager, resolveFrpcBinary } from "./frpc-manager.js";

describe("buildFrpcConfig", () => {
  it("生成符合端口规范的配置：控制通道 39220、转发端口 39221、本机回环", () => {
    const config = buildFrpcConfig({ serverAddr: "203.0.113.9", authToken: "secret", localPort: 39217 });
    expect(config).toContain('serverAddr = "203.0.113.9"');
    expect(config).toContain("serverPort = 39220");
    expect(config).toContain('auth.token = "secret"');
    expect(config).toContain("transport.tls.enable = true");
    expect(config).toContain("loginFailExit = false");
    expect(config).toContain("localIP = \"127.0.0.1\"");
    expect(config).toContain("localPort = 39217");
    expect(config).toContain("remotePort = 39221");
  });
});

describe("resolveFrpcBinary", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-frpc-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("按序返回第一个存在的候选路径，全部缺失时返回 null", () => {
    const existing = path.join(dir, "frpc.exe");
    writeFileSync(existing, "");
    expect(resolveFrpcBinary([path.join(dir, "missing"), existing])).toBe(existing);
    expect(resolveFrpcBinary([path.join(dir, "missing")])).toBeNull();
    expect(resolveFrpcBinary([""])).toBeNull();
  });
});

describe("FrpcManager", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-frpc-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("二进制缺失时状态不可用，启动被标记为错误", () => {
    const manager = new FrpcManager({ candidatePaths: [path.join(dir, "missing.exe")], dataDir: dir });
    expect(manager.getStatus().available).toBe(false);
    manager.start({ serverAddr: "203.0.113.9", authToken: "secret" });
    expect(manager.getStatus().status).toBe("error");
  });

  it("setLocalPort 忽略非法端口", () => {
    const manager = new FrpcManager({ candidatePaths: [], dataDir: dir });
    manager.setLocalPort(0);
    manager.setLocalPort(Number.NaN);
    expect(manager.getStatus().status).toBe("stopped");
  });

  it("未启动时 stop 是安全的空操作，shutdown 可重复调用", () => {
    const manager = new FrpcManager({ candidatePaths: [], dataDir: dir });
    manager.stop();
    manager.shutdown();
    manager.shutdown();
    expect(manager.getStatus().status).toBe("stopped");
  });
});
