/** 手机拍照导入页：服务端托管的单文件 HTML（无框架、无外部资源）。 */

export function renderMobilePage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>拍照导入题目 · Motive Studio</title>
<style>
  :root {
    --bg: #0f1513;
    --panel: #192321;
    --border: #2d3d38;
    --primary: #2dd4bf;
    --text: #e8f1ee;
    --muted: #7b918a;
    --danger: #f87171;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  html { -webkit-text-size-adjust: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    min-height: 100vh;
    padding: 20px 16px 120px;
  }
  .top { padding-bottom: 16px; }
  .brand { font-size: 12px; letter-spacing: 2px; color: var(--muted); text-transform: uppercase; }
  h1 { font-size: 22px; margin-top: 4px; }
  .sub { font-size: 13px; color: var(--muted); margin-top: 4px; }
  section { margin-bottom: 16px; }
  h2 { font-size: 16px; margin: 20px 0 8px; }
  .hidden { display: none !important; }
  .thumbs { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; }
  .thumb { position: relative; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: var(--panel); }
  .thumb img { display: block; width: 100%; height: 130px; object-fit: cover; }
  .thumb-del {
    position: absolute; top: 6px; right: 6px;
    width: 30px; height: 30px; border-radius: 8px;
    border: none; background: rgba(15, 21, 19, 0.8); color: var(--text);
    font-size: 16px; line-height: 1;
  }
  .pick-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  button { font-family: inherit; cursor: pointer; }
  .pick {
    min-height: 48px; border-radius: 10px;
    border: 1px solid var(--border); background: var(--panel); color: var(--text);
    font-size: 15px;
  }
  .primary {
    width: 100%; min-height: 48px; border-radius: 10px; border: none;
    background: var(--primary); color: #0f1513; font-size: 16px; font-weight: 600;
  }
  .primary:disabled { opacity: 0.45; }
  .hint { font-size: 12px; color: var(--muted); margin-top: 8px; text-align: center; }
  .progress { text-align: center; padding: 48px 0; }
  .spinner {
    width: 32px; height: 32px; margin: 0 auto 14px;
    border: 3px solid var(--border); border-top-color: var(--primary);
    border-radius: 50%; animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .q-card { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: 12px; margin-bottom: 10px; }
  .q-head { display: flex; align-items: center; gap: 10px; font-size: 14px; color: var(--muted); min-height: 24px; }
  .q-head input[type="checkbox"] { width: 20px; height: 20px; accent-color: var(--primary); }
  .q-card textarea {
    width: 100%; margin-top: 10px; min-height: 110px; resize: vertical;
    border: 1px solid var(--border); border-radius: 8px; background: var(--bg);
    color: var(--text); font-size: 14px; line-height: 1.6; padding: 10px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  }
  .target { border: 1px solid var(--border); border-radius: 10px; background: var(--panel); padding: 14px; }
  .radio { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 15px; }
  .radio input[type="radio"] { width: 20px; height: 20px; accent-color: var(--primary); }
  select, .target input[type="text"] {
    width: 100%; min-height: 44px; border-radius: 8px; margin-bottom: 10px;
    border: 1px solid var(--border); background: var(--bg); color: var(--text);
    font-size: 15px; padding: 0 12px;
  }
  #commit-bar {
    position: fixed; left: 0; right: 0; bottom: 0;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: rgba(15, 21, 19, 0.94); border-top: 1px solid var(--border);
  }
  .done { text-align: center; padding: 48px 0; }
  .done-icon {
    width: 56px; height: 56px; margin: 0 auto 16px; border-radius: 50%;
    background: rgba(45, 212, 191, 0.15); color: var(--primary);
    font-size: 28px; line-height: 56px;
  }
  .error {
    margin: 12px 0; padding: 12px; border-radius: 10px;
    border: 1px solid rgba(248, 113, 113, 0.4); background: rgba(248, 113, 113, 0.1);
    color: var(--danger); font-size: 14px;
  }
  .mono { font-variant-numeric: tabular-nums; }
</style>
</head>
<body>
<div class="top">
  <div class="brand">Motive Studio</div>
  <h1>拍照导入题目</h1>
  <p class="sub">拍摄题目图片，AI 识别后导入题组</p>
</div>

<section id="step-capture">
  <div id="thumbs" class="thumbs"></div>
  <div class="pick-row" id="pick-row">
    <button type="button" class="pick" id="btn-camera">拍照</button>
    <button type="button" class="pick" id="btn-gallery">相册选择</button>
  </div>
  <button type="button" class="primary" id="btn-extract" disabled>识别题目</button>
  <p class="hint" id="count-hint">已选 0 / 4 张，自动压缩后识别</p>
</section>

<section id="step-target">
  <h2>导入位置</h2>
  <div class="target">
    <label class="radio"><input type="radio" name="target" value="existing" checked>加入已有题组</label>
    <div id="existing-wrap">
      <select id="group-select"></select>
    </div>
    <label class="radio"><input type="radio" name="target" value="new">新建题组</label>
    <div id="new-wrap" class="hidden">
      <input type="text" id="group-title" placeholder="题组名称（留空自动命名）">
    </div>
  </div>
</section>

<section id="step-progress" class="progress hidden">
  <div class="spinner"></div>
  <p id="progress-text">AI 识别中…</p>
</section>

<section id="step-preview" class="hidden">
  <h2>识别结果 <span id="q-count" class="mono"></span></h2>
  <p class="sub">勾选需要导入的题目，内容可直接编辑</p>
  <div id="questions" style="margin-top: 12px;"></div>
</section>

<section id="step-done" class="done hidden">
  <div class="done-icon">✓</div>
  <h2>导入成功</h2>
  <p class="sub" id="done-msg"></p>
  <div style="margin-top: 24px;">
    <button type="button" class="primary" id="btn-again">再拍一页</button>
  </div>
</section>

<p id="error" class="error hidden"></p>

<div id="commit-bar" class="hidden">
  <button type="button" class="primary" id="btn-commit">导入 0 道题目</button>
</div>

<input type="file" id="file-camera" accept="image/*" capture="environment" multiple hidden>
<input type="file" id="file-gallery" accept="image/*" multiple hidden>

<script>
(function () {
  'use strict';
  var MAX_IMAGES = 4;
  var MAX_EDGE = 1600;
  var MAX_BYTES = 4 * 1024 * 1024;
  var token = new URLSearchParams(location.search).get('t') || '';
  var state = {
    status: 'idle',
    images: [],
    questions: [],
    groups: []
  };

  function el(id) { return document.getElementById(id); }

  function showError(message) {
    var node = el('error');
    node.textContent = message;
    node.classList.remove('hidden');
  }
  function clearError() { el('error').classList.add('hidden'); }

  function setStatus(next) {
    state.status = next;
    el('step-capture').classList.toggle('hidden', next !== 'idle');
    el('step-target').classList.toggle('hidden', next !== 'idle' && next !== 'preview');
    el('step-progress').classList.toggle('hidden', next !== 'recognizing' && next !== 'committing');
    el('step-preview').classList.toggle('hidden', next !== 'preview');
    el('step-done').classList.toggle('hidden', next !== 'done');
    el('progress-text').textContent = next === 'committing' ? '导入中…' : 'AI 识别中…';
    updateCommitBar();
    clearError();
    window.scrollTo(0, 0);
  }

  function handleErr(err) {
    if (err && err.status === 403) {
      showError('访问凭证无效或已过期，请在桌面端重新扫码');
    } else {
      showError((err && err.message) || '请求失败，请重试');
    }
  }

  function api(path, options) {
    var config = options || {};
    var headers = { 'X-Mobile-Token': token };
    if (config.body) headers['Content-Type'] = 'application/json';
    return fetch(path, Object.assign({ headers: headers }, config)).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) {
          var err = new Error((body && body.message) || '请求失败');
          err.status = res.status;
          throw err;
        }
        return body;
      });
    });
  }

  function compressFile(file) {
    return new Promise(function (resolve, reject) {
      if (!/^image\\//.test(file.type)) { reject(new Error('仅支持图片文件')); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          var data = dataUrl.slice(dataUrl.indexOf(',') + 1);
          var bytes = Math.ceil(data.length * 3 / 4);
          if (bytes > MAX_BYTES) { reject(new Error('图片压缩后仍超过 4MB，请减少内容后重试')); return; }
          resolve({ mediaType: 'image/jpeg', data: data, preview: dataUrl });
        };
        img.onerror = function () { reject(new Error('图片读取失败')); };
        img.src = reader.result;
      };
      reader.onerror = function () { reject(new Error('图片读取失败')); };
      reader.readAsDataURL(file);
    });
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    var slots = MAX_IMAGES - state.images.length;
    if (slots <= 0) { showError('最多选择 ' + MAX_IMAGES + ' 张图片'); return; }
    if (files.length > slots) {
      files = files.slice(0, slots);
      showError('最多选择 ' + MAX_IMAGES + ' 张图片，已保留前 ' + slots + ' 张');
    }
    Promise.all(files.map(compressFile)).then(function (items) {
      state.images = state.images.concat(items);
      renderThumbs();
    }).catch(function (err) {
      showError(err.message || '图片处理失败');
    });
  }

  function renderThumbs() {
    var wrap = el('thumbs');
    wrap.innerHTML = '';
    state.images.forEach(function (img, index) {
      var cell = document.createElement('div');
      cell.className = 'thumb';
      var image = document.createElement('img');
      image.src = img.preview;
      image.alt = '第 ' + (index + 1) + ' 张图片';
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'thumb-del';
      del.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 张图片');
      del.textContent = '×';
      del.onclick = function () {
        state.images.splice(index, 1);
        renderThumbs();
      };
      cell.appendChild(image);
      cell.appendChild(del);
      wrap.appendChild(cell);
    });
    el('btn-extract').disabled = state.images.length === 0;
    el('pick-row').classList.toggle('hidden', state.images.length >= MAX_IMAGES);
    el('count-hint').textContent = '已选 ' + state.images.length + ' / ' + MAX_IMAGES + ' 张，自动压缩后识别';
  }

  function applyTargetMode(useNew) {
    document.querySelector('input[name="target"][value="existing"]').checked = !useNew;
    document.querySelector('input[name="target"][value="new"]').checked = useNew;
    el('existing-wrap').classList.toggle('hidden', useNew);
    el('new-wrap').classList.toggle('hidden', !useNew);
  }

  function loadGroups() {
    return api('/api/mobile/groups').then(function (body) {
      state.groups = body.groups || [];
      var select = el('group-select');
      var existingRadio = document.querySelector('input[name="target"][value="existing"]');
      var wasDisabled = existingRadio.disabled;
      select.innerHTML = '';
      if (state.groups.length === 0) {
        existingRadio.disabled = true;
        applyTargetMode(true);
        return;
      }
      state.groups.forEach(function (group) {
        var option = document.createElement('option');
        option.value = group.id;
        option.textContent = group.title + '（' + group.questionCount + ' 题）';
        select.appendChild(option);
      });
      existingRadio.disabled = false;
      select.selectedIndex = 0;
      // 从「暂无题组」恢复为有题组时，切回加入已有题组
      if (wasDisabled) applyTargetMode(false);
    });
  }

  function renderQuestions() {
    var wrap = el('questions');
    wrap.innerHTML = '';
    state.questions.forEach(function (q, index) {
      var card = document.createElement('div');
      card.className = 'q-card';
      var head = document.createElement('label');
      head.className = 'q-head';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = q.checked;
      box.onchange = function () { q.checked = box.checked; updateCommitBar(); };
      var label = document.createElement('span');
      label.textContent = '题目 ' + (index + 1);
      head.appendChild(box);
      head.appendChild(label);
      var area = document.createElement('textarea');
      area.value = q.content;
      area.oninput = function () { q.content = area.value; };
      card.appendChild(head);
      card.appendChild(area);
      wrap.appendChild(card);
    });
    el('q-count').textContent = '共 ' + state.questions.length + ' 道';
  }

  function updateCommitBar() {
    var bar = el('commit-bar');
    if (state.status !== 'preview') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    var count = 0;
    state.questions.forEach(function (q) {
      if (q.checked && q.content.trim()) count += 1;
    });
    el('btn-commit').textContent = '导入 ' + count + ' 道题目';
    el('btn-commit').disabled = count === 0;
  }

  el('btn-camera').onclick = function () { el('file-camera').click(); };
  el('btn-gallery').onclick = function () { el('file-gallery').click(); };
  el('file-camera').onchange = function () { handleFiles(this.files); this.value = ''; };
  el('file-gallery').onchange = function () { handleFiles(this.files); this.value = ''; };

  Array.prototype.forEach.call(document.querySelectorAll('input[name="target"]'), function (radio) {
    radio.onchange = function () {
      applyTargetMode(document.querySelector('input[name="target"]:checked').value === 'new');
    };
  });

  el('btn-extract').onclick = function () {
    if (state.images.length === 0) return;
    setStatus('recognizing');
    var images = state.images.map(function (img) {
      return { mediaType: img.mediaType, data: img.data };
    });
    api('/api/mobile/extract', { method: 'POST', body: JSON.stringify({ images: images }) })
      .then(function (body) {
        state.questions = (body.questions || []).map(function (text) {
          return { content: text, checked: true };
        });
        if (state.questions.length === 0) {
          showError('未识别到题目，请调整图片后重试');
          setStatus('idle');
          return null;
        }
        return loadGroups()
          .catch(function () { /* 题组刷新失败不阻塞预览 */ })
          .then(function () {
            renderQuestions();
            setStatus('preview');
          });
      })
      .catch(function (err) {
        handleErr(err);
        setStatus('idle');
      });
  };

  el('btn-commit').onclick = function () {
    var checked = [];
    state.questions.forEach(function (q) {
      if (q.checked && q.content.trim()) checked.push(q.content.trim());
    });
    if (checked.length === 0) { showError('请至少选择一道题目'); return; }
    var useNew = document.querySelector('input[name="target"]:checked').value === 'new';
    var target;
    if (useNew) {
      target = { type: 'new', title: el('group-title').value.trim() };
    } else {
      var groupId = el('group-select').value;
      if (!groupId) { showError('请选择目标题组'); return; }
      target = { type: 'existing', groupId: groupId };
    }
    setStatus('committing');
    var payload = { target: target, questions: checked };
    // 原图一并提交，桌面端可核对识别结果
    if (state.images.length > 0) {
      payload.images = state.images.map(function (img) {
        return { mediaType: img.mediaType, data: img.data };
      });
    }
    api('/api/mobile/commit', {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(function (body) {
        el('done-msg').textContent = '已导入 ' + body.questions.length + ' 道题目到「' + body.groupTitle + '」，回到桌面端即可查看';
        setStatus('done');
      })
      .catch(function (err) {
        handleErr(err);
        setStatus('preview');
      });
  };

  el('btn-again').onclick = function () {
    state.images = [];
    state.questions = [];
    renderThumbs();
    setStatus('idle');
    loadGroups().catch(function () { /* 保持当前列表 */ });
  };

  renderThumbs();
  // 进入页面即加载当前题组，拍照前就能看到导入位置
  loadGroups().catch(handleErr);
})();
</script>
</body>
</html>
`;
}

export function renderDeniedPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>无法访问 · Motive Studio</title>
<style>
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0f1513; color: #e8f1ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    padding: 24px;
  }
  .card {
    max-width: 360px; width: 100%; text-align: center;
    border: 1px solid #2d3d38; border-radius: 14px; background: #192321; padding: 36px 24px;
  }
  h1 { font-size: 20px; margin-bottom: 12px; }
  p { font-size: 14px; color: #e8f1ee; line-height: 1.7; }
  .hint { margin-top: 12px; font-size: 13px; color: #7b918a; }
</style>
</head>
<body>
<main class="card">
  <h1>无法访问</h1>
  <p>访问凭证无效或已过期，请重新扫码。</p>
  <p class="hint">请在桌面端重新打开「手机拍照导入」获取新的二维码。</p>
</main>
</body>
</html>
`;
}
