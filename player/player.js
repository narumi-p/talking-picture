// 喋る絵（1枚の絵が喋る）：下地＋目のコマ＋視線＋コードで描く口＋眉＋揺れる髪 9 本＋ Live2D 風の顔の向き
// 顔の向き：顔を楕円の奥行き（鼻のあたりが手前）として、奥行きに比例してずらす。前髪は顔より手前、後ろ髪は奥。
//   止まっているときは画素の中心をそのまま読むので、元の絵と同じ（絵の大きさのまま書き出したとき）。
// window.render(t) で決定論的に 1 コマ描く（書き出し用）。
// URL: ?assets=assets（層のフォルダ）&lips=…&timeline=…&audio=…&seed=7&alpha=1（背景を透明に）&w=&h=（既定は絵の大きさ）
//      &motion=1（顔の向き・呼吸の強さ。0 で止める）
(() => {
  const qs = new URLSearchParams(location.search);
  const cv = document.getElementById('gl');
  const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
  const A = (qs.get('assets') || window.TP_ASSETS || 'assets') + '/';   // TP_ASSETS：埋め込み先で層のフォルダを決めるとき
  const ALPHA = qs.get('alpha') === '1';
  const MOTION = qs.has('motion') ? +qs.get('motion') : 1;
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
  uniform sampler2D tOrig, tBase, tHair, tEyes, tMouth, tW0, tW1, tW2, tS0, tS1, tS2, tMask, tBrow, tBrowSkin, tIris, tSclera, tEyeOpen, tNeck;
  uniform float hasHead;                                // 頭と首を別の層にする（tNeck：首の層の色＋頭の濃さ）
  uniform vec3 neckZone;                                // 首のまわり (cx, 上の y, 半幅)：首の層のここだけは動かさない
  uniform float alphaMode;       // 1 のとき背景を透明に（tMask＝下地の不透明さ）
  uniform float bgMode; uniform vec3 bgColor; uniform float hasMask;   // 背景：0 元のまま、1 色でぬる、2 透明
  uniform vec3 srcBg;                                   // 元の絵の背景の色（ふちの色から差し引く）
  uniform float eyeMidX;                                // 左右の目の境（ここより左は eyeA、右は eyeB のコマ）
  uniform vec4 cheekL, cheekR; uniform float blush;     // 頬 (x, y, 半径) と照れ（0〜1）
  uniform vec3 sweat; uniform vec2 anger;               // 汗 (強さ, 下がる量, 0)、怒りマーク (強さ, 大きさ)
  uniform float N;               // 絵の大きさ
  uniform vec2 outSize; uniform vec3 view;                // 書き出しの大きさ、(倍率, 絵の左上の x, y)
  uniform vec4 eyeRect; uniform float eyeCount, eyeA, eyeB, eyeMix;   // 目の範囲・コマ数・混ぜる 2 コマと割合
  uniform vec4 mRect; uniform vec4 mGeo;                // 口の範囲、(cx, cy, k, halfw)
  uniform float mOpen; uniform float mShape[5];         // 口の開き、あいうえお の重み
  uniform vec3 mLine; uniform float mLineW;             // 元の口の線の色と太さ（画素）
  uniform vec4 bRect; uniform float browDy, hasBrow;    // 眉の範囲と上下（画素、上が負）
  uniform vec4 iRect; uniform vec2 gaze; uniform float hasIris;   // 黒目の範囲と視線（画素）
  uniform vec2 roots[9]; uniform float theta[9];        // 髪の根元と角度（ラジアン）
  uniform vec2 pivot; uniform float neckY, tilt;        // 頭の傾き
  uniform vec4 faceE, hairE;                            // 顔の楕円・髪の楕円 (cx, cy, rx, ry)
  uniform vec2 turn;                                    // 顔の向き：奥行き 1 の所のずれ（画素）
  uniform float hairFront, backDepth, breath;           // 前髪の手前さ、後ろの奥さ、呼吸（肩の上下、画素）
  uniform float soft;                                   // 首・肩のなじませ幅の倍率（絵の中の顔の大きさに合わせる）
  uniform vec3 nose; uniform vec3 depthMix;             // 鼻 (x, y, 半径)、奥行きの混ぜ方（頭の丸み・顔のふくらみ・鼻）
  uniform vec2 bodyPivot; uniform float bodyRoll;       // 体の角度：足元を軸に体ごと少し傾ける（全身の絵）
  vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  #define smp(t, q) texture(t, (q) / N)
  // Catmull-Rom（9 回の読み出し）。止まっているとき（画素の中心）は元の画素そのもの、動くときもぼけにくい
  // sampler は関数の引数にしない（ANGLE/D3D で別のテクスチャを読むことがある）ので、マクロで関数を作る
  #define DEFCR(NAME, T) vec4 NAME(vec2 q){ \\
    vec2 sz = vec2(textureSize(T, 0)); vec2 t1 = floor(q - 0.5) + 0.5; vec2 f = q - t1; \\
    vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)); vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f); \\
    vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)); vec2 w3 = f * f * (-0.5 + 0.5 * f); \\
    vec2 w12 = w1 + w2; vec2 t12 = (t1 + w2 / w12) / sz; vec2 t0 = (t1 - 1.0) / sz; vec2 t3 = (t1 + 2.0) / sz; \\
    vec4 r = texture(T, vec2(t0.x, t0.y)) * w0.x * w0.y + texture(T, vec2(t12.x, t0.y)) * w12.x * w0.y + texture(T, vec2(t3.x, t0.y)) * w3.x * w0.y \\
           + texture(T, vec2(t0.x, t12.y)) * w0.x * w12.y + texture(T, vec2(t12.x, t12.y)) * w12.x * w12.y + texture(T, vec2(t3.x, t12.y)) * w3.x * w12.y \\
           + texture(T, vec2(t0.x, t3.y)) * w0.x * w3.y + texture(T, vec2(t12.x, t3.y)) * w12.x * w3.y + texture(T, vec2(t3.x, t3.y)) * w3.x * w3.y; \\
    return clamp(r, 0.0, 1.0); }
  DEFCR(crBase, tBase)
  DEFCR(crHair, tHair)
  DEFCR(crEyes, tEyes)
  DEFCR(crBrow, tBrow)
  DEFCR(crBrowSkin, tBrowSkin)
  DEFCR(crMouth, tMouth)
  DEFCR(crIris, tIris)
  DEFCR(crSclera, tSclera)
  DEFCR(crNeck, tNeck)
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
  // 奥行き：顔の楕円の中ほど手前（なめらかに 0 へ）。後ろは少し奥（背景は無地なので動いても見えない）
  float ell(vec2 p, vec4 e){ vec2 d = (p - e.xy) / e.zw; return 1.0 - dot(d, d); }
  float zFace(vec2 p){ float f = clamp((ell(p, faceE) + 0.3) / 1.3, 0.0, 1.0); return f * f * (3.0 - 2.0 * f); }
  float headW(vec2 p){ return smoothstep(neckY + 60.0 * soft, neckY - 80.0 * soft, p.y); }
  // 奥行き＝頭全体の丸み（髪ごと回る。髪の楕円の中ほど手前、縁で 0 のドーム）＋顔のふくらみ＋鼻の高まり
  vec2 dHeadRaw(vec2 p){
    float s = clamp((ell(p, hairE) + 0.1) / 1.1, 0.0, 1.0);
    float zh = 1.0 - (1.0 - s) * (1.0 - s);
    vec2 dn = (p - nose.xy) / max(nose.z, 1.0);
    float zn = exp(-0.5 * dot(dn, dn));
    float z = depthMix.x * zh + depthMix.y * zFace(p) + depthMix.z * zn;
    float back = backDepth * (1.0 - zFace(p)) * smoothstep(-0.2, 0.5, ell(p, hairE));
    return turn * (z - back);
  }
  vec2 dBase(vec2 p){ return dHeadRaw(p) * headW(p); }
  // 首の層：首と襟のまわりはほぼ止め、それ以外（後ろの髪など）は頭と同じに動く
  float neckStill(vec2 p){ return smoothstep(neckZone.z * 1.35, neckZone.z * 0.95, abs(p.x - neckZone.x)) * smoothstep(neckZone.y - 60.0 * soft, neckZone.y + 20.0 * soft, p.y); }
  vec2 dNeck(vec2 p){ return dBase(p) * (1.0 - 0.88 * neckStill(p)); }
  // 前髪：顔の上では顔と同じに動く（顔に掛かる細い毛が二重にならない）。顔の外の髪だけ少し手前（視差）
  vec2 dHair(vec2 p){
    float z = zFace(p);
    float fall = smoothstep(-0.25, 0.45, ell(p, hairE));
    float outer = clamp(-ell(p, vec4(faceE.xy, faceE.z * 1.3, faceE.w * 1.1)) / 0.5, 0.0, 1.0);   // 顔と耳のまわりは顔と同じ
    return dBase(p) + turn * hairFront * fall * outer * headW(p);
  }
  // 出力の位置 q に来る元の絵の位置 p（p + d(p) = q をくり返しで解く）
  vec2 invBase(vec2 q){ vec2 p = q; for (int i = 0; i < 3; i++) p = q - dBase(p); return p; }
  vec2 invHead(vec2 q){ vec2 p = q; for (int i = 0; i < 3; i++) p = q - dHeadRaw(p); return p; }
  vec2 invNeck(vec2 q){ vec2 p = q; for (int i = 0; i < 2; i++) p = q - dNeck(p); return p; }
  vec2 invHair(vec2 q){ vec2 p = q; for (int i = 0; i < 3; i++) p = q - dHair(p); return p; }
  // 口（コードで描く）：笑みの曲がりに沿った開き。中は暗い赤、舌、い・え は上の歯
  vec4 mouthPaint(vec2 q){
    float a = mShape[0], i_ = mShape[1], u = mShape[2], e = mShape[3], ob = mShape[4];
    float wf = a * 0.9 + i_ * 1.1 + u * 0.55 + e * 1.0 + ob * 0.66;
    float hf = a * 1.0 + i_ * 0.38 + u * 0.5 + e * 0.62 + ob * 0.86;
    float rnd = clamp(u + ob, 0.0, 1.0);
    float hw = mGeo.w * mix(0.95, wf, smoothstep(0.0, 0.45, mOpen));
    float h = mGeo.w * 0.82 * hf * mOpen;
    float x = q.x - mGeo.x; float yc = mGeo.y + mGeo.z * x * x * mix(1.0, 0.75, smoothstep(0.0, 0.6, mOpen));   // 笑みの反りを残す
    float un = x / hw; float v = q.y - yc;
    if (abs(un) > 1.25) return vec4(0);
    float bump = max(0.0, 1.0 - un * un);
    float topE = -h * mix(0.26, 0.42, rnd) * pow(bump, mix(0.75, 0.5, rnd));
    float botE =  h * mix(0.74, 0.58, rnd) * pow(bump, mix(0.6, 0.5, rnd));
    float px = 1.0;                                                // 1 画素ぶんのぼかし
    float inside = smoothstep(-px, px, v - topE) * smoothstep(-px, px, botE - v) * smoothstep(1.0 + 0.02, 1.0 - 0.02, abs(un));
    vec3 col = mix(vec3(0.30, 0.08, 0.11), mLine * vec3(0.75, 0.45, 0.55), 0.35);   // 口の中：元の線の色に寄せた暗い赤
    float ty = botE - h * 0.30; float tw = hw * 0.55, th = h * 0.42;   // 舌
    float tng = smoothstep(1.0, 0.9, length(vec2(x / max(tw, 1.0), (q.y - yc - ty) / max(th, 1.0))));
    col = mix(col, vec3(0.80, 0.38, 0.44), tng * 0.9);
    float teeth = smoothstep(0.42, 0.52, i_ + e) * smoothstep(0.15, 0.3, mOpen);   // 上の歯（い・え）。出すか出さないか
    float tb = smoothstep(px, -px, v - (topE + h * 0.22)) * step(abs(un), 0.82);
    col = mix(col, vec3(0.97, 0.95, 0.95), clamp(teeth * tb, 0.0, 1.0));
    float lw = max(mLineW, 1.0);
    float edgeTop = 1.0 - smoothstep(lw * 0.45, lw * 0.45 + 1.0, abs(v - topE));   // 輪郭線：上は元の線の太さ、下は細く薄く
    float edgeBot = (1.0 - smoothstep(lw * 0.2, lw * 0.2 + 1.0, abs(v - botE))) * 0.5;
    float lineMask = max(edgeTop, edgeBot) * smoothstep(1.12, 0.98, abs(un));
    float corner = (1.0 - smoothstep(lw * 0.7, lw * 0.7 + 1.0, abs(v - topE * 0.2))) * smoothstep(1.2, 1.02, abs(un)) * smoothstep(0.88, 1.0, abs(un));   // 口角は元の絵のように太く
    lineMask = max(lineMask, corner);
    vec3 lineCol = mLine;
    float alpha = max(inside, lineMask);
    vec3 c = mix(col, lineCol, lineMask * (1.0 - inside * 0.6));
    return vec4(c, alpha);
  }
  void main(){
    vec2 fp = vec2(uv.x, 1.0 - uv.y) * outSize;                     // 書き出しの画素
    vec2 q = (fp - view.yz) / view.x;                               // 絵の画素
    // 体の角度：足元を軸に体ごと傾ける
    if (bodyRoll != 0.0) q = bodyPivot + rot(q - bodyPivot, -bodyRoll);
    // 呼吸：肩から胸を少し上下（頭と足は動かさない）
    q.y += breath * smoothstep(neckY - 40.0 * soft, neckY + 160.0 * soft, q.y) * (1.0 - smoothstep(neckY + 420.0 * soft, neckY + 900.0 * soft, q.y));
    // 頭の傾き（首から上だけ）
    vec2 qt = pivot + rot(q - pivot, -tilt * headW(q));
    // 頭の層があれば、頭はあごまで丸ごと首の付け根を軸に傾き・向きを変え、首の層はわずかに動く
    vec2 pb = hasHead > 0.5 ? invHead(pivot + rot(q - pivot, -tilt)) : invBase(qt);   // 顔・目・口・眉の位置
    vec3 under = crBase(pb).rgb;
    // 目
    if (pb.x >= eyeRect.x + 2.0 && pb.x < eyeRect.z - 2.0 && pb.y >= eyeRect.y + 2.0 && pb.y < eyeRect.w - 2.0) {   // 端の 2 画素は下地のまま（コマの端は下地と同じ。となりのコマを拾わない）
      float eh = eyeRect.w - eyeRect.y;
      vec2 e = pb - eyeRect.xy;
      float fr = pb.x < eyeMidX ? eyeA : eyeB;                    // 左右の目で別のコマ（ウインク）
      under = crEyes(vec2(e.x, e.y + fr * eh)).rgb;
    }
    // 視線：開いた目のときだけ、白目の上で黒目をずらす（まばたき・表情の間は正面）
    if (hasIris > 0.5 && (pb.x < eyeMidX ? eyeA : eyeB) < 0.5 && dot(gaze, gaze) > 0.0004 && pb.x >= iRect.x + 2.0 && pb.x < iRect.z - 2.0 && pb.y >= iRect.y + 2.0 && pb.y < iRect.w - 2.0) {
      vec2 iq = pb - iRect.xy;
      float m = texture(tEyeOpen, iq / vec2(textureSize(tEyeOpen, 0))).r;
      if (m > 0.0) {
        vec4 ic = crIris(iq - gaze);
        vec3 col = mix(crSclera(iq).rgb, ic.rgb, ic.a);
        under = mix(under, col, m);
      }
    }
    // 眉：動いている間は眉を消した肌の上に、ずらした眉を重ねる
    if (hasBrow > 0.5 && abs(browDy) > 0.02 && pb.x >= bRect.x && pb.x < bRect.z && pb.y >= bRect.y && pb.y < bRect.w) {
      vec2 bq = pb - bRect.xy;
      vec3 sk = crBrowSkin(bq).rgb;
      vec4 bc = crBrow(bq - vec2(0.0, browDy));
      under = mix(sk, bc.rgb, bc.a);
    }
    // 口：開いている間は口なしの肌＋コードの口
    if (mOpen > 0.0 && pb.x >= mRect.x && pb.x < mRect.z && pb.y >= mRect.y && pb.y < mRect.w) {
      vec3 sk = crMouth(pb - mRect.xy).rgb;
      float k = smoothstep(0.0, 0.10, mOpen);
      under = mix(under, sk, k);
      vec4 mp = mouthPaint(pb);
      under = mix(under, mp.rgb, mp.a * k);
    }
    // 照れ：頬に桃色、強いときは斜めの照れ線
    if (blush > 0.01) {
      for (int k = 0; k < 2; k++) {
        vec4 ck = k == 0 ? cheekL : cheekR;
        vec2 dv = (pb - ck.xy) / max(ck.z, 1.0);
        float g = exp(-1.6 * dot(dv * vec2(0.8, 1.25), dv * vec2(0.8, 1.25)));
        under = mix(under, under * vec3(1.0, 0.74, 0.76), clamp(blush * g * 0.75, 0.0, 1.0));
        if (blush > 0.4) {
          vec2 r = vec2(dv.x * 0.8 + dv.y * 0.6, -dv.x * 0.6 + dv.y * 0.8);   // 斜めの線（3 本）
          float ln = 0.0;
          for (int j = -1; j <= 1; j++) ln = max(ln, (1.0 - smoothstep(0.035, 0.07, abs(r.x - float(j) * 0.32))) * (1.0 - smoothstep(0.32, 0.42, abs(r.y))));
          under = mix(under, vec3(0.86, 0.38, 0.44), ln * clamp((blush - 0.4) * 1.8, 0.0, 0.85));
        }
      }
    }
    if (hasHead > 0.5) {                                            // 首の層の上に頭の層を重ねる（あごの下から首が見える）
      vec2 pn = invNeck(pivot + rot(q - pivot, -tilt * headW(q) * (1.0 - 0.8 * neckStill(q))));
      float ha = texture(tNeck, pb / N).a;
      under = mix(crNeck(pn).rgb, under, ha);
    }
    // 髪（前の層）：顔より手前に動き、根元から揺れる
    vec2 ph = invHair(qt);
    vec2 d = hairDisp(ph);
    vec4 hc = crHair(ph - d);
    vec3 col = mix(under, hc.rgb, hc.a); float al = 1.0;
    if ((alphaMode > 0.5 || bgMode > 0.5) && hasMask > 0.5) {
      float ua = smp(tMask, pb).r;                                   // 下地の不透明さ（人物と奥の髪は 1、背景は 0）
      al = ua * (1.0 - hc.a) + hc.a;
      vec3 fgU = max(under - srcBg * (1.0 - ua), vec3(0.0));         // ふちに混ざった元の背景の色を差し引いた人物の色（premultiplied）
      vec3 pm = fgU * (1.0 - hc.a) + hc.rgb * hc.a;                   // 重ねた色（premultiplied）
      col = al > 0.001 ? pm / al : vec3(0.0);
      if (bgMode > 0.5 && bgMode < 1.5) { col = bgColor * (1.0 - al) + pm; al = 1.0; }
    }
    // 漫符（頭と一緒に動く）：汗と怒りマーク
    vec2 F = faceE.xy; float R = faceE.z;
    if (sweat.x > 0.01) {                                           // 汗：上がとがって下が丸いしずく（こめかみの横、少しずつ下がる）
      vec2 sp = (pb - (F + vec2(1.02 * R, -0.30 * faceE.w + sweat.y))) / (0.12 * R);
      float r0 = 0.55; vec2 c0 = vec2(0.0, 0.45);
      float dc = length(sp - c0) - r0;                                // 下の丸
      float tip = -1.0;                                               // 上の先
      float hw = r0 * clamp((sp.y - tip) / (c0.y - tip), 0.0, 1.0);   // 先から丸へ広がる幅
      float dt = sp.y < c0.y ? max(abs(sp.x) - hw, tip - sp.y) : 1.0;
      float dd = min(dc, dt);
      float fill = 1.0 - smoothstep(-0.03, 0.03, dd), edge = (1.0 - smoothstep(0.03, 0.11, abs(dd))) * step(-0.25, dd);
      float hl = 1.0 - smoothstep(0.07, 0.13, length((sp - vec2(-0.2, 0.35)) * vec2(1.0, 0.7)));
      vec3 sc = mix(vec3(0.70, 0.86, 1.0), vec3(1.0), hl); sc = mix(sc, vec3(0.22, 0.42, 0.72), edge);
      float sa = max(fill, edge) * sweat.x;
      col = mix(col, sc, sa); al = max(al, sa);
    }
    if (anger.x > 0.01) {                                           // 怒りマーク：おでこの左上、外へ反った 4 本の弧
      vec2 ap = (pb - (F + vec2(-0.70 * R, -0.80 * faceE.w))) / (0.24 * R * anger.y);
      vec2 aq = abs(ap);
      float ring = abs(length(aq - vec2(0.75)) - 0.55);
      float inside = step(aq.x, 0.78) * step(aq.y, 0.78) * step(0.1, min(aq.x, aq.y));
      float stroke = (1.0 - smoothstep(0.08, 0.14, ring)) * inside;
      float outl = (1.0 - smoothstep(0.14, 0.2, ring)) * inside;
      float aa = outl * anger.x;
      col = mix(col, mix(vec3(1.0), vec3(0.88, 0.1, 0.16), stroke / max(outl, 1e-3)), aa); al = max(al, aa);
    }
    o = vec4(col, al);
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

  let cfg, lips = null, blinks = [], saccades = [], events = [], W = 0, H = 0, envS = null, envL = null;
  function buildBlinks(dur, seed) {
    const r = rng(seed); const out = []; let t = 0.9 + r() * 0.8;
    while (t < dur + 5) {
      out.push(t);
      if (r() < 0.18) out.push(t + 0.32 + r() * 0.1);                     // 2 回続けて
      t += 2.0 + Math.pow(r(), 1.6) * 3.4;                                  // 間隔 2.0〜5.4 秒（短めに偏る）
    }
    return out;
  }
  // 視線の移り先：1.2〜3.6 秒ごとに、正面のまわりのどこかへ（すばやく移って、しばらく見る）
  function buildSaccades(dur, seed) {
    const r = rng(seed * 7 + 3); const out = [{ t: 0, x: 0, y: 0 }]; let t = 1.0 + r();
    while (t < dur + 5) { const far = r() < 0.25; out.push({ t, x: (r() * 2 - 1) * (far ? 1.0 : 0.45), y: (r() * 2 - 1) * (far ? 0.6 : 0.3) }); t += 1.2 + r() * 2.4; }
    return out;
  }
  function saccadeAt(t) {
    let i = 0; while (i + 1 < saccades.length && saccades[i + 1].t <= t) i++;
    const a = saccades[Math.max(0, i - 1)], b = saccades[i]; const k = ease((t - b.t) / 0.07);
    return i === 0 ? [b.x, b.y] : [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k];
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
  // 声の勢い：短い平均と長い平均（差がうなずき）
  function buildEnv() {
    if (!lips) return;
    const o = lips.open, n = o.length, fps = lips.fps;
    const avg = (win) => { const out = new Float32Array(n); let s = 0; const k = Math.max(1, Math.round(win * fps));
      for (let i = 0; i < n; i++) { s += o[i]; if (i >= k) s -= o[i - k]; out[i] = s / Math.min(i + 1, k); } return out; };
    envS = avg(0.12); envL = avg(0.7);
  }
  function envAt(arr, t) { if (!arr) return 0; const i = Math.min(arr.length - 1, Math.max(0, Math.round(t * lips.fps))); return arr[i]; }
  const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  // 表情の強さ（0〜1）：入り 0.18 秒・抜け 0.3 秒
  function exprK(e, t) { const x = t - e.t; if (x < 0 || x > e.dur) return 0; return ease(Math.min(x / 0.18, (e.dur - x) / 0.3)); }
  function exprAt(t) {   // 目の表情（ジト目・笑顔）: events = [{t, dur, expr}]
    for (const e of events) {
      const x = t - e.t; if (x < 0 || x > e.dur) continue;
      const r = cfg.eye.expr[e.expr]; if (!r) continue;
      const k = Math.min(1, x / 0.15, (e.dur - x) / 0.2);                   // 0.15 秒で入って 0.2 秒で戻る
      return { range: r, k: Math.max(0, k) };
    }
    return null;
  }
  // ゆっくり変わるなめらかな揺れ（周期の違う sin の和。決定論）
  const wob = (t, a, b, c, ph) => 0.55 * Math.sin(2 * Math.PI * t / a + ph) + 0.3 * Math.sin(2 * Math.PI * t / b + ph * 1.7) + 0.15 * Math.sin(2 * Math.PI * t / c + ph * 2.3);
  // 顔の向き・眉・呼吸（Live2D でいう角度 X/Y/Z・眉・呼吸のパラメータ）
  function poseAt(t) {
    const hd = cfg.head || {};
    let yaw = 0.55 * wob(t, 6.3, 3.7, 2.3, 0.4), pitch = 0.35 * wob(t, 5.1, 2.9, 1.7, 1.9), roll = 0.12 * wob(t, 7.7, 4.1, 2.6, 2.8);
    let brow = 0, blush = 0, sweat = 0, anger = 0;
    const talk = envAt(envL, t), nod = Math.max(-0.2, Math.min(0.6, envAt(envS, t) - talk));
    pitch += 0.9 * nod; brow -= 0.35 * Math.max(0, nod);                              // 強く言う所で少しうなずき、眉も少し上がる
    yaw *= 1 + 0.4 * talk;
    for (const e of events) {
      const k = exprK(e, t); if (!k) continue;
      if (e.expr === 'smile') { pitch -= 0.35 * k; roll += 0.25 * k; brow -= 0.25 * k; }
      if (e.expr === 'jito') { yaw += 0.55 * k; pitch += 0.35 * k; brow += 0.5 * k; }
      if (e.expr === 'brow') { pitch -= 0.45 * k; brow -= 1.0 * k; }
      if (e.expr === 'blush') blush = Math.max(blush, k * (e.amount ?? 0.8));
      if (e.expr === 'sweat') sweat = Math.max(sweat, k);
      if (e.expr === 'anger') { anger = Math.max(anger, k); brow += 0.6 * k; }
    }
    const breath = 0.5 + 0.5 * Math.sin(2 * Math.PI * t / 3.6);
    // 視線：頭と逆に少し動いて正面を見続ける＋ときどき移す。ジト目は横目
    let [gx, gy] = saccades.length ? saccadeAt(t) : [0, 0];
    gx = gx * 0.6 - yaw * 0.5; gy = gy * 0.6 - pitch * 0.4;
    for (const e of events) { const k = exprK(e, t); if (k && e.expr === 'jito') { gx = gx * (1 - k) + 1.0 * k; gy *= 1 - k; } if (k && e.expr === 'smile') { gx *= 1 - k; gy *= 1 - k; } }
    return { yaw: yaw * MOTION, pitch: pitch * MOTION, roll: roll * MOTION, brow, breath: breath * MOTION, gaze: [gx * MOTION, gy * MOTION], blush, sweat, anger };
  }
  window.render = function (t) {
    if (window.TP && window.TP.manual) return renderManual(t);
    const L = lipsAt(t);
    // 目：まばたき（開→25%→半目→75%→閉じ）。表情の間はまばたきしない
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
    const P = poseAt(t), hd = cfg.head || {}, N = cfg.size;
    const tilt = (hd.roll_deg ?? 7.0) * Math.PI / 180 * P.roll;
    // 髪：ゆっくりの揺れ＋細かい揺れ（根元から）。顔の向きにも少し遅れてついてくる
    const P2 = poseAt(t - 0.25);
    const th = cfg.strands.map((s, i) => {
      const ph = i * 1.37, ph2 = i * 2.11 + 0.5;
      const deg = s.amp * (0.62 * Math.sin(2 * Math.PI * t / 3.2 + ph) + 0.38 * Math.sin(2 * Math.PI * t / 1.9 + ph2));
      const lag = (P.yaw - P2.yaw) * 6 * Math.sign(s.pts[s.pts.length - 1][0] - s.pts[0][0] || 1);
      return deg * Math.PI / 180 - tilt * 0.6 + lag * Math.PI / 180;
    });
    let turn = [(hd.yaw_px ?? N * 0.013) * P.yaw, (hd.pitch_px ?? N * 0.008) * P.pitch];
    let browDy = (hd.brow_px ?? N * 0.012) * P.brow, breath = -(hd.breath_px ?? N * 0.0016) * P.breath;
    let gaze = [(hd.gaze_px ?? N * 0.006) * P.gaze[0], (hd.gaze_px ?? N * 0.006) * 0.6 * P.gaze[1]];
    const ov = window.override;                                                // 確認用：{open, shape:[5], eye:[fa,fb,fr], still:true, yaw, pitch, brow, gaze:[x,y]}
    if (ov) {
      if (ov.open !== undefined) L.open = ov.open; if (ov.shape) L.shape = ov.shape; if (ov.eye) [fa, fb, fr] = ov.eye;
      if (ov.still) { th.fill(0); turn = [0, 0]; browDy = 0; breath = 0; gaze = [0, 0]; }
      if (ov.gaze) gaze = [(hd.gaze_px ?? N * 0.006) * ov.gaze[0], (hd.gaze_px ?? N * 0.006) * 0.6 * ov.gaze[1]];
      if (ov.yaw !== undefined) turn[0] = (hd.yaw_px ?? N * 0.013) * ov.yaw;
      if (ov.pitch !== undefined) turn[1] = (hd.pitch_px ?? N * 0.008) * ov.pitch;
      if (ov.brow !== undefined) browDy = (hd.brow_px ?? N * 0.012) * ov.brow;
    }
    const body = hd.body ? (hd.body.deg ?? 0.5) * Math.PI / 180 * wob(t, 8.3, 5.1, 3.3, 0.9) * MOTION * (ov && ov.still ? 0 : 1) : 0;
    draw(t, fa, fb, fr, L.open, L.shape, ov && ov.still ? 0 : tilt, th, turn, browDy, breath, gaze, body, { blush: P.blush, sweat: P.sweat, anger: P.anger });
  };
  function draw(t, fa, fb, fr, open, shape, tilt, th, turn, browDy, breath, gaze, body = 0, fx = {}) {
    gl.uniform1f(U('bodyRoll'), body);
    // 漫符と背景（fx：blush 0〜1、sweat 0〜1、anger 0〜1、bg {mode:0 元/1 色/2 透明, color:[r,g,b] 0〜1}）
    const hd = cfg.head || {}, ry = hd.face ? hd.face[3] : cfg.size * 0.25;
    gl.uniform1f(U('blush'), fx.blush || 0);
    gl.uniform3fv(U('sweat'), [fx.sweat || 0, ((t * 0.22) % 1) * 0.22 * ry, 0]);
    gl.uniform2fv(U('anger'), [fx.anger || 0, 1 + 0.1 * Math.sin(t * 9)]);
    const bg = fx.bg || (window.TP && window.TP.bg) || { mode: 0 };
    gl.uniform1f(U('bgMode'), bg.mode || 0); gl.uniform3fv(U('bgColor'), bg.color || [0, 1, 0]);
    gl.viewport(0, 0, W, H);
    if (ALPHA) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.uniform1f(U('tilt'), tilt);
    gl.uniform1fv(U('theta'), th);
    gl.uniform2fv(U('turn'), turn); gl.uniform1f(U('browDy'), browDy); gl.uniform1f(U('breath'), breath); gl.uniform2fv(U('gaze'), gaze);
    gl.uniform1f(U('eyeA'), fa); gl.uniform1f(U('eyeB'), fb); gl.uniform1f(U('eyeMix'), fr);
    gl.uniform1f(U('mOpen'), open); gl.uniform1fv(U('mShape'), shape);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    window.state = { t, open, eye: [fa, fb, fr], tilt, turn, browDy, gaze };
  }

  // ── 手で動かす（studio.html など）：window.TP.manual = true にすると、TP.params の値で描く ──
  //   params: yaw/pitch/roll（顔の向き、-1.5〜1.5）、body（体の角度、全身の絵のとき）、eyeOpen（1 開 〜 0 閉）、expr（'' / 'smile' / 'jito'）と exprK（0〜1）、
  //           gazeX/gazeY（視線 -1〜1）、brow（眉 -1 下 〜 1 上）、mouthOpen（0〜1）、shape（[あ,い,う,え,お]）、hair（髪の揺れの倍率）
  //   auto:   blink（自動まばたき）、idle（ゆっくり首を動かす）、breath（呼吸）、saccade（視線をときどき移す）、sway（髪の揺れ）
  //   live:   {open, shape}（マイクや音声ファイルから。口の開きは params と大きい方）
  const TP = window.TP = {
    manual: false,
    params: { yaw: 0, pitch: 0, roll: 0, body: 0, eyeOpen: 1, eyeOpenL: 1, eyeOpenR: 1, winkSmile: true, expr: '', exprK: 0, gazeX: 0, gazeY: 0, brow: 0,
              mouthOpen: 0, shape: [1, 0, 0, 0, 0], hair: 1, blush: 0, sweat: 0, anger: 0 },
    bg: { mode: 0, color: [0, 1, 0] },                                       // 背景：0 元のまま、1 色でぬる、2 透明
    hasBody: () => !!(cfg && cfg.head && cfg.head.body),
    auto: { blink: true, idle: true, breath: true, saccade: true, sway: true },
    live: null,
    render: (t) => window.render(t),
  };
  let prevYaw = 0, prevT = 0;
  function renderManual(t) {
    const p = TP.params, a = TP.auto, hd = cfg.head || {}, N = cfg.size;
    const tt = t % 600;
    // 目：表情があればそのコマへ、なければ「開き」と自動まばたきの閉じた方。左右別（ウインク）
    const path = p.expr && cfg.eye.expr[p.expr];
    const lid = cfg.eye.blink_lid, bk = a.blink ? blinkAt(tt) : 0;
    const frameFor = (open1) => {
      if (path && p.exprK > 0.02) return path[Math.min(path.length - 1, Math.round(p.exprK * (path.length - 1)))];
      const c = Math.max(1 - p.eyeOpen * open1, bk); let f = 0;
      if (p.winkSmile !== false && open1 < 0.5 && cfg.eye.expr.smile) { const sp = cfg.eye.expr.smile; return sp[Math.min(sp.length - 1, Math.round((1 - open1 * 2) * (sp.length - 1)))]; }
      for (let i = 1; i < lid.length; i++) if (Math.abs(lid[i] - c) < Math.abs(lid[f] - c)) f = i;
      return f;
    };
    const fa = frameFor(p.eyeOpenL ?? 1), fb = frameFor(p.eyeOpenR ?? 1);
    // 口：手で決めた開きと、声（live）の大きい方
    const lv = TP.live; let open = p.mouthOpen, shape = p.shape;
    if (lv && lv.open > open) { open = lv.open; shape = lv.shape; }
    // 顔の向き：手の値＋ゆっくりの揺れ。声の強い所で少しうなずく
    const idle = a.idle ? 1 : 0;
    const nod = lv ? Math.max(0, (lv.open - (lv.avg || 0))) : 0;
    const yaw = p.yaw + idle * 0.3 * wob(tt, 6.3, 3.7, 2.3, 0.4);
    const pitch = p.pitch + idle * 0.22 * wob(tt, 5.1, 2.9, 1.7, 1.9) + 0.8 * nod;
    const roll = p.roll + idle * 0.08 * wob(tt, 7.7, 4.1, 2.6, 2.8);
    const tilt = (hd.roll_deg ?? 7.0) * Math.PI / 180 * roll;
    // 視線：手の値（マウス）＋ときどき移す。頭と逆に少し
    let [sx, sy] = a.saccade && saccades.length ? saccadeAt(tt) : [0, 0];
    const gx = Math.max(-1.3, Math.min(1.3, p.gazeX + sx * 0.35 - (yaw - p.yaw) * 0.5));
    const gy = Math.max(-1.3, Math.min(1.3, p.gazeY + sy * 0.3 - (pitch - p.pitch) * 0.4));
    // 髪：揺れ＋首を振った勢いで遅れてついてくる
    const dt = Math.max(1e-3, t - prevT); const vel = Math.max(-3, Math.min(3, (yaw - prevYaw) / dt)); prevYaw = yaw; prevT = t;
    const sw = a.sway ? p.hair : 0;
    const th = cfg.strands.map((s, i) => {
      const ph = i * 1.37, ph2 = i * 2.11 + 0.5;
      const deg = s.amp * sw * (0.62 * Math.sin(2 * Math.PI * tt / 3.2 + ph) + 0.38 * Math.sin(2 * Math.PI * tt / 1.9 + ph2));
      const lag = -vel * 1.2 * Math.sign(s.pts[s.pts.length - 1][0] - s.pts[0][0] || 1);
      return (deg + lag) * Math.PI / 180 - tilt * 0.6;
    });
    const turn = [(hd.yaw_px ?? N * 0.013) * yaw, (hd.pitch_px ?? N * 0.008) * pitch];
    const browDy = -(hd.brow_px ?? N * 0.012) * (p.brow + 0.4 * nod);
    const breath = a.breath ? -(hd.breath_px ?? N * 0.0016) * (0.5 + 0.5 * Math.sin(2 * Math.PI * tt / 3.6)) : 0;
    const gaze = [(hd.gaze_px ?? N * 0.006) * gx, (hd.gaze_px ?? N * 0.006) * 0.6 * gy];
    const body = hd.body ? (hd.body.deg ?? 0.5) * Math.PI / 180 * (p.body + idle * wob(tt, 8.3, 5.1, 3.3, 0.9)) : 0;
    draw(t, fa, fb, 0, open, shape, tilt, th, turn, browDy, breath, gaze, body, { blush: p.blush, sweat: p.sweat, anger: p.anger, bg: TP.bg });
  }

  (async () => {
    cfg = await (await fetch(A + 'config.json?v=' + Date.now())).json();
    const N = cfg.size;
    // 大きさ：?w=&h=、または TP_SIZE（長い辺。埋め込み先で決めるとき）、無ければ絵（frame）の大きさのまま
    const FW = cfg.frame ? cfg.frame[2] : N, FH = cfg.frame ? cfg.frame[3] : N;
    const ts = window.TP_SIZE ? window.TP_SIZE / Math.max(FW, FH) : 1;
    W = +(qs.get('w') || Math.round(FW * ts)); H = +(qs.get('h') || Math.round(FH * ts)); cv.width = W; cv.height = H;
    // 絵の置き方：frame（絵の中の見せる範囲）があればそこを収める。無ければ横幅に合わせ、縦長のときは下に寄せる
    if (cfg.frame) {
      const [fx, fy, fw, fh] = cfg.frame; const sc = Math.min(W / fw, H / fh);
      gl.uniform2fv(U('outSize'), [W, H]); gl.uniform3fv(U('view'), [sc, (W - fw * sc) / 2 - fx * sc, (H - fh * sc) / 2 - fy * sc]);
    } else {
      const sc = Math.min(W, H) / N;
      gl.uniform2fv(U('outSize'), [W, H]); gl.uniform3fv(U('view'), [sc, (W - N * sc) / 2, H - N * sc]);
    }
    const names = ['original', 'base', 'hair', 'eyes', 'mouthskin', 'sw0', 'sw1', 'sw2', 'ss0', 'ss1', 'ss2', 'mask', 'brows', 'browskin', 'iris', 'sclera', 'eyeopen', 'necklayer'];
    const ims = await Promise.all(names.map((n) => loadImg(n + '.png').catch(() => null)));
    const units = ['tOrig', 'tBase', 'tHair', 'tEyes', 'tMouth', 'tW0', 'tW1', 'tW2', 'tS0', 'tS1', 'tS2', 'tMask', 'tBrow', 'tBrowSkin', 'tIris', 'tSclera', 'tEyeOpen', 'tNeck'];
    ims.forEach((im, i) => { if (im) { tex(im, i); gl.uniform1i(U(units[i]), i); } });
    gl.uniform1f(U('N'), N);
    gl.uniform1f(U('alphaMode'), ALPHA && ims[11] ? 1 : 0); gl.uniform1f(U('hasMask'), ims[11] ? 1 : 0);
    gl.uniform3fv(U('srcBg'), (cfg.background_rgb || [252, 251, 251]).map((v) => v / 255));
    gl.uniform1f(U('eyeMidX'), cfg.head && cfg.head.nose ? cfg.head.nose[0] : (cfg.eye.rect[0] + cfg.eye.rect[2]) / 2);
    const ch = cfg.cheeks || [[0, 0, 1], [0, 0, 1]];
    gl.uniform4fv(U('cheekL'), [...ch[0], 0]); gl.uniform4fv(U('cheekR'), [...ch[1], 0]);
    gl.uniform4fv(U('eyeRect'), cfg.eye.rect); gl.uniform1f(U('eyeCount'), cfg.eye.count);
    if (cfg.mouth) {
      gl.uniform4fv(U('mRect'), cfg.mouth.rect); gl.uniform4fv(U('mGeo'), [cfg.mouth.cx, cfg.mouth.cy, cfg.mouth.k, cfg.mouth.halfw]);
      gl.uniform3fv(U('mLine'), cfg.mouth.line_rgb || [0.36, 0.16, 0.15]); gl.uniform1f(U('mLineW'), cfg.mouth.line_w || 2.0);
    }
    gl.uniform1f(U('hasBrow'), cfg.brow && ims[12] ? 1 : 0);
    if (cfg.brow) gl.uniform4fv(U('bRect'), cfg.brow.rect);
    gl.uniform1f(U('hasIris'), cfg.iris && ims[14] ? 1 : 0);
    gl.uniform1f(U('hasHead'), cfg.head_layer && ims[17] ? 1 : 0);
    gl.uniform3fv(U('neckZone'), cfg.neck_zone || [N / 2, N, 1]);
    if (cfg.iris) gl.uniform4fv(U('iRect'), cfg.iris.rect);
    gl.uniform2fv(U('roots'), cfg.strands.flatMap((s) => s.pts[0]));
    gl.uniform2fv(U('pivot'), cfg.pivot); gl.uniform1f(U('neckY'), cfg.neck_y);
    const hd = cfg.head || {};
    gl.uniform4fv(U('faceE'), hd.face || [N / 2, N * 0.5, N * 0.24, N * 0.27]);
    gl.uniform4fv(U('hairE'), hd.hair || [N / 2, N * 0.45, N * 0.45, N * 0.48]);
    gl.uniform1f(U('hairFront'), hd.hair_front ?? 0.3); gl.uniform1f(U('backDepth'), hd.back ?? 0.35);
    gl.uniform1f(U('soft'), hd.soft ?? 1.0);
    gl.uniform3fv(U('nose'), hd.nose || [N / 2, N * 0.57, N * 0.03]);
    gl.uniform3fv(U('depthMix'), hd.depth || [0.55, 0.45, 0.12]);
    gl.uniform2fv(U('bodyPivot'), (hd.body && hd.body.pivot) || [N / 2, N]);
    const lp = qs.get('lips') || (qs.has('export') ? '' : A + 'lips.json');
    if (lp) { try { const r = await fetch(lp + '?v=' + Date.now()); lips = r.ok ? await r.json() : null; } catch (e) { lips = null; } }
    buildEnv();
    const tl = qs.get('timeline') || (qs.has('export') ? '' : A + 'timeline.json');
    if (tl) { try { const T = await (await fetch(tl + '?v=' + Date.now())).json(); events = T.events || []; } catch (e) { events = []; } }
    blinks = buildBlinks(Math.max(lips ? lips.duration : 0, 600), +(qs.get('seed') || 7));   // 手で動かすときのため 10 分ぶん（前の方は同じ）
    saccades = buildSaccades(Math.max(lips ? lips.duration : 0, 600), +(qs.get('seed') || 7));
    window.ready = true;
    window.dispatchEvent(new Event('tp-ready'));
    if (!qs.has('export') && !window.TP_EXTERNAL_LOOP) {                                                    // 画面で見るとき：音と一緒に再生
      const au = new Audio(qs.get('audio') || A + 'voice.wav'); let t0 = performance.now();
      const btn = document.getElementById('play');
      if (btn) btn.onclick = () => { t0 = performance.now(); if (au) { au.currentTime = 0; au.play(); } };
      const loop = () => { const t = au && !au.paused ? au.currentTime : (performance.now() - t0) / 1000; window.render(t); requestAnimationFrame(loop); };
      loop();
    }
  })().catch((e) => { document.body.insertAdjacentHTML('beforeend', '<pre style="color:red">' + e + '</pre>'); });
})();
