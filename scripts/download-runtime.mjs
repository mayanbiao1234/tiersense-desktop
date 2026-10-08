import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Bounded parallel ranges avoid one slow connection blocking a large runtime.
// The caller verifies the complete artifact against Electron's pinned SHA-256.
export async function downloadRuntime(url, destination, label) {
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  const size = Number(head.headers.get('content-length'));
  if (!head.ok || !Number.isSafeInteger(size) || size <= 0) throw new Error(`Cannot determine runtime length (${label})`);
  const parts = await mkdtemp(path.join(path.dirname(destination), 'tierflow-parts-'));
  const chunkSize = 4 * 1024 * 1024;
  const count = Math.ceil(size / chunkSize); let next = 0; let completed = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < count) {
      const index = next++; const start = index * chunkSize; const end = Math.min(size - 1, start + chunkSize - 1);
      const file = path.join(parts, String(index));
      const status = await new Promise((resolve, reject) => {
        const child = spawn('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '180',
          '--range', `${start}-${end}`, '--output', file, '--write-out', '%{http_code}', url], { windowsHide: true });
        let stdout = ''; let stderr = '';
        child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
        child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`${label} range ${index}: ${stderr.slice(-1000)}`)));
      });
      if (status !== '206' || (await stat(file)).size !== end - start + 1) throw new Error(`Invalid download range ${label} ${index}`);
      completed++; if (completed % 8 === 0 || completed === count) console.log(`${label}: downloaded ${completed}/${count} parts`);
    }
  }));
  await writeFile(destination, Buffer.alloc(0), { flag: 'wx' });
  for (let index = 0; index < count; index++) await appendFile(destination, await readFile(path.join(parts, String(index))));
}
