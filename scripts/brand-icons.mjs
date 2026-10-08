import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

// Render the official SVG symbol for the window, taskbar and executable.
// All output stays in this project's public directory on D:.
const svg = await readFile(new URL('../public/icon.svg', import.meta.url), 'utf8');
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(size => Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()));
await writeFile(new URL('../public/icon.png', import.meta.url), images.at(-1));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const at = 6 + i * 16;
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(images[i].length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += images[i].length;
});
await writeFile(new URL('../public/icon.ico', import.meta.url), Buffer.concat([header, ...images]));
// Modern ICNS chunks carry PNGs, keeping the macOS icon derived from the same SVG.
const chunks = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128],
  ['ic08', 256], ['ic09', 512], ['ic10', 1024],
].map(([type, size]) => {
  const png = Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  const chunk = Buffer.alloc(8); chunk.write(type); chunk.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([chunk, png]);
});
const icnsHeader = Buffer.alloc(8); icnsHeader.write('icns');
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
await writeFile(new URL('../public/icon.icns', import.meta.url), Buffer.concat([icnsHeader, ...chunks]));
// Template images let macOS supply light/dark/selected menu-bar colors.
const template = svg.replace(/fill="url\(#[^)]+\)"/g, 'fill="#000"');
for (const [name, size] of [['trayTemplate.png', 16], ['trayTemplate@2x.png', 32]]) {
  await writeFile(new URL(`../public/${name}`, import.meta.url), new Resvg(template, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
console.log('Brand icons generated from the official TsingShu.AI symbol.');
