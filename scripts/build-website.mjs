import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const output = resolve(process.argv[2] ?? '_site');
await mkdir(join(output, 'assets'), { recursive: true });
await cp('website', output, { recursive: true });
await cp('assets/icon.png', join(output, 'assets', 'icon.png'));
await cp('assets/screenshots', join(output, 'assets', 'screenshots'), { recursive: true });

const app = join(output, 'app');
await cp('out/renderer', app, { recursive: true });
const index = join(app, 'index.html');
const html = await readFile(index, 'utf8');
if (!html.includes('<script type="module"')) throw new Error('Built NEU-Dela renderer not found');
await writeFile(index, html.replace('<script type="module"', '<script src="../tour-fixture.js?v=study-tour-1"></script>\n    <script type="module"'));
