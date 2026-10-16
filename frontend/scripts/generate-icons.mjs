/**
 * Generates every image asset from the brand source PNG:
 *   public/icons/logo-64.png, icon-192/512, maskable-192/512,
 *   apple-touch-icon.png, favicon-16/32.png
 *   src/app/favicon.ico  (ICO container with embedded PNGs)
 *   public/og.png        (1200×630 social card)
 *
 * Source: 16-bit RGBA with an embedded ICC profile — sharp applies the
 * profile automatically when converting to sRGB.
 *
 * Run: npm run icons
 */
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SOURCE =
  process.env.ICON_SOURCE ??
  "/Users/mac/Desktop/ether-singals Exports/ether-singals-watchOS-Default-1088x1088@1x.png";
const ROOT = process.cwd();
const ICONS_DIR = path.join(ROOT, "public/icons");
const APP_DIR = path.join(ROOT, "src/app");

// Brand blues sampled from the source artwork.
const BRAND_BLUE = "#3b86f6";
const BRAND_BLUE_DEEP = "#2f6fd6";

mkdirSync(ICONS_DIR, { recursive: true });

async function renderPng(size, dest, { background } = {}) {
  let img = sharp(SOURCE).resize(size, size, {
    fit: "contain",
    background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
  });
  if (background) {
    // Flatten onto an opaque brand backdrop (apple-touch + maskable).
    img = img.flatten({ background });
  }
  await img.png({ compressionLevel: 9 }).toFile(dest);
  console.log("✓", path.relative(ROOT, dest));
}

/** Maskable icons need the artwork inside a 80% safe zone on a full-bleed disc. */
async function renderMaskable(size, dest) {
  const pad = Math.round(size * 0.1);
  const inner = size - pad * 2;
  const artwork = await sharp(SOURCE)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="g" cx="50%" cy="38%" r="75%">
      <stop offset="0%" stop-color="#62a6ff"/>
      <stop offset="100%" stop-color="${BRAND_BLUE_DEEP}"/>
    </radialGradient></defs>
    <rect width="${size}" height="${size}" fill="url(#g)"/>
  </svg>`;
  await sharp(Buffer.from(svg))
    .composite([{ input: artwork, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(dest);
  console.log("✓", path.relative(ROOT, dest));
}

/**
 * Minimal ICO packer: modern Windows/Chrome accept PNG-compressed entries.
 * One file, three sizes, no native tooling required.
 */
async function renderIco(sizes, dest) {
  const entries = [];
  for (const size of sizes) {
    const png = await sharp(SOURCE)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    entries.push({ size, png });
  }
  const headerSize = 6 + entries.length * 16;
  const total = entries.reduce((acc, e) => acc + e.png.length, headerSize);
  const buf = Buffer.alloc(total);
  buf.writeUInt16LE(0, 0); // reserved
  buf.writeUInt16LE(1, 2); // type: icon
  buf.writeUInt16LE(entries.length, 4);

  let offset = headerSize;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    buf[at] = e.size >= 256 ? 0 : e.size; // width (0 = 256)
    buf[at + 1] = e.size >= 256 ? 0 : e.size;
    buf[at + 2] = 0; // palette
    buf[at + 3] = 0; // reserved
    buf.writeUInt16LE(1, at + 4); // color planes
    buf.writeUInt16LE(32, at + 6); // bits per pixel
    buf.writeUInt32LE(e.png.length, at + 8);
    buf.writeUInt32LE(offset, at + 12);
    e.png.copy(buf, offset);
    offset += e.png.length;
  });

  const { writeFileSync } = await import("node:fs");
  writeFileSync(dest, buf);
  console.log("✓", path.relative(ROOT, dest));
}

/** 1200×630 social card: brand gradient, logo, wordmark, tagline. */
async function renderOg() {
  const logo = await sharp(SOURCE).resize(360, 360).png().toBuffer();
  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#050a14"/>
        <stop offset="55%" stop-color="#081226"/>
        <stop offset="100%" stop-color="#0c2148"/>
      </linearGradient>
      <radialGradient id="glow" cx="78%" cy="22%" r="60%">
        <stop offset="0%" stop-color="${BRAND_BLUE}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${BRAND_BLUE}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <g transform="translate(96,135)">
      <image href="data:image/png;base64,${logo.toString("base64")}" width="360" height="360"/>
    </g>
    <text x="510" y="300" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="104" font-weight="800" fill="#e8eefb" letter-spacing="-2">Ether<tspan fill="#4e96fb">Signals</tspan></text>
    <text x="513" y="368" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="40" fill="#8294b4">Real-time Ethereum signal feed</text>
    <text x="513" y="432" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="26" fill="#5b6c8a">Research &amp; education · Not financial advice</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(path.join(ROOT, "public/og.png"));
  console.log("✓ public/og.png");
}

await renderPng(64, path.join(ICONS_DIR, "logo-64.png"));
await renderPng(192, path.join(ICONS_DIR, "icon-192.png"));
await renderPng(512, path.join(ICONS_DIR, "icon-512.png"));
await renderMaskable(192, path.join(ICONS_DIR, "maskable-192.png"));
await renderMaskable(512, path.join(ICONS_DIR, "maskable-512.png"));
// iOS home-screen icons must be opaque (iOS fills transparency with black).
await renderPng(180, path.join(ICONS_DIR, "apple-touch-icon.png"), {
  background: BRAND_BLUE,
});
await renderPng(32, path.join(ICONS_DIR, "favicon-32.png"));
await renderPng(16, path.join(ICONS_DIR, "favicon-16.png"));
await renderIco([16, 32, 48], path.join(APP_DIR, "favicon.ico"));
await renderOg();
console.log("All brand assets generated.");
