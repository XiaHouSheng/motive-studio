/**
 * Motive Studio 桌面壳 preload（sandbox 模式必须为 CJS）。
 *
 * 仅暴露最小窗口控制面：无任何 Node API、文件系统或网络能力，
 * 渲染进程通过 window.motiveWindow 发送单向 IPC 指令给主进程。
 * 在非 Electron 环境（纯浏览器打开 web UI）下不存在此桥，界面自动降级。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("motiveWindow", {
  isFrameless: true,
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  // 最大化/还原图标状态：invoke 查询初始值 + 订阅变化事件（返回退订函数）
  isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  onMaximizeChange: (callback) => {
    const listener = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", listener);
    return () => ipcRenderer.removeListener("window:maximized-changed", listener);
  },
});

// 通知主进程桥已注入成功，写入 main.log 供打包后冒烟验证
ipcRenderer.send("window:bridge-ready");
