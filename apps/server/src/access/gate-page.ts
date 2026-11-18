/**
 * 远程接入绑定页（服务端兜底渲染）。
 *
 * VPS 静态托管场景由 apps/web/public/bind.html 承担（Caddy 将未持密钥的
 * 文档请求重写到该页）；桌面直连 Web 版（无静态托管）时由门卫以本页响应。
 * 两者保持同一 API 契约：POST /api/access/verify { token }。
 */
export function renderGatePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>绑定访问密钥 · Motive Studio</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0f1513; color: #e8f1ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 360px; width: 100%;
    border: 1px solid #2d3d38; border-radius: 14px; background: #192321; padding: 36px 24px;
  }
  h1 { font-size: 20px; margin-bottom: 12px; text-align: center; }
  p { font-size: 14px; color: #e8f1ee; line-height: 1.7; }
  .hint { margin-top: 12px; font-size: 13px; color: #7b918a; }
  input, button {
    width: 100%; box-sizing: border-box; margin-top: 12px; padding: 10px 12px;
    border-radius: 8px; border: 1px solid #2d3d38; font-size: 14px;
  }
  input { background: #0f1513; color: #e8f1ee; }
  button { background: #2f6f62; color: #e8f1ee; border: none; cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  #status { min-height: 20px; margin-top: 12px; font-size: 13px; color: #d08770; text-align: center; }
</style>
</head>
<body>
<main class="card">
  <h1>绑定访问密钥</h1>
  <p>输入桌面端「远程访问」面板生成的密钥，本设备将保持登录状态。</p>
  <input id="token" type="password" placeholder="访问密钥" autocomplete="off">
  <button id="submit" type="button">绑定</button>
  <div id="status"></div>
  <p class="hint">密钥可在桌面端设置 → 远程访问中查看或重新生成。</p>
</main>
<script>
(function () {
  var input = document.getElementById("token");
  var button = document.getElementById("submit");
  var status = document.getElementById("status");
  function bind(token) {
    if (!token) { status.textContent = "请输入访问密钥"; return; }
    button.disabled = true;
    status.textContent = "正在验证…";
    fetch("/api/access/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    }).then(function (res) {
      if (res.ok) { location.replace("/"); return; }
      return res.json().catch(function () { return {}; }).then(function (body) {
        button.disabled = false;
        status.textContent = body.code === "RATE_LIMITED"
          ? "尝试过于频繁，请稍后再试"
          : "访问密钥不正确，请检查后重试";
      });
    }).catch(function () {
      button.disabled = false;
      status.textContent = "网络异常，请稍后重试";
    });
  }
  button.addEventListener("click", function () { bind(input.value.trim()); });
  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") bind(input.value.trim());
  });
  var queryToken = new URLSearchParams(location.search).get("t");
  if (queryToken) bind(queryToken);
})();
</script>
</body>
</html>
`;
}
