/**
 * Render the Varnox PWA icons from the same geometry as public/icon.svg.
 *
 * The mark is a gold V on a near-black tile with a thin gold rim — the card style the app already
 * uses everywhere else: dark surface, gold outline, gold glyph.
 *
 * Two reasons it stopped being green-and-white. The green was the only green thing in a product
 * whose every accent, border and heading is gold, so the tab and the home-screen icon disagreed
 * with the app behind them. And a near-black tile has no edge of its own against a dark home
 * screen or a dark tab bar, which is what the rim is for.
 *
 * The V geometry is unchanged from the original renderer. It is the mark; only its colour moved.
 *
 * Usage: `node scripts/render-icons.mjs` — writes the four PNGs into public/.
 */
import sharp from 'sharp';

// Near-black: the same two values the manifest uses for its background and theme colours.
const TILE =
  '<linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#1a1509"/><stop offset="1" stop-color="#0a0805"/></linearGradient>';

// --brand and --brand-strong, so the icon is drawn from the same two golds as the interface.
const GOLD =
  '<linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#facc15"/><stop offset="1" stop-color="#d9a900"/></linearGradient>';

const V = [
  [122, 148], [174, 148], [240, 264], [316, 148], [368, 148], [288, 356], [228, 356],
];

/** The glyph, optionally scaled about the centre so a maskable render keeps it inside the mask. */
const poly = (k) =>
  V.map(([x, y]) => `${(256 + (x - 256) * k).toFixed(1)},${(256 + (y - 256) * k).toFixed(1)}`).join(' ');

const svg = (radius, k, rim) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
<defs>${TILE}${GOLD}</defs>
<rect width="512" height="512" rx="${radius}" fill="url(#tile)"/>
${
  // Inset rather than drawn on the edge, or the tile's own corner radius would shave it unevenly.
  rim
    ? `<rect x="18" y="18" width="476" height="476" rx="${Math.round(radius * 0.82)}" fill="none" stroke="#facc15" stroke-opacity="0.7" stroke-width="6"/>`
    : ''
}
<polygon points="${poly(k)}" fill="url(#gold)"/>
</svg>`;

const jobs = [
  [192, 116, 1.0, true],
  [512, 116, 1.0, true],
  [180, 116, 1.0, true], // apple-touch-icon
  // Full bleed, no rim, smaller glyph: the platform applies its own mask, so a rim near the edge
  // would be part cut away and part kept, which reads as a mistake rather than as a style.
  [512, 0, 0.72, false], // maskable
];

const names = { 180: 'apple-touch-icon', 192: 'icon-192', 512: null };

for (const [size, radius, k, rim] of jobs) {
  const name =
    !rim && size === 512 ? 'icon-maskable-512' : size === 512 ? 'icon-512' : names[size];
  const out = `public/${name}.png`;
  await sharp(Buffer.from(svg(radius, k, rim)), { density: 400 })
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`  ${out}  ${size}x${size}`);
}
