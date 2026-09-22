// .workbuddy/scripts/gen-tabbar-icons.js
// 生成 tabBar 缺的两对图标（查专线 / 查公司），风格对齐现有 6 个图标。
//
// 现有规格（实测 assets/tabbar/*.png）：81x81、8bit、RGBA(colorType 6)。
// 现有图标是细线条描边风格，未选中 #8a93a3，选中 #2383e2（与 app.json 的
// tabBar.color / selectedColor 一致）。
//
// 为什么用脚本生成而不是手画：这是一次性资源补齐，脚本可复现、可微调线宽与
// 颜色，且避免"来源不明"的图片资产混入仓库。上线前若设计稿到位，直接替换 PNG 即可。
//
// 用法：node .workbuddy/scripts/gen-tabbar-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.resolve(__dirname, '..', '..', 'assets', 'tabbar');
const SIZE = 81;
const INACTIVE = [0x8a, 0x93, 0xa3];  // app.json tabBar.color
const ACTIVE = [0x23, 0x83, 0xe2];    // app.json tabBar.selectedColor

// ---------- 极简画布：只在内存里画 alpha + 颜色 ----------
function createCanvas(size) {
  const px = new Float32Array(size * size); // 覆盖率 0..1
  return {
    size,
    px,
    // 以距离场方式画描边线段（抗锯齿），w = 半线宽
    segment(x1, y1, x2, y2, w) {
      const minX = Math.max(0, Math.floor(Math.min(x1, x2) - w - 1));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(x1, x2) + w + 1));
      const minY = Math.max(0, Math.floor(Math.min(y1, y2) - w - 1));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(y1, y2) + w + 1));
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy || 1;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          let t = ((x - x1) * dx + (y - y1) * dy) / len2;
          t = Math.max(0, Math.min(1, t));
          const cx = x1 + t * dx, cy = y1 + t * dy;
          const d = Math.hypot(x - cx, y - cy);
          const cov = Math.max(0, Math.min(1, w + 0.5 - d));
          if (cov <= 0) continue;
          const i = y * size + x;
          px[i] = Math.max(px[i], cov);
        }
      }
    },
    // 圆环描边
    circle(cx, cy, r, w) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const d = Math.abs(Math.hypot(x - cx, y - cy) - r);
          const cov = Math.max(0, Math.min(1, w + 0.5 - d));
          if (cov <= 0) continue;
          const i = y * size + x;
          px[i] = Math.max(px[i], cov);
        }
      }
    },
    // 实心圆角矩形
    roundRect(x0, y0, x1, y1, r) {
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const cx = Math.min(Math.max(x, x0 + r), x1 - r);
          const cy = Math.min(Math.max(y, y0 + r), y1 - r);
          const d = Math.hypot(x - cx, y - cy);
          const cov = Math.max(0, Math.min(1, r + 0.5 - d));
          if (cov <= 0) continue;
          const i = y * size + x;
          px[i] = Math.max(px[i], cov);
        }
      }
    }
  };
}

// ---------- 图形定义（坐标基于 81x81，留 ~11px 边距） ----------
// 「查专线」：一条带节点的路线 —— 表达"从A到B的线路"
// 与"home"区分度足够（home 是房子轮廓）
function drawRoute(c) {
  const W = 2.0;                // 半线宽 ≈ 4px 线
  const a = { x: 21, y: 60 };   // 起点（左下）
  const b = { x: 60, y: 24 };   // 终点（右上）
  // 端点先画（作为背景层），再画连线，避免连线在圆点上切出缺口
  c.circle(a.x, a.y, 4.6, 4.6);
  c.circle(b.x, b.y, 4.6, 4.6);
  // 主线（沿 a→b 方向，两端各收进一点，不要顶穿端点圆）
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const gap = 3.2;
  c.segment(a.x + ux * gap, a.y + uy * gap, b.x - ux * gap, b.y - uy * gap, W);
}

// 「查公司」：楼宇轮廓（两个高低块 + 窗格）—— 表达"公司/企业"
// 与"user"区分度足够（user 是单人轮廓）
function drawCompany(c) {
  const W = 2.0;
  // 大楼外框
  c.segment(16, 25, 43, 25, W);
  c.segment(16, 65, 43, 65, W);
  c.segment(16, 25, 16, 65, W);
  c.segment(43, 25, 43, 65, W);
  // 副楼（右侧较矮）
  c.segment(50, 38, 66, 38, W);
  c.segment(50, 65, 66, 65, W);
  c.segment(50, 38, 50, 65, W);
  c.segment(66, 38, 66, 65, W);
  // 主楼窗格（2 列 3 行小方块）
  const win = 5;
  [[22, 33], [33, 33], [22, 45], [33, 45], [22, 57], [33, 57]].forEach(([x, y]) => {
    c.roundRect(x, y, x + win, y + win, 1.6);
  });
  // 副楼窗格（1 列 2 行）
  [[56, 45], [56, 57]].forEach(([x, y]) => {
    c.roundRect(x, y, x + win, y + win, 1.6);
  });
  // 地平线
  c.segment(11, 66, 70, 66, W);
}

// ---------- PNG 编码（纯 Node，无第三方依赖） ----------
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xFF;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(canvas, rgb) {
  const size = canvas.size;
  const [r, g, b] = rgb;
  // 每行前面加 1 字节 filter type = 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const cov = Math.max(0, Math.min(1, canvas.px[y * size + x]));
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = Math.round(cov * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function writeIcon(name, drawFn, rgb) {
  const c = createCanvas(SIZE);
  drawFn(c);
  const png = encodePNG(c, rgb);
  const dest = path.join(OUT_DIR, name);
  fs.writeFileSync(dest, png);
  // 自检：PNG 头 & 尺寸
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (w !== SIZE || h !== SIZE || png[25] !== 6) {
    throw new Error(name + ' 生成异常：' + w + 'x' + h + ' colorType=' + png[25]);
  }
  console.log('  ' + name + '  ' + w + 'x' + h + '  ' + png.length + ' bytes');
}

function main() {
  console.log('[gen-tabbar-icons] 生成 tabBar 图标 → ' + path.relative(path.resolve(__dirname, '..', '..'), OUT_DIR));
  writeIcon('route.png', drawRoute, INACTIVE);
  writeIcon('route-active.png', drawRoute, ACTIVE);
  writeIcon('company.png', drawCompany, INACTIVE);
  writeIcon('company-active.png', drawCompany, ACTIVE);
  console.log('[gen-tabbar-icons] 完成 4 个文件（2 对）');
}

main();
