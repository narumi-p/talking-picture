// なるみスタジオ：player.js（window.TP）を手で動かす。Live2D のパラメーター盤のように、
// 角度 X/Y/Z・目の開き・目玉・眉・口・表情を動かし、マウスを見る・声で口パク・画像と録画の保存ができる。
(() => {
  const $ = (s) => document.querySelector(s);
  const TP = window.TP;
  const P = TP.params;
  // つまみの値（目標）。毎コマ、いまの値をなめらかに近づける
  const ZERO = { yaw: 0, pitch: 0, roll: 0, body: 0, eyeOpen: 1, eyeOpenL: 1, eyeOpenR: 1, gazeX: 0, gazeY: 0, brow: 0, mouthOpen: 0, exprK: 0, hair: 1, blush: 0, sweat: 0, anger: 0 };
  const target = { ...ZERO };
  const DEG = 20;                       // 表示の角度（度）→ 内部の値（±1.5）
  const sliders = {
    yaw: ['#p-yaw', (v) => v / DEG, (x) => x * DEG, (v) => `${(+v).toFixed(0)}°`],
    pitch: ['#p-pitch', (v) => -v / DEG, (x) => -x * DEG, (v) => `${(+v).toFixed(0)}°`],
    roll: ['#p-roll', (v) => -v / DEG, (x) => -x * DEG, (v) => `${(+v).toFixed(0)}°`],
    body: ['#p-body', (v) => -v / 2, (x) => -x * 2, (v) => `${(+v).toFixed(1)}°`],
    eyeOpen: ['#p-eye', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    eyeOpenL: ['#p-eyeL', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    eyeOpenR: ['#p-eyeR', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    blush: ['#p-blush', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    sweat: ['#p-sweat', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
    anger: ['#p-anger', (v) => +v, (x) => x, (v) => (+v).toFixed(2)],
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
    el.addEventListener('dblclick', () => { target[k] = ZERO[k]; showSlider(k); });
  }
  const setAll = () => Object.keys(sliders).forEach(showSlider);

  // ── 表情 ──
  // 表情：書いていない値は通常（ZERO）に戻す。顔の向きは書いたものだけ変える
  const FACE = ['expr', 'exprK', 'eyeOpen', 'eyeOpenL', 'eyeOpenR', 'brow', 'mouthOpen', 'blush', 'sweat', 'anger'];
  const presets = {
    normal: { expr: '', yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0 },
    smile: { expr: 'smile', exprK: 1, brow: 0.3, mouthOpen: 0.25, shape: 0, pitch: -0.15, roll: 0.3 },
    jito: { expr: 'jito', exprK: 1, brow: -0.6, yaw: 0.35, gazeX: 0.9 },
    surprise: { brow: 1, mouthOpen: 0.5, shape: 4, pitch: -0.3 },
    sleep: { eyeOpen: 0, brow: -0.15 },
    wink: { eyeOpenL: 0, brow: 0.2, mouthOpen: 0.2, shape: 0, roll: 0.5, gazeX: 0.3 },
    shy: { expr: 'smile', exprK: 1, blush: 1, brow: 0.15, pitch: 0.35, roll: -0.4, yaw: -0.3 },
    angry: { anger: 1, brow: -0.9, mouthOpen: 0.3, shape: 3, pitch: 0.2 },
    trouble: { sweat: 1, brow: 0.6, eyeOpen: 0.8, mouthOpen: 0.15, shape: 2, roll: 0.4, gazeX: -0.6 },
  };
  // 自分で登録した表情（この端末のブラウザに残す）
  const MY = 'tp-studio-presets';
  const readMy = () => { try { return JSON.parse(localStorage.getItem(MY) || '[]'); } catch (e) { return []; } };
  const writeMy = (a) => { try { localStorage.setItem(MY, JSON.stringify(a)); } catch (e) {} };
  function renderMy() {
    const box = $('#mypresets'); box.innerHTML = '';
    readMy().forEach((m, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = m.name; b.title = '押すと呼び出し。右クリックで消す';
      b.addEventListener('click', () => { presets['my' + i] = m.v; setPreset('my' + i); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); const a = readMy(); a.splice(i, 1); writeMy(a); renderMy(); });
      box.appendChild(b);
    });
  }
  $('#savepreset').addEventListener('click', () => {
    const a = readMy(); const v = { expr: exprName, shape: vowel };
    for (const k of Object.keys(ZERO)) v[k] = Math.round(target[k] * 100) / 100;
    a.push({ name: `顔 ${a.length + 1}`, v }); writeMy(a); renderMy();
  });
  let exprName = '';
  function setPreset(name) {
    document.querySelectorAll('#presets button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
    if (!name) return;
    const p = presets[name];
    if (p.expr && exprName && p.expr !== exprName) P.exprK = 0;                     // 別の表情へは、いったん開いた目から
    if (p.expr) exprName = p.expr;
    for (const k of FACE) if (k !== 'expr') target[k] = p[k] !== undefined ? p[k] : ZERO[k];
    if (!p.expr) target.exprK = 0;
    for (const k of ['yaw', 'pitch', 'roll', 'gazeX', 'gazeY', 'body', 'hair']) if (p[k] !== undefined) target[k] = p[k];
    setVowel(p.shape !== undefined ? p.shape : 0);
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
    Object.assign(target, ZERO);
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
    TP.live = null; demo = false; TP.manual = true; $('#demo').setAttribute('aria-pressed', 'false');
    $('#stop').disabled = true; $('#mic').setAttribute('aria-pressed', 'false'); updateBadge();
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
    setTimeout(updateBadge, 0);
  }
  let voiceLabel = '';
  // デモ：サンプルの声を、前もって作った口の動き（lips.json）と表情の台本（timeline.json）で再生する
  let demo = false;
  $('#demo').addEventListener('click', async () => {
    try { await playUrl('assets/voice.wav', 'デモ'); TP.live = null; demo = true; $('#demo').setAttribute('aria-pressed', 'true'); updateBadge(); }
    catch (e) { note('#voice-note', 'デモを再生できませんでした。もう一度押してください。'); }
  });
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
    if (TP.live || demo) chips.push(`<span class="chip">声：${voiceLabel.replace(/[<>&]/g, '')}</span>`);
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
    for (const key of ['yaw', 'pitch', 'roll', 'body', 'brow', 'hair']) P[key] += (target[key] - P[key]) * k;
    for (const key of ['gazeX', 'gazeY', 'mouthOpen', 'eyeOpen', 'eyeOpenL', 'eyeOpenR']) P[key] += (target[key] - P[key]) * kf;
    for (const key of ['blush', 'sweat', 'anger']) P[key] += (target[key] - P[key]) * k;
    if (blinkNow) { const x = (now - blinkNow) / 1000; P.eyeOpen = Math.min(P.eyeOpen, x < 0.1 ? 1 - x / 0.1 : x < 0.14 ? 0 : Math.min(1, (x - 0.14) / 0.16)); if (x > 0.3) blinkNow = 0; }
    if (speaking) { const sv = speechMouth(now); P.mouthOpen = Math.max(P.mouthOpen, sv.open); if (sv.open > 0.05) P.shape = sv.shape; }
    P.exprK += (target.exprK - P.exprK) * (1 - Math.exp(-dt * 12));
    P.expr = exprName; if (P.exprK < 0.02 && target.exprK === 0) exprName = '';
    if (!(speaking && P.mouthOpen > 0.05 && speechMouth(now).open > 0.05)) P.shape = [0, 1, 2, 3, 4].map((i) => (i === vowel ? 1 : 0));
    analyse(dt);
    if (demo && audioEl) { TP.manual = false; TP.render(audioEl.currentTime); }   // デモ：台本どおり
    else { TP.manual = true; TP.render(now / 1000); }
    requestAnimationFrame(loop);
  }
  // ── 背景 ──
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  function setBg(kind, color) {
    document.querySelectorAll('#bgs [data-bg]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.bg === kind)));
    TP.bg = kind === 'orig' ? { mode: 0 } : kind === 'clear' ? { mode: 2 } : { mode: 1, color: kind === 'green' ? [0, 0.69, 0.25] : kind === 'blue' ? [0, 0.28, 0.73] : color };
    $('.stage').classList.toggle('checker', kind === 'clear'); document.body.classList.toggle('clear', kind === 'clear');
  }
  document.querySelectorAll('#bgs [data-bg]').forEach((b) => b.addEventListener('click', () => setBg(b.dataset.bg)));
  $('#bgcolor').addEventListener('input', (e) => setBg('color', hex(e.target.value)));

  // ── 配信モード・全画面 ──
  const setObs = (on) => { document.body.classList.toggle('obs', on); if (on && !location.hash.includes('obs')) history.replaceState(null, '', location.pathname + location.search + (window.TP_FULL ? '#full-obs' : '#obs')); if (!on) history.replaceState(null, '', location.pathname + location.search + (window.TP_FULL ? '#full' : '')); };
  $('#obs').addEventListener('click', () => setObs(true));
  $('#fs').addEventListener('click', () => { const el = document.documentElement; (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).catch(() => { $('#save-note').textContent = 'この画面では全画面にできません。配信モードを使ってください。'; }); });
  if (location.hash.includes('obs')) setObs(true);

  // ── 文字を話す：ブラウザの読み上げ（声があれば）＋文字から作った口の動き ──
  const KANA = { a: 'あかさたなはまやらわがざだばぱぁゃアカサタナハマヤラワガザダバパァャ', i: 'いきしちにひみりぎじぢびぴぃイキシチニヒミリギジヂビピィ', u: 'うくすつぬふむゆるぐずづぶぷぅゅっウクスツヌフムユルグズヅブプゥュッ', e: 'えけせてねへめれげぜでべぺぇエケセテネヘメレゲゼデベペェ', o: 'おこそとのほもよろをごぞどぼぽぉょオコソトノホモヨロヲゴゾドボポォョ' };
  const vowelOf = (ch) => { for (const [k, v] of Object.entries(KANA)) if (v.includes(ch)) return 'aiueo'.indexOf(k); if ('ーん'.includes(ch)) return -2; if (/[、。！？!?,. \n]/.test(ch)) return -1; return Math.floor(Math.random() * 5); };
  let speaking = null;
  function speechMouth(now) {
    const sp = speaking; if (!sp) return { open: 0, shape: [1, 0, 0, 0, 0] };
    const t = (now - sp.t0) / 1000 * sp.rate; const i = Math.floor(t / 0.13); const fr = t / 0.13 - i;
    if (i >= sp.seq.length) { if (!sp.voice || sp.ended) speaking = null; return { open: 0, shape: [1, 0, 0, 0, 0] }; }
    const v = sp.seq[i]; if (v === -1) return { open: 0, shape: [1, 0, 0, 0, 0] };
    const vv = v === -2 ? (sp.seq[i - 1] >= 0 ? sp.seq[i - 1] : 2) : v; const amp = v === -2 ? 0.25 : 0.55 + 0.25 * Math.sin(i * 1.7);
    return { open: amp * Math.sin(Math.PI * Math.min(1, fr * 1.15)), shape: [0, 1, 2, 3, 4].map((k) => (k === vv ? 1 : 0)) };
  }
  $('#say').addEventListener('click', () => {
    const text = $('#say-text').value.trim(); if (!text) return;
    stopVoice();
    const seq = [...text].map(vowelOf);
    speaking = { seq, t0: performance.now(), rate: 1, voice: false, ended: false };
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'ja-JP'; u.rate = 1; u.pitch = 1.3;
      const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.startsWith('ja'));
      if (vs.length) { u.voice = vs.find((v) => /female|Kyoko|Nanami|Haruka|女性/i.test(v.name)) || vs[0]; speaking.voice = true; }
      u.onstart = () => { if (speaking) speaking.t0 = performance.now(); };
      u.onend = () => { if (speaking) speaking.ended = true; };
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      $('#say-note').textContent = vs.length ? `声：${u.voice.name}` : '日本語の読み上げ声が無いので、口だけ動かしています。';
    } catch (e) { $('#say-note').textContent = '読み上げを使えないので、口だけ動かしています。'; }
  });

  // ── キー操作 ──
  let blinkNow = 0, held = null;
  const PKEYS = ['normal', 'smile', 'jito', 'surprise', 'sleep', 'wink', 'shy', 'angry', 'trouble'];
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape' && document.body.classList.contains('obs')) { setObs(false); return; }
    if (/^[1-9]$/.test(k)) { setPreset(PKEYS[+k - 1]); return; }
    const step = 0.25;
    if (k === 'ArrowLeft') { target.yaw = clamp(target.yaw - step, -1.5, 1.5); showSlider('yaw'); e.preventDefault(); }
    else if (k === 'ArrowRight') { target.yaw = clamp(target.yaw + step, -1.5, 1.5); showSlider('yaw'); e.preventDefault(); }
    else if (k === 'ArrowUp') { target.pitch = clamp(target.pitch - step, -1.5, 1.5); showSlider('pitch'); e.preventDefault(); }
    else if (k === 'ArrowDown') { target.pitch = clamp(target.pitch + step, -1.5, 1.5); showSlider('pitch'); e.preventDefault(); }
    else if (k === ' ') { blinkNow = performance.now(); e.preventDefault(); }
    else if ('aiueoAIUEO'.includes(k) && k.length === 1) { if (held === k.toLowerCase()) return; held = k.toLowerCase(); setVowel('aiueo'.indexOf(held)); target.mouthOpen = held === 'i' ? 0.5 : 0.7; }
    else if (k === 'b' || k === 'B') { target.blush = target.blush > 0.5 ? 0 : 1; showSlider('blush'); }
    else if (k === 'w' || k === 'W') { target.eyeOpenL = target.eyeOpenL < 0.5 ? 1 : 0; showSlider('eyeOpenL'); }
    else if (k === 'r' || k === 'R') $('#reset').click();
    else if (k === 'p' || k === 'P') setObs(!document.body.classList.contains('obs'));
  });
  document.addEventListener('keyup', (e) => { if (held && e.key.toLowerCase() === held) { held = null; target.mouthOpen = 0; showSlider('mouthOpen'); } });
  renderMy();

  // バストアップ／全身：ページを読み直して層を切り替える（#full）
  document.querySelectorAll('[data-view]').forEach((b) => {
    b.setAttribute('aria-pressed', String((b.dataset.view === 'full') === !!window.TP_FULL));
    b.addEventListener('click', () => { const full = b.dataset.view === 'full'; if (full === !!window.TP_FULL && !new URLSearchParams(location.search).get('a')) return; location.href = location.pathname + (full ? '#full' : ''); location.reload(); });
  });
  const start = () => {
    const cv = $('#gl'); frame.style.setProperty('--ar', String(cv.width / cv.height));
    $('#row-body').hidden = !TP.hasBody();
    TP.manual = true; $('#loading').hidden = true; setAll(); updateBadge(); requestAnimationFrame(loop);
  };
  if (window.ready) start(); else window.addEventListener('tp-ready', start, { once: true });
})();
