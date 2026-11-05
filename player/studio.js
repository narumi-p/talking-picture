// なるみスタジオ：player.js（window.TP）を手で動かす。Live2D のパラメーター盤のように、
// 角度 X/Y/Z・目の開き・目玉・眉・口・表情を動かし、マウスを見る・声で口パク・画像と録画の保存ができる。
(() => {
  const $ = (s) => document.querySelector(s);
  const TP = window.TP;
  const P = TP.params;
  // つまみの値（目標）。毎コマ、いまの値をなめらかに近づける
  const target = { yaw: 0, pitch: 0, roll: 0, eyeOpen: 1, gazeX: 0, gazeY: 0, brow: 0, mouthOpen: 0, exprK: 0, hair: 1 };
  const DEG = 20;                       // 表示の角度（度）→ 内部の値（±1.5）
  const sliders = {
    yaw: ['#p-yaw', (v) => v / DEG, (x) => x * DEG, (v) => `${(+v).toFixed(0)}°`],
    pitch: ['#p-pitch', (v) => -v / DEG, (x) => -x * DEG, (v) => `${(+v).toFixed(0)}°`],
    roll: ['#p-roll', (v) => -v / DEG, (x) => -x * DEG, (v) => `${(+v).toFixed(0)}°`],
    eyeOpen: ['#p-eye', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    gazeX: ['#p-gx', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    gazeY: ['#p-gy', (v) => -v, (x) => -x, (v) => (+v).toFixed(2)],
    brow: ['#p-brow', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    mouthOpen: ['#p-mouth', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    hair: ['#p-hair', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
  };
  const showSlider = (k) => { const [sel, , fromX, fmt] = sliders[k]; const el = $(sel); el.value = fromX(target[k]); el.nextElementSibling.textContent = fmt(el.value); };
  for (const [k, [sel, toX, , fmt]] of Object.entries(sliders)) {
    const el = $(sel);
    el.addEventListener('input', () => { target[k] = toX(el.value); el.nextElementSibling.textContent = fmt(el.value); if (k === 'eyeOpen' || k === 'brow' || k === 'mouthOpen') setPreset(null); });
    el.addEventListener('dblclick', () => { target[k] = k === 'eyeOpen' || k === 'hair' ? 1 : 0; showSlider(k); });
  }
  const setAll = () => Object.keys(sliders).forEach(showSlider);

  // ── 表情 ──
  const presets = {
    normal: { expr: '', exprK: 0, eyeOpen: 1, brow: 0, mouthOpen: 0 },
    smile: { expr: 'smile', exprK: 1, eyeOpen: 1, brow: 0.3, mouthOpen: 0.25, shape: 0, pitch: -0.15, roll: 0.35 },
    jito: { expr: 'jito', exprK: 1, eyeOpen: 1, brow: -0.6, mouthOpen: 0, yaw: 0.35, gazeX: 0.9 },
    surprise: { expr: '', exprK: 0, eyeOpen: 1, brow: 1, mouthOpen: 0.5, shape: 4, pitch: -0.3 },
    sleep: { expr: '', exprK: 0, eyeOpen: 0, brow: -0.15, mouthOpen: 0 },
  };
  let exprName = '';
  function setPreset(name) {
    document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    if (!name) return;
    const p = presets[name];
    if (p.expr && exprName && p.expr !== exprName) P.exprK = 0;                     // 別の表情へは、いったん開いた目から
    if (p.expr) exprName = p.expr;
    target.exprK = p.exprK;
    for (const k of ['eyeOpen', 'brow', 'mouthOpen', 'yaw', 'pitch', 'roll', 'gazeX']) if (p[k] !== undefined) target[k] = p[k];
    if (name === 'normal') { target.yaw = 0; target.pitch = 0; target.roll = 0; target.gazeX = 0; target.gazeY = 0; }
    if (p.shape !== undefined) setVowel(p.shape);
    setAll();
  }
  document.querySelectorAll('#presets button').forEach((b) => b.addEventListener('click', () => setPreset(b.dataset.preset)));

  // ── 口の形 ──
  let vowel = 0;
  function setVowel(i) { vowel = i; document.querySelectorAll('#vowels button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === i))); }
  document.querySelectorAll('#vowels button').forEach((b) => b.addEventListener('click', () => { setVowel(+b.dataset.v); if (target.mouthOpen < 0.2) { target.mouthOpen = 0.6; showSlider('mouthOpen'); } }));

  // ── 自動の動き ──
  let follow = false;
  document.querySelectorAll('[data-auto]').forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.auto; const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    if (k === 'follow') follow = on; else TP.auto[k] = on;
    updateBadge();
  }));
  $('#reset').addEventListener('click', () => {
    Object.assign(target, { yaw: 0, pitch: 0, roll: 0, eyeOpen: 1, gazeX: 0, gazeY: 0, brow: 0, mouthOpen: 0, exprK: 0, hair: 1 });
    setVowel(0); setPreset('normal'); setAll();
  });

  // ── マウス・ドラッグ ──
  const frame = $('#frame');
  let drag = null, mouse = null;
  const rel = (e) => { const r = frame.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, r]; };
  frame.addEventListener('pointerdown', (e) => { frame.setPointerCapture(e.pointerId); frame.classList.add('drag'); drag = { x: e.clientX, y: e.clientY, yaw: target.yaw, pitch: target.pitch, gx: target.gazeX, gy: target.gazeY }; });
  frame.addEventListener('pointermove', (e) => {
    if (drag) {
      const r = frame.getBoundingClientRect(); const dx = (e.clientX - drag.x) / r.width, dy = (e.clientY - drag.y) / r.height;
      target.yaw = clamp(drag.yaw + dx * 4, -1.5, 1.5); target.pitch = clamp(drag.pitch + dy * 4, -1.5, 1.5);
      target.gazeX = clamp(drag.gx + dx * 3, -1, 1); target.gazeY = clamp(drag.gy + dy * 3, -1, 1);
      showSlider('yaw'); showSlider('pitch'); showSlider('gazeX'); showSlider('gazeY');
    }
  });
  const endDrag = () => { drag = null; frame.classList.remove('drag'); };
  frame.addEventListener('pointerup', endDrag); frame.addEventListener('pointercancel', endDrag);
  window.addEventListener('pointermove', (e) => { mouse = rel(e); });
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ── 声：AudioContext → 解析（声の大きさ＝口の開き、ひびき F1/F2＝あいうえお） ──
  let ac = null, analyser = null, recDest = null, srcNode = null, micStream = null, audioEl = null;
  const VOW = [[850, 1450], [350, 2700], [420, 1550], [600, 2250], [560, 1000]];   // あいうえお（女性の声のおよそのフォルマント）
  function ensureAudio() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.2;
    recDest = ac.createMediaStreamDestination();
  }
  function stopVoice() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    if (srcNode) { try { srcNode.disconnect(); } catch (e) {} srcNode = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    TP.live = null; $('#stop').disabled = true; $('#mic').setAttribute('aria-pressed', 'false'); updateBadge();
  }
  async function playUrl(url, label) {
    ensureAudio(); stopVoice(); await ac.resume();
    audioEl = new Audio(url); audioEl.crossOrigin = 'anonymous';
    srcNode = ac.createMediaElementSource(audioEl);
    srcNode.connect(analyser); srcNode.connect(ac.destination); srcNode.connect(recDest);
    audioEl.onended = () => stopVoice();
    await audioEl.play();
    TP.live = { open: 0, shape: [1, 0, 0, 0, 0], avg: 0 }; $('#stop').disabled = false;
    voiceLabel = label; updateBadge();
  }
  let voiceLabel = '';
  $('#sample').addEventListener('click', () => playUrl('assets/voice.wav', 'サンプルの声').catch((e) => note('#voice-note', 'サンプルの声を再生できませんでした。もう一度押してください。')));
  $('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) playUrl(URL.createObjectURL(f), f.name).catch(() => note('#voice-note', 'この音声ファイルは再生できませんでした。wav か mp3 を選んでください。')); e.target.value = ''; });
  $('#stop').addEventListener('click', stopVoice);
  $('#mic').addEventListener('click', async () => {
    if (micStream) { stopVoice(); return; }
    try {
      ensureAudio(); stopVoice(); await ac.resume();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      srcNode = ac.createMediaStreamSource(micStream); srcNode.connect(analyser); srcNode.connect(recDest);
      TP.live = { open: 0, shape: [1, 0, 0, 0, 0], avg: 0 }; $('#stop').disabled = false; $('#mic').setAttribute('aria-pressed', 'true');
      voiceLabel = 'マイク'; updateBadge();
    } catch (e) {
      $('#mic').disabled = true;
      note('#voice-note', 'このページではマイクを使えません。音声ファイルを選ぶか、手元で python tools/serve.py を動かして studio.html を開くとマイクで口パクできます。');
    }
  });
  const note = (sel, t) => { $(sel).textContent = t; };
  let td = null, fd = null, peak = -30, liveOpen = 0, liveShape = [1, 0, 0, 0, 0], avg = 0;
  function analyse(dt) {
    if (!TP.live || !analyser) return;
    if (!td) { td = new Float32Array(analyser.fftSize); fd = new Float32Array(analyser.frequencyBinCount); }
    analyser.getFloatTimeDomainData(td); analyser.getFloatFrequencyData(fd);
    let s = 0; for (let i = 0; i < td.length; i++) s += td[i] * td[i];
    const db = 10 * Math.log10(s / td.length + 1e-10);
    peak = Math.max(db, peak - dt * 3);                                            // いちばん大きい声をゆっくり忘れる
    let op = Math.pow(clamp((db - (peak - 24)) / 22, 0, 1), 1.5);
    op = op < 0.06 ? 0 : Math.min(op, 0.92);
    liveOpen += (op - liveOpen) * (op > liveOpen ? 0.7 : 0.4);
    // ひびき：250〜1000Hz と 1000〜3000Hz のいちばん強い所
    const hz = ac.sampleRate / analyser.fftSize;
    const peakIn = (lo, hi) => { let bi = Math.round(lo / hz), bv = -1e9; for (let i = Math.round(lo / hz); i < Math.round(hi / hz); i++) if (fd[i] > bv) { bv = fd[i]; bi = i; } return bi * hz; };
    if (op > 0.08) {
      const f1 = peakIn(250, 1000), f2 = peakIn(1000, 3000);
      const w = VOW.map(([a, b]) => Math.exp(-(((f1 - a) / 250) ** 2 + ((f2 - b) / 600) ** 2) / 0.6));
      const sum = w.reduce((x, y) => x + y, 0) || 1;
      liveShape = liveShape.map((v, i) => v + (w[i] / sum - v) * 0.35);
    }
    avg += (liveOpen - avg) * Math.min(1, dt * 1.5);
    TP.live.open = liveOpen; TP.live.shape = liveShape; TP.live.avg = avg;
    $('#meter').style.width = `${Math.round(liveOpen * 100)}%`;
  }

  // ── 保存 ──
  let downloads = null;
  if (window.claude && window.claude.use) window.claude.use('downloads').then((d) => { downloads = d; }).catch(() => {});
  async function saveBlob(blob, name) {
    if (downloads) {
      try { await downloads.save({ filename: name, data: blob }); note('#save-note', `${name} を保存しました。`); }
      catch (e) { note('#save-note', e && e.code === 'declined' ? '保存をやめました。' : '保存できませんでした。'); }
      return;
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note('#save-note', `${name} を保存しました。`);
  }
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
  $('#shot').addEventListener('click', () => $('#gl').toBlob((b) => b && saveBlob(b, `narumi_${stamp()}.png`), 'image/png'));
  let rec = null, chunks = [];
  $('#rec').addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    try {
      ensureAudio();
      const stream = $('#gl').captureStream(30);
      recDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8e6 } : undefined); chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => { const b = new Blob(chunks, { type: 'video/webm' }); rec = null; $('#rec').setAttribute('aria-pressed', 'false'); $('#rec').textContent = '録画'; updateBadge(); saveBlob(b, `narumi_${stamp()}.webm`); };
      rec.start(250); $('#rec').setAttribute('aria-pressed', 'true'); $('#rec').textContent = '録画を止める'; updateBadge();
      note('#save-note', '録画しています。もう一度押すと止めて保存します。');
    } catch (e) { note('#save-note', 'この画面では録画できません。画像の保存は使えます。'); }
  });

  function updateBadge() {
    const chips = [];
    if (rec) chips.push('<span class="chip rec">● 録画中</span>');
    if (TP.live) chips.push(`<span class="chip">声：${voiceLabel.replace(/[<>&]/g, '')}</span>`);
    chips.push(`<span class="chip">${follow ? 'マウスを見ています' : 'ドラッグで顔の向き'}</span>`);
    $('#badge').innerHTML = chips.join('');
  }

  // ── 毎コマ ──
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (follow && mouse && !drag) {                                              // 絵の中のカーソルの方を向く（顔は少し、目はよく）
      const [mx, my] = mouse;
      target.yaw = clamp(mx * 1.1, -1.5, 1.5); target.pitch = clamp(my * 0.9, -1.5, 1.5);
      target.gazeX = clamp(mx * 1.2, -1, 1); target.gazeY = clamp(my * 1.0, -1, 1);
      showSlider('yaw'); showSlider('pitch'); showSlider('gazeX'); showSlider('gazeY');
    }
    const k = 1 - Math.exp(-dt * 10), kf = 1 - Math.exp(-dt * 18);
    for (const key of ['yaw', 'pitch', 'roll', 'brow', 'hair']) P[key] += (target[key] - P[key]) * k;
    for (const key of ['gazeX', 'gazeY', 'mouthOpen', 'eyeOpen']) P[key] += (target[key] - P[key]) * kf;
    P.exprK += (target.exprK - P.exprK) * (1 - Math.exp(-dt * 12));
    P.expr = exprName; if (P.exprK < 0.02 && target.exprK === 0) exprName = '';
    P.shape = [0, 1, 2, 3, 4].map((i) => (i === vowel ? 1 : 0));
    analyse(dt);
    TP.render(now / 1000);
    requestAnimationFrame(loop);
  }
  const start = () => { TP.manual = true; $('#loading').hidden = true; setAll(); updateBadge(); requestAnimationFrame(loop); };
  if (window.ready) start(); else window.addEventListener('tp-ready', start, { once: true });
})();
