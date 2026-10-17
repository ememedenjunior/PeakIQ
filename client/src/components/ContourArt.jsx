import { useMemo } from 'react';

// Deterministic topographic rings: each ring is a closed wobbly curve, with the
// centre drifting toward the summit so inner rings bunch up like a real peak.
function buildRings({ cx, cy, sx = 1, sy = 1, count, gap, seed = 0, drift = [0, 0] }) {
  const N = 96;
  const rings = [];
  for (let k = 1; k <= count; k++) {
    const t = k / count;
    const ox = cx + drift[0] * (1 - t);
    const oy = cy + drift[1] * (1 - t);
    const r = gap * k;
    let d = '';
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wob =
        1 +
        0.09 * Math.sin(3 * a + seed + k * 0.35) +
        0.055 * Math.sin(5 * a + seed * 1.7 + 1.3) +
        0.035 * Math.sin(2 * a + seed * 0.6 + k * 0.12);
      const x = ox + Math.cos(a) * r * wob * sx;
      const y = oy + Math.sin(a) * r * wob * sy;
      d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    rings.push({ d: d + 'Z', index: k % 5 === 0 });
  }
  return rings;
}

function seedFrom(text = '') {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return h / 40;
}

/**
 * variant "hero"  : large map with the animated learning trail
 * variant "aside" : quiet backdrop for the sign-in panel
 * variant "tile"  : small strip for course cards (colour comes from CSS `color`)
 */
export default function ContourArt({ variant = 'hero', seed: seedText = '' }) {
  const config = {
    hero: { w: 600, h: 560, cx: 300, cy: 300, count: 15, gap: 21, drift: [62, -52], seed: 0.4 },
    aside: { w: 600, h: 700, cx: 420, cy: 250, count: 16, gap: 26, drift: [30, -40], seed: 2.1 },
    tile: { w: 320, h: 96, cx: 250, cy: 74, count: 9, gap: 11, sx: 1.7, sy: 0.7, drift: [-26, -10], seed: seedFrom(seedText) },
  }[variant];

  const rings = useMemo(() => buildRings(config), [variant, seedText]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg
      className="contours"
      viewBox={`0 0 ${config.w} ${config.h}`}
      preserveAspectRatio={variant === 'hero' ? 'xMidYMid meet' : 'xMidYMid slice'}
      aria-hidden="true"
      focusable="false"
    >
      {rings.map((r, i) => (
        <path key={i} d={r.d} className={`ring${r.index ? ' index' : ''}`} />
      ))}

      {variant === 'hero' && (
        <>
          {/* the climb: one stop per skill, ending at the summit */}
          <path className="trail" pathLength="1" d="M120 505 C 190 480, 240 450, 250 400 S 330 340, 345 300 S 362 270, 362 250" />
          <circle className="stop s1" cx="207" cy="462" r="8" />
          <circle className="stop s2" cx="250" cy="400" r="8" />
          <circle className="stop s3" cx="345" cy="300" r="8" />
          <text className="s1" x="223" y="478">Query data</text>
          <text className="s2" x="266" y="414">Backtest a strategy</text>
          <text className="s3" x="361" y="330">Train a model</text>
          <circle className="halo" cx="362" cy="250" r="9" />
          <circle className="summit" cx="362" cy="250" r="11" />
          <text className="s4" x="382" y="236">Deploy an app</text>
        </>
      )}
    </svg>
  );
}
