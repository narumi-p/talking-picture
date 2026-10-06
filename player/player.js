// 喋る絵（1枚の絵が喋る）：下地＋目のコマ＋コードで描く口＋揺れる髪 9 本＋頭の傾き（最大 0.7°）
// window.render(t) で決定論的に 1 コマ描く（書き出し用）。
// URL: ?assets=assets（層のフォルダ）&lips=assets/lips.json&timeline=assets/timeline.json&audio=assets/voice.wav&seed=7&alpha=1（背景を透明に）
(() => {
  const qs = new URLSearchParams(location.search);
  const W = +(qs.get('w') || 1080), H = +(qs.get('h') || 1080);
  const cv = document.getElementById('gl'); cv.width = W; cv.height = H;
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  const A = (qs.get('assets') || 'assets') + '/';
  const ALPHA = qs.get('alpha') === '1';
  if (ALPHA) cv.style.background = 'transparent';
  // 透明な所の色を失わないように（髪のふちが黒くにじまない）、そのままの値で読み込む
  const loadImg = async (s) => { const r = await fetch(A + s + '?v=' + Date.now()); if (!r.ok) throw s; return createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); };
  const tex = (im, unit) => {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const VS = `#version 300 es
  in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0, 1); }`;
  const FS = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 o;
  uniform sampler2D tOrig, tBase, tHair, tEyes, tMouth, tW0, tW1, tW2, tS0, tS1, tS2, tMask;
  uniform float alphaMode;       // 1 のとき背景を透明に（tMask＝下地の不透明さ）
  uniform float N;               // 絵の大きさ（1024）
  uniform vec4 eyeRect; uniform float eyeCount, eyeA, eyeB, eyeMix;   // 目の範囲・コマ数・混ぜる 2 コマと割合
  uniform vec4 mRect; uniform vec4 mGeo;                // 口の範囲、(cx, cy, k, halfw)
  uniform float mOpen; uniform float mShape[5];         // 口の開き、あいうえお の重み
  uniform vec2 roots[9]; uniform float theta[9];        // 髪の根元と角度（ラジアン）
  uniform vec2 pivot; uniform float neckY, tilt;        // 頭の傾き
  vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  #define smp(t, q) texture(t, (q) / N)
  vec2 hairDisp(vec2 q){
    vec3 w0 = smp(tW0, q).rgb, w1 = smp(tW1, q).rgb, w2 = smp(tW2, q).rgb;
    vec3 s0 = smp(tS0, q).rgb, s1 = smp(tS1, q).rgb, s2 = smp(tS2, q).rgb;
    float w[9] = float[9](w0.r, w0.g, w0.b, w1.r, w1.g, w1.b, w2.r, w2.g, w2.b);
    float s[9] = float[9](s0.r, s0.g, s0.b, s1.r, s1.g, s1.b, s2.r, s2.g, s2.b);
    vec2 d = vec2(0);
    for (int i = 0; i < 9; i++) {
      if (w[i] < 0.002) continue;
      vec2 r = q - roots[i];
      d += w[i] * (rot(r, theta[i] * pow(s[i], 1.5)) - r);
    }
    return d;
  }
  // 口（コードで描く）：笑みの曲がりに沿った開き。中は暗い赤、舌、い・え は上の歯
  vec4 mouthPaint(vec2 q){
    float a = mShape[0], i_ = mShape[1], u = mShape[2], e = mShape[3], ob = mShape[4];
    float wf = a * 0.9 + i_ * 1.1 + u * 0.55 + e * 1.0 + ob * 0.66;
    float hf = a * 1.0 + i_ * 0.38 + u * 0.5 + e * 0.62 + ob * 0.86;
    float rnd = clamp(u + ob, 0.0, 1.0);
    float hw = mGeo.w * mix(0.95, wf, smoothstep(0.0, 0.45, mOpen));
    float h = mGeo.w * 0.82 * hf * mOpen;
    float x = q.x - mGeo.x; float yc = mGeo.y + mGeo.z * x * x * mix(1.0, 0.45, smoothstep(0.0, 0.6, mOpen));
    float un = x / hw; float v = q.y - yc;
    if (abs(un) > 1.25) return vec4(0);
    float bump = max(0.0, 1.0 - un * un);
    float topE = -h * mix(0.26, 0.42, rnd) * pow(bump, mix(0.75, 0.5, rnd));
    float botE =  h * mix(0.74, 0.58, rnd) * pow(bump, mix(0.6, 0.5, rnd));
    float px = 1.0;                                                // 1 画素ぶんのぼかし
    float inside = smoothstep(-px, px, v - topE) * smoothstep(-px, px, botE - v) * smoothstep(1.0 + 0.02, 1.0 - 0.02, abs(un));
    vec3 col = vec3(0.30, 0.08, 0.11);
    // 舌
    float ty = botE - h * 0.30; float tw = hw * 0.55, th = h * 0.42;
    float tng = smoothstep(1.0, 0.9, length(vec2(x / max(tw, 1.0), (q.y - yc - ty) / max(th, 1.0))));
    col = mix(col, vec3(0.80, 0.38, 0.44), tng * 0.9);
    // 上の歯（い・え）
    float teeth = smoothstep(0.42, 0.52, i_ + e) * smoothstep(0.15, 0.3, mOpen);   // 歯は出すか出さないか（半透明の灰色にしない）
    float tb = smoothstep(px, -px, v - (topE + h * 0.22)) * step(abs(un), 0.82);
    col = mix(col, vec3(0.97, 0.95, 0.95), clamp(teeth * tb, 0.0, 1.0));
    // 輪郭線（上は太め）
    float edgeTop = 1.0 - smoothstep(0.0, 1.7, abs(v - topE));
    float edgeBot = (1.0 - smoothstep(0.0, 1.0, abs(v - botE))) * 0.55;
    float lineMask = max(edgeTop, edgeBot) * smoothstep(1.12, 0.98, abs(un));
    // 口角は線を少しのばす
    float corner = (1.0 - smoothstep(0.0, 1.4, abs(v - topE * 0.2))) * smoothstep(1.18, 1.0, abs(un)) * smoothstep(0.9, 1.0, abs(un));
    lineMask = max(lineMask, corner);
    vec3 lineCol = vec3(0.36, 0.16, 0.15);
    float alpha = max(inside, lineMask);
    vec3 c = mix(col, lineCol, lineMask * (1.0 - inside * 0.6));
    return vec4(c, alpha);
  }
  void main(){
    vec2 q = vec2(uv.x, 1.0 - uv.y) * N;
    // 頭の傾き（首から上だけ）
    float hwt = smoothstep(neckY + 70.0, neckY - 70.0, q.y);
    vec2 qh = pivot + rot(q - pivot, -tilt * hwt);
    vec3 under = smp(tBase, qh).rgb;
    // 目
    if (qh.x >= eyeRect.x && qh.x < eyeRect.z && qh.y >= eyeRect.y && qh.y < eyeRect.w) {
      float eh = eyeRect.w - eyeRect.y; float f0 = eyeA, f1 = eyeB, fr = eyeMix;
      vec2 e = vec2((qh.x - eyeRect.x) / (eyeRect.z - eyeRect.x), clamp(qh.y - eyeRect.y, 0.5, eh - 0.5));   // となりのコマを拾わない
      vec3 c0 = texture(tEyes, vec2(e.x, (e.y + f0 * eh) / (eh * eyeCount))).rgb;
      vec3 c1 = texture(tEyes, vec2(e.x, (e.y + f1 * eh) / (eh * eyeCount))).rgb;
      under = mix(c0, c1, fr);
    }
    // 口：開いている間は口なしの肌＋コードの口
    if (mOpen > 0.0 && qh.x >= mRect.x && qh.x < mRect.z && qh.y >= mRect.y && qh.y < mRect.w) {
      vec2 m = (qh - mRect.xy) / (mRect.zw - mRect.xy);
      vec3 sk = texture(tMouth, m).rgb;
      float k = smoothstep(0.0, 0.10, mOpen);
      under = mix(under, sk, k);
      vec4 mp = mouthPaint(qh);
      under = mix(under, mp.rgb, mp.a * k);
    }
    // 髪（前の層）
    vec2 d = hairDisp(qh);
    vec4 hc = smp(tHair, qh - d);
    if (alphaMode > 0.5) {
      float ua = smp(tMask, qh).r;                                   // 下地の不透明さ（人物と奥の髪は 1、背景は 0）
      float al = ua * (1.0 - hc.a) + hc.a;
      vec3 pm = under * ua * (1.0 - hc.a) + hc.rgb * hc.a;           // 重ねた色（premultiplied）
      o = vec4(al > 0.001 ? pm / al : vec3(0.0), al);
    } else {
      o = vec4(mix(under, hc.rgb, hc.a), 1.0);
    }
  }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(s); return s; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw gl.getProgramInfoLog(pr);
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = (n) => gl.getUniformLocation(pr, n);

  // ── 決定論的な乱数 ──
  const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  let cfg, lips = null, blinks = [], events = [];
  function buildBlinks(dur, seed) {
    const r = rng(seed); const out = []; let t = 0.9 + r() * 0.8;
    while (t < dur + 5) {
      out.push(t);
      if (r() < 0.18) out.push(t + 0.32 + r() * 0.1);                     // 2 回続けて
      t += 2.0 + Math.pow(r(), 1.6) * 3.4;                                  // 間隔 2.0〜5.4 秒（短めに偏る）
    }
    return out;
  }
  // まばたき 1 回の閉じ具合（0 開 → 1 閉）：閉じる 0.10 秒・保つ 0.04 秒・開く 0.16 秒（途中のコマが見える速さ）
  const BC = 0.10, BH = 0.04, BO = 0.16;
  function blinkAt(t) {
    let c = 0;
    for (const b of blinks) {
      const x = t - b; if (x < 0 || x > BC + BH + BO) continue;
      let v = x < BC ? x / BC : x < BC + BH ? 1 : Math.max(0, 1 - (x - BC - BH) / BO);
      v = v < 1 ? v * v * (3 - 2 * v) : 1; c = Math.max(c, v);
    }
    return c;
  }
  function lipsAt(t) {
    if (!lips) return { open: 0, shape: [1, 0, 0, 0, 0] };
    const f = t * lips.fps; const i = Math.floor(f), fr = f - i;
    const n = lips.open.length; if (i < 0 || i >= n) return { open: 0, shape: [1, 0, 0, 0, 0] };
    const j = Math.min(i + 1, n - 1);
    const open = lips.open[i] * (1 - fr) + lips.open[j] * fr;
    const shape = lips.shape[i].map((v, k) => v * (1 - fr) + lips.shape[j][k] * fr);
    return { open, shape };
  }
  function exprAt(t) {   // 表情（ジト目・笑顔）: events = [{t, dur, expr}]
    for (const e of events) {
      const x = t - e.t; if (x < 0 || x > e.dur) continue;
      const r = cfg.eye.expr[e.expr]; if (!r) continue;
      const k = Math.min(1, x / 0.15, (e.dur - x) / 0.2);                   // 0.15 秒で入って 0.2 秒で戻る
      return { range: r, k: Math.max(0, k) };
    }
    return null;
  }
  window.render = function (t) {
    const L = lipsAt(t);
    // 目：まばたき（開→25%→半目→75%→閉じ、間は補間コマ）。表情の間はまばたきしない
    let fa = 0, fb = 0, fr = 0;
    const ex = exprAt(t);
    if (ex) {                                                                  // まばたきのキーを途中まで通って表情へ
      const path = ex.range; const i = Math.min(path.length - 1, Math.round(ex.k * (path.length - 1)));
      fa = fb = path[i]; fr = 0;
    } else {                                                                   // まばたき：まぶたの高さがいちばん近いコマ
      const c = blinkAt(t); const lid = cfg.eye.blink_lid; let best = 0;
      for (let i = 1; i < lid.length; i++) if (Math.abs(lid[i] - c) < Math.abs(lid[best] - c)) best = i;
      fa = fb = best; fr = 0;
    }
    // 髪：ゆっくりの揺れ＋細かい揺れ（根元から）。頭の傾きに少し遅れてついてくる
    const tilt = 0.7 * Math.PI / 180 * Math.sin(2 * Math.PI * t / 4.4 + 0.6) * (0.65 + 0.35 * Math.sin(2 * Math.PI * t / 7.3 + 1.1));
    const th = cfg.strands.map((s, i) => {
      const ph = i * 1.37, ph2 = i * 2.11 + 0.5;
      const deg = s.amp * (0.62 * Math.sin(2 * Math.PI * t / 3.2 + ph) + 0.38 * Math.sin(2 * Math.PI * t / 1.9 + ph2));
      return deg * Math.PI / 180 - tilt * 0.6;
    });
    const ov = window.override;                                                // 確認用：{open, shape:[5], eye:[fa,fb,fr], still:true}
    if (ov) { if (ov.open !== undefined) L.open = ov.open; if (ov.shape) L.shape = ov.shape; if (ov.eye) [fa, fb, fr] = ov.eye; }
    gl.viewport(0, 0, W, H);
    if (ALPHA) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    if (ov && ov.still) { th.fill(0); gl.uniform1f(U('tilt'), 0); } else gl.uniform1f(U('tilt'), tilt);
    gl.uniform1fv(U('theta'), th);
    gl.uniform1f(U('eyeA'), fa); gl.uniform1f(U('eyeB'), fb); gl.uniform1f(U('eyeMix'), fr);
    gl.uniform1f(U('mOpen'), L.open); gl.uniform1fv(U('mShape'), L.shape);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    window.state = { t, open: L.open, eye: [fa, fb, fr], tilt };
  };

  (async () => {
    cfg = await (await fetch(A + 'config.json?v=' + Date.now())).json();
    const names = ['original', 'base', 'hair', 'eyes', 'mouthskin', 'sw0', 'sw1', 'sw2', 'ss0', 'ss1', 'ss2', 'mask'];
    const ims = await Promise.all(names.map((n) => loadImg(n + '.png').catch(() => null)));
    const units = ['tOrig', 'tBase', 'tHair', 'tEyes', 'tMouth', 'tW0', 'tW1', 'tW2', 'tS0', 'tS1', 'tS2', 'tMask'];
    ims.forEach((im, i) => { if (im) { tex(im, i); gl.uniform1i(U(units[i]), i); } });
    gl.uniform1f(U('N'), cfg.size);
    gl.uniform1f(U('alphaMode'), ALPHA && ims[11] ? 1 : 0);
    gl.uniform4fv(U('eyeRect'), cfg.eye.rect); gl.uniform1f(U('eyeCount'), cfg.eye.count);
    if (cfg.mouth) { gl.uniform4fv(U('mRect'), cfg.mouth.rect); gl.uniform4fv(U('mGeo'), [cfg.mouth.cx, cfg.mouth.cy, cfg.mouth.k, cfg.mouth.halfw]); }
    gl.uniform2fv(U('roots'), cfg.strands.flatMap((s) => s.pts[0]));
    gl.uniform2fv(U('pivot'), cfg.pivot); gl.uniform1f(U('neckY'), cfg.neck_y);
    const lp = qs.get('lips') || (qs.has('export') ? '' : A + 'lips.json');
    if (lp) lips = await (await fetch(lp + '?v=' + Date.now())).json();
    const tl = qs.get('timeline') || (qs.has('export') ? '' : A + 'timeline.json');
    if (tl) { try { const T = await (await fetch(tl + '?v=' + Date.now())).json(); events = T.events || []; } catch (e) { events = []; } }
    blinks = buildBlinks(lips ? lips.duration : 30, +(qs.get('seed') || 7));
    window.ready = true;
    if (!qs.has('export')) {                                                    // 画面で見るとき：音と一緒に再生
      const au = new Audio(qs.get('audio') || A + 'voice.wav'); let t0 = performance.now();
      const btn = document.getElementById('play');
      if (btn) btn.onclick = () => { t0 = performance.now(); if (au) { au.currentTime = 0; au.play(); } };
      const loop = () => { const t = au && !au.paused ? au.currentTime : (performance.now() - t0) / 1000; window.render(t); requestAnimationFrame(loop); };
      loop();
    }
  })().catch((e) => { document.body.insertAdjacentHTML('beforeend', '<pre style="color:red">' + e + '</pre>'); });
})();
