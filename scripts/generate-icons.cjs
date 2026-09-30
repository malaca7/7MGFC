// Generates minimal PNG icons for the Chrome extension
// Uses a simple 1-pixel PNG approach with branding colors
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Minimal valid PNG generator
function createPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = createChunk('IHDR', ihdrData);

  // IDAT chunk - raw pixel data with zlib
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 3)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 3;
      const ri = y * (1 + width * 3) + 1 + x * 3;
      rawData[ri] = pixels[pi];
      rawData[ri + 1] = pixels[pi + 1];
      rawData[ri + 2] = pixels[pi + 2];
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idat = createChunk('IDAT', compressed);

  // IEND chunk
  const iend = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type);
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function setPixel(pixels, width, x, y, r, g, b) {
  const i = (y * width + x) * 3;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
}

// Simple 7M text bitmap for different sizes
// For each size, we create a dark background with red accent
const sizes = [16, 48, 128];

sizes.forEach(size => {
  const pixels = Buffer.alloc(size * size * 3);

  // Fill with background #050505
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = 5;
    pixels[i * 3 + 1] = 5;
    pixels[i * 3 + 2] = 5;
  }

  // Red accent line at bottom (6% height)
  const lineH = Math.max(2, Math.round(size * 0.06));
  for (let y = size - lineH; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(pixels, size, x, y, 229, 9, 20); // #E50914
    }
  }

  // Simple "7" shape
  const s = size;
  const margin = Math.round(s * 0.15);
  const thick = Math.max(2, Math.round(s * 0.12));

  // "7" top horizontal bar
  const topY = Math.round(s * 0.2);
  const midX = Math.round(s * 0.45);
  for (let y = topY; y < topY + thick; y++) {
    for (let x = margin; x < midX; x++) {
      if (x >= 0 && x < s && y >= 0 && y < s - lineH) {
        setPixel(pixels, size, x, y, 245, 245, 245);
      }
    }
  }

  // "7" diagonal
  for (let i = 0; i < Math.round(s * 0.5); i++) {
    const cx = midX - Math.round(i * 0.35);
    const cy = topY + thick + i;
    for (let dx = 0; dx < thick; dx++) {
      const px = cx - dx;
      if (px >= 0 && px < s && cy >= 0 && cy < s - lineH) {
        setPixel(pixels, size, px, cy, 245, 245, 245);
      }
    }
  }

  // "M" shape
  const mLeft = midX + Math.round(s * 0.05);
  const mRight = s - margin;
  const mTop = topY;
  const mBottom = Math.round(s * 0.75);

  // M left vertical
  for (let y = mTop; y < mBottom; y++) {
    for (let dx = 0; dx < thick; dx++) {
      const px = mLeft + dx;
      if (px < s && y < s - lineH) {
        setPixel(pixels, size, px, y, 245, 245, 245);
      }
    }
  }

  // M right vertical
  for (let y = mTop; y < mBottom; y++) {
    for (let dx = 0; dx < thick; dx++) {
      const px = mRight - thick + dx;
      if (px >= 0 && px < s && y < s - lineH) {
        setPixel(pixels, size, px, y, 245, 245, 245);
      }
    }
  }

  // M middle peak (two diagonals)
  const mMid = Math.round((mLeft + mRight) / 2);
  const peakDepth = Math.round((mBottom - mTop) * 0.45);
  for (let i = 0; i < peakDepth; i++) {
    // Left diagonal
    const lx = mLeft + thick + Math.round(i * ((mMid - mLeft - thick) / peakDepth));
    const ly = mTop + i;
    for (let dx = 0; dx < Math.ceil(thick * 0.7); dx++) {
      if (lx + dx < s && ly < s - lineH) {
        setPixel(pixels, size, lx + dx, ly, 245, 245, 245);
      }
    }
    // Right diagonal
    const rx = mRight - thick - Math.round(i * ((mRight - thick - mMid) / peakDepth));
    for (let dx = 0; dx < Math.ceil(thick * 0.7); dx++) {
      if (rx - dx >= 0 && rx - dx < s && ly < s - lineH) {
        setPixel(pixels, size, rx - dx, ly, 245, 245, 245);
      }
    }
  }

  const png = createPNG(size, size, pixels);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`Generated icon${size}.png (${size}x${size})`);
});

console.log('All icons generated!');
