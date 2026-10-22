// Photo looks applied at draw time. Stored photos are never changed.
// Works on raw RGBA pixel arrays so it is tested in Node.

export const PHOTO_STYLES = [
  { value: 'off', label: 'Off' },
  { value: 'auto', label: 'Auto' },
  { value: 'club', label: 'Club grade' },
];

export const STYLE_SETTINGS = {
  // Auto: stretch levels (ignoring the darkest/brightest 0.5%), balance colour, even brightness,
  // then a little extra contrast and colour so the change is easy to see on a phone.
  auto: { clip: 0.005, levelStrength: 0.85, maxWbGain: 0.15, targetLuma: 0.5, gammaRange: [0.75, 1.35], contrast: 0.45, saturation: 1.3 },
  // Club grade: Auto, then muted colour with shadows toward maroon and highlights toward gold.
  club: { shadow: [122, 31, 43], highlight: [242, 183, 5], toneStrength: 0.28, desaturate: 0.35 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (x) => x * x * (3 - 2 * x);

/** Per-channel low/high percentiles and means of an RGBA buffer. */
export function photoStats(data, clip = STYLE_SETTINGS.auto.clip) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 8) continue; // ignore transparent pixels
    for (let c = 0; c < 3; c++) { hist[c][data[i + c]]++; sum[c] += data[i + c]; }
    n++;
  }
  if (!n) return { lo: [0, 0, 0], hi: [255, 255, 255], mean: [128, 128, 128], n: 0 };
  const pct = (h, p) => {
    const target = p * n;
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc > target) return v; }
    return 255;
  };
  return {
    lo: hist.map((h) => pct(h, clip)),
    hi: hist.map((h) => pct(h, 1 - clip)),
    mean: sum.map((s) => s / n),
    n,
  };
}

/** Lookup tables (and tone settings) for a style, from photoStats. Returns null for 'off'. */
export function buildGrade(stats, style) {
  if (style !== 'auto' && style !== 'club') return null;
  const A = STYLE_SETTINGS.auto;
  const grey = (stats.mean[0] + stats.mean[1] + stats.mean[2]) / 3 || 128;
  const luts = [0, 1, 2].map((c) => {
    const lo = stats.lo[c];
    const hi = Math.max(stats.hi[c], lo + 32); // don't blow up flat images
    const gain = clamp(grey / (stats.mean[c] || grey), 1 - A.maxWbGain, 1 + A.maxWbGain);
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) {
      const stretched = (v - lo) / (hi - lo);
      const levelled = A.levelStrength * stretched + (1 - A.levelStrength) * (v / 255);
      lut[v] = clamp(levelled * gain, 0, 1);
    }
    return lut;
  });
  // Brightness: gamma that moves the average luma toward the target.
  const meanLuma = luma(...[0, 1, 2].map((c) => luts[c][Math.round(clamp(stats.mean[c], 0, 255))])) || A.targetLuma;
  const gamma = clamp(Math.log(A.targetLuma) / Math.log(clamp(meanLuma, 0.02, 0.98)), ...A.gammaRange);
  const out = luts.map((lut) => {
    const u8 = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      const x = lut[v] ** gamma;
      u8[v] = Math.round(255 * (x + (smoothstep(x) - x) * A.contrast)); // gentle S-curve
    }
    return u8;
  });
  return { luts: out, saturation: A.saturation, tone: style === 'club' ? STYLE_SETTINGS.club : null };
}

/** Apply a grade to an RGBA buffer in place. */
export function applyGrade(data, grade) {
  if (!grade) return data;
  const [lr, lg, lb] = grade.luts;
  const t = grade.tone;
  // Auto lifts colour; Club grade mutes it instead, before the split-tone.
  const sat = t ? 1 - t.desaturate : grade.saturation ?? 1;
  for (let i = 0; i < data.length; i += 4) {
    let r = lr[data[i]];
    let g = lg[data[i + 1]];
    let b = lb[data[i + 2]];
    const l = luma(r, g, b);
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    if (t) {
      // Split-tone: dark areas lean maroon, bright areas lean gold.
      const k = l / 255;
      const sh = (1 - k) * t.toneStrength;
      const hl = k * t.toneStrength;
      r += (t.shadow[0] - r) * sh + (t.highlight[0] - r) * hl * k;
      g += (t.shadow[1] - g) * sh + (t.highlight[1] - g) * hl * k;
      b += (t.shadow[2] - b) * sh + (t.highlight[2] - b) * hl * k;
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return data;
}
