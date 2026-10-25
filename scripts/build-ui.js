import { copyFile, mkdir } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await copyFile('hq/dist/index.html', 'public/hq.html');
console.log('Built Agent4 UI at public/hq.html (outside the data volume).');
