// 喋る絵の点打ち：絵の上に目印を順にクリックして points.json を作る（tools/prepare.py が読む）。
(() => {
  const $ = (s) => document.querySelector(s);
  // 点の順番（向かって左＝L）。opt＝無くても作れる（そのときは顔の大きさから見積もる）
  const STEPS = [
    ['目', 'eyeL_outer', '左目（向かって左）の目じり', '上下のまぶたが合わさる、外側の角'],
    ['目', 'eyeL_inner', '左目の目がしら', '鼻に近い方の角'],
    ['目', 'eyeR_inner', '右目（向かって右）の目がしら', '鼻に近い方の角'],
    ['目', 'eyeR_outer', '右目の目じり', '外側の角'],
    ['眉', 'browL_out', '左眉の外の端', '', true],
    ['眉', 'browL_in', '左眉の内の端', '', true],
    ['眉', 'browR_in', '右眉の内の端', '', true],
    ['眉', 'browR_out', '右眉の外の端', '', true],
    ['顔', 'nose', '鼻先', '鼻のいちばん下（光っている所）'],
    ['顔', 'mouth_l', '口の左の端（口角）', ''],
    ['顔', 'mouth_r', '口の右の端（口角）', ''],
    ['顔', 'chin', 'あご先', '顔の輪郭のいちばん下'],
    ['顔', 'earL', '左耳のまん中', '髪で隠れていれば、顔の左の端'],
    ['顔', 'earR', '右耳のまん中', '髪で隠れていれば、顔の右の端'],
    ['顔', 'forehead', 'おでこの生え際（まん中）', '髪と肌の境目'],
    ['体', 'collar_l', '襟の上の左端', '首の付け根の左（服の上の縁）', true],
    ['体', 'collar_r', '襟の上の右端', '首の付け根の右', true],
    ['体', 'shoulder_l', '左肩のいちばん上', '服の輪郭', true],
    ['体', 'shoulder_r', '右肩のいちばん上', '', true],
    ['髪', 'hair_top', '髪のいちばん上', '頭のてっぺん', true],
    ['髪', 'hair_l', '髪のいちばん左', '', true],
    ['髪', 'hair_r', '髪のいちばん右', '', true],
    ['髪', 'hair_bottom', '髪のいちばん下（毛先）', '', true],
  ];
  const SAMPLE = { eyeL_outer: [371, 634], eyeL_inner: [535, 649], eyeR_inner: [687, 632], eyeR_outer: [869, 626], browL_out: [392, 522], browL_in: [546, 506],
    browR_in: [676, 506], browR_out: [842, 520], nose: [627, 716], mouth_l: [561, 815], mouth_r: [679, 815], chin: [627, 943], earL: [331, 640], earR: [915, 640],
    forehead: [627, 316], collar_l: [429, 928], collar_r: [833, 928], shoulder_l: [184, 1061], shoulder_r: [1078, 1061], hair_top: [627, 37], hair_l: [61, 600],
    hair_r: [1165, 600], hair_bottom: [627, 1040] };
  const pts = {}; let cur = 0, img = null, imgName = '絵.png', skipped = new Set();
  const cv = $('#cv'), ctx = cv.getContext('2d'), stage = $('#stage');
  let view = { s: 1, x: 0, y: 0 };                                          // 絵の画素 → 画面: x*s + view.x

  // ── 一覧 ──
  const list = $('#list');
  function renderList() {
    list.innerHTML = '';
    let lastG = '';
    STEPS.forEach(([g, key, label, , opt], i) => {
      if (g !== lastG) { const h = document.createElement('li'); h.className = 'grp'; h.textContent = g; list.appendChild(h); lastG = g; }
      const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button';
      b.className = (pts[key] ? 'done' : '') + (i === cur ? ' cur' : '');
      const xy = pts[key] ? `${Math.round(pts[key][0])}, ${Math.round(pts[key][1])}` : (skipped.has(key) ? '飛ばした' : '');
      b.innerHTML = `<span class="dot"></span><span>${label}${opt ? ' <span class="opt">任意</span>' : ''}</span><span class="xy">${xy}</span>`;
      b.addEventListener('click', () => { cur = i; update(); });
      li.appendChild(b); list.appendChild(li);
    });
    const need = STEPS.filter((s) => !s[4]).map((s) => s[1]);
    $('#prog').style.width = `${Math.round(100 * Object.keys(pts).length / STEPS.length)}%`;
    $('#save').disabled = !need.every((k) => pts[k]);
  }
  function update() {
    renderList(); draw();
    const st = STEPS[cur];
    $('#tip').innerHTML = !img ? '絵を開いてください。' : st ? `<b>${cur + 1}/${STEPS.length}</b>　${st[2]}をクリック${st[3] ? `（${st[3]}）` : ''}` : 'すべて置きました。右の「points.json を保存」へ。点はドラッグで直せます。';
    $('#cmd').textContent = `python tools/prepare.py ${imgName} points.json gen_b${$('#full').checked ? ' --full' : ''}\npython tools/make_all.py gen_b`;
  }
  const nextStep = () => { cur = STEPS.findIndex((s, i) => i > cur && !pts[s[1]] && !skipped.has(s[1])); if (cur < 0) cur = STEPS.length; };

  // ── 絵 ──
  function setImage(src, name) {
    const im = new Image();
    im.onload = () => { img = im; imgName = name || imgName; $('#drop').hidden = true; fit(); update(); };
    im.src = src;
  }
  $('#img').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) setImage(URL.createObjectURL(f), f.name); });
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) setImage(URL.createObjectURL(f), f.name); });
  $('#sample').addEventListener('click', () => { Object.assign(pts, Object.fromEntries(Object.entries(SAMPLE).map(([k, v]) => [k, v.slice()]))); cur = STEPS.length; $('#full').checked = false; setImage('assets/original.png', 'narumi.png'); });
  $('#load').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); for (const s of STEPS) if (Array.isArray(j[s[1]])) pts[s[1]] = j[s[1]].slice(); $('#full').checked = !!j.full; cur = STEPS.length; nextStep(); update(); }
    catch (err) { $('#save-note').textContent = 'points.json を読めませんでした。中身が JSON か確かめてください。'; }
    e.target.value = '';
  });
  $('#full').addEventListener('change', update);

  // ── 表示（拡大・移動） ──
  function resize() { const r = stage.getBoundingClientRect(); cv.width = r.width * devicePixelRatio; cv.height = r.height * devicePixelRatio; cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; draw(); }
  function fit() { if (!img) return; const r = stage.getBoundingClientRect(); const s = Math.min(r.width / img.width, r.height / img.height) * 0.94; view = { s, x: (r.width - img.width * s) / 2, y: (r.height - img.height * s) / 2 }; draw(); }
  const zoomAt = (k, cx, cy) => { const s2 = Math.min(40, Math.max(0.05, view.s * k)); view.x = cx - (cx - view.x) * s2 / view.s; view.y = cy - (cy - view.y) * s2 / view.s; view.s = s2; draw(); };
  stage.addEventListener('wheel', (e) => { e.preventDefault(); const r = stage.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  $('#zin').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(1.4, r.width / 2, r.height / 2); });
  $('#zout').addEventListener('click', () => { const r = stage.getBoundingClientRect(); zoomAt(1 / 1.4, r.width / 2, r.height / 2); });
  $('#zfit').addEventListener('click', fit);
  window.addEventListener('resize', resize);

  // ── クリック＝点を置く、点の上でドラッグ＝点を動かす、ほかの所でドラッグ＝絵を動かす ──
  let down = null;
  const toImg = (e) => { const r = stage.getBoundingClientRect(); return [(e.clientX - r.left - view.x) / view.s, (e.clientY - r.top - view.y) / view.s]; };
  const hit = (e) => { const [x, y] = toImg(e); let best = null, bd = 12 / view.s; for (const [k, p] of Object.entries(pts)) { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = k; } } return best; };
  stage.addEventListener('pointerdown', (e) => { if (!img) return; stage.setPointerCapture(e.pointerId); down = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, key: hit(e), moved: false }; });
  stage.addEventListener('pointermove', (e) => {
    if (!down) { stage.style.cursor = img && hit(e) ? 'grab' : 'crosshair'; return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (Math.hypot(dx, dy) > 4) down.moved = true;
    if (!down.moved) return;
    if (down.key) { pts[down.key] = toImg(e); update(); } else { view.x = down.vx + dx; view.y = down.vy + dy; draw(); }
  });
  stage.addEventListener('pointerup', (e) => {
    if (down && !down.moved && img && cur < STEPS.length) {
      const k = STEPS[cur][1]; pts[k] = toImg(e); skipped.delete(k); history.push(k); nextStep(); update();
    }
    down = null;
  });
  const history = [];
  $('#undo').addEventListener('click', () => { const k = history.pop(); if (!k) return; delete pts[k]; cur = STEPS.findIndex((s) => s[1] === k); update(); });
  $('#skip').addEventListener('click', () => { if (cur >= STEPS.length) return; if (!STEPS[cur][4]) { $('#tip').textContent = 'この点は飛ばせません（目・口・鼻・あご・耳・おでこは必要です）。'; return; } skipped.add(STEPS[cur][1]); nextStep(); update(); });
  $('#clear').addEventListener('click', () => { for (const k of Object.keys(pts)) delete pts[k]; skipped.clear(); history.length = 0; cur = 0; update(); });
  $('#guides').addEventListener('change', draw);
  document.addEventListener('keydown', (e) => { if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#undo').click(); } });

  // ── 描く：絵・点・目安（prepare.py と同じ式） ──
  const LBL = { eyeL_outer: '目じり', eyeL_inner: '目がしら', eyeR_inner: '目がしら', eyeR_outer: '目じり', nose: '鼻', mouth_l: '口', mouth_r: '口', chin: 'あご', earL: '耳', earR: '耳', forehead: '生え際' };
  function draw() {
    const W = cv.width, H = cv.height, d = devicePixelRatio;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!img) return;
    ctx.setTransform(d * view.s, 0, 0, d * view.s, d * view.x, d * view.y);
    ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0);
    const px = 1 / view.s;
    if ($('#guides').checked) guides(px);
    for (const [k, p] of Object.entries(pts)) {
      const isCur = STEPS[cur] && STEPS[cur][1] === k;
      ctx.beginPath(); ctx.arc(p[0], p[1], 6 * px, 0, 7); ctx.fillStyle = isCur ? '#e2475f' : '#5fc59a'; ctx.fill();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = '#13121a'; ctx.stroke();
      if (view.s > 0.6 || LBL[k]) { ctx.font = `${12 * px}px sans-serif`; ctx.fillStyle = '#13121a'; ctx.fillText(LBL[k] || '', p[0] + 8 * px, p[1] - 8 * px); }
    }
  }
  function guides(px) {
    const P = (k) => pts[k];
    ctx.lineWidth = 1.5 * px;
    if (P('earL') && P('earR') && P('forehead') && P('chin')) {             // 顔の楕円
      const cx = (P('earL')[0] + P('earR')[0]) / 2, rx = (P('earR')[0] - P('earL')[0]) / 2 * 1.03;
      const cy = (P('forehead')[1] + P('chin')[1]) / 2 + 0.03 * (P('chin')[1] - P('forehead')[1]), ry = (P('chin')[1] - P('forehead')[1]) / 2 * 1.05;
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, 7); ctx.stroke();
      if (P('hair_top') && P('hair_bottom') && P('hair_l') && P('hair_r')) {  // 髪の楕円
        const hrx = Math.max(cx - P('hair_l')[0], P('hair_r')[0] - cx) * 1.02, hcy = (P('hair_top')[1] + P('hair_bottom')[1]) / 2 + 0.02 * (P('hair_bottom')[1] - P('hair_top')[1]);
        const hry = (P('hair_bottom')[1] - P('hair_top')[1]) / 2 * 1.18;
        ctx.strokeStyle = 'rgba(200,90,220,.9)'; ctx.beginPath(); ctx.ellipse(cx, hcy, Math.abs(hrx), Math.abs(hry), 0, 0, 7); ctx.stroke();
      }
    }
    for (const [o, i, b0, b1] of [['eyeL_outer', 'eyeL_inner', 'browL_out', 'browL_in'], ['eyeR_outer', 'eyeR_inner', 'browR_in', 'browR_out']]) {   // 目の範囲
      if (!P(o) || !P(i)) continue;
      const ew = Math.abs(P(o)[0] - P(i)[0]);
      const x0 = Math.min(P(o)[0], P(i)[0]) - 0.2 * ew, x1 = Math.max(P(o)[0], P(i)[0]) + 0.2 * ew;
      let y0 = Math.min(P(o)[1], P(i)[1]) - 0.40 * ew; const y1 = Math.max(P(o)[1], P(i)[1]) + 0.52 * ew;
      if (P(b0) && P(b1)) y0 = Math.max(y0, Math.max(P(b0)[1], P(b1)[1]) + 0.2 * ew);   // 眉は入れない（prepare.py と同じ）
      ctx.strokeStyle = 'rgba(40,190,90,.95)'; ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (P('mouth_l') && P('mouth_r')) {
      const mw = Math.abs(P('mouth_r')[0] - P('mouth_l')[0]), my = (P('mouth_l')[1] + P('mouth_r')[1]) / 2;
      ctx.strokeStyle = 'rgba(230,40,60,.95)'; ctx.strokeRect(Math.min(P('mouth_l')[0], P('mouth_r')[0]) - 0.19 * mw, my - 0.18 * mw, mw * 1.4, 0.45 * mw);
    }
  }

  // ── 保存 ──
  function json() {
    const o = { _comment: '喋る絵の点（player/setup.html）。座標は元の絵の画素。python tools/prepare.py <絵> points.json <作業フォルダ>' };
    if ($('#full').checked) o.full = true;
    for (const s of STEPS) if (pts[s[1]]) o[s[1]] = pts[s[1]].map((v) => Math.round(v));
    return JSON.stringify(o, null, 1);
  }
  let downloads = null;
  if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => { downloads = d; }).catch(() => {});
  $('#save').addEventListener('click', async () => {
    const blob = new Blob([json()], { type: 'application/json' });
    if (downloads) {
      try { await downloads.save({ filename: 'points.json', data: blob }); $('#save-note').textContent = 'points.json を保存しました。'; }
      catch (e) { $('#save-note').textContent = e && e.code === 'declined' ? '保存をやめました。' : '保存できませんでした。「中身をコピー」を使ってください。'; }
      return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'points.json'; document.body.appendChild(a); a.click(); a.remove();
    $('#save-note').textContent = 'points.json を保存しました。絵と同じフォルダに置いて、下のコマンドを動かします。';
  });
  $('#copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(json()); $('#save-note').textContent = 'コピーしました。points.json という名前で保存してください。'; }
    catch (e) { $('#cmd').textContent = json(); $('#save-note').textContent = 'コピーできなかったので、下に中身を出しました。選んでコピーしてください。'; }
  });

  resize(); update();
})();
