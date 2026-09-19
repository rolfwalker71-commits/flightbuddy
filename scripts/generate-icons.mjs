// Regenerates the PWA / home-screen icons from one vector source.
//   node scripts/generate-icons.mjs
//
// - apple-touch-icon: opaque full-bleed square. iOS/iPadOS applies its own
//   squircle mask, so any baked-in rounding or transparent margin just makes
//   the glyph look small on the home screen.
// - maskable: full-bleed, glyph kept inside the 80 % safe-zone circle.
// - any: rounded tile for browsers that show the icon unmasked.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../public/", import.meta.url));

const BG_TOP = "#171B22";
const BG_BOTTOM = "#0B0D10";
const GLYPH = "#3DDCFF";
const PLANE =
  "M96 280c88-24 152-88 232-152l48 16-32 72c48 8 88 24 120 48-40-8-88-8-136 8l-40 88-40-24 24-80c-72 32-128 56-176 24z";
// Glyph bounding box centre in its own coordinates (x 96–464, y 128–360).
const GLYPH_CX = 280;
const GLYPH_CY = 244;

function svg({ scale, radius }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BG_TOP}"/>
      <stop offset="1" stop-color="${BG_BOTTOM}"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <path transform="translate(256 256) scale(${scale}) translate(${-GLYPH_CX} ${-GLYPH_CY})" d="${PLANE}" fill="${GLYPH}"/>
</svg>
`;
}

const full = svg({ scale: 1.17, radius: 0 });
const rounded = svg({ scale: 1.17, radius: 112 });
const maskable = svg({ scale: 0.92, radius: 0 });

async function png(source, size, file, { flatten = false } = {}) {
  let img = sharp(Buffer.from(source), { density: 384 }).resize(size, size);
  if (flatten) img = img.flatten({ background: BG_BOTTOM });
  await img.png({ compressionLevel: 9 }).toFile(`${root}${file}`);
}

await Promise.all([
  png(full, 180, "icons/apple-touch-icon.png", { flatten: true }),
  png(full, 180, "apple-touch-icon.png", { flatten: true }),
  png(rounded, 192, "icons/icon-192.png"),
  png(rounded, 512, "icons/icon-512.png"),
  png(maskable, 512, "icons/icon-maskable-512.png", { flatten: true }),
  writeFile(`${root}icons/icon.svg`, rounded),
]);

console.log("icons written to public/icons");
