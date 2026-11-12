import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

function pdfAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist');
  const folders = ['cmaps', 'standard_fonts', 'wasm'];
  return {
    name: 'pdf-reader-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (request, response, next) => {
        const path = (request.url || '').split('?')[0].replace(/^\//, '');
        const [folder, name, extra] = path.split('/');
        if (!folders.includes(folder) || !name || extra || !/^[\w.-]+$/.test(name)) return next();
        try {
          const bytes = readFileSync(resolve(root, folder, name));
          response.setHeader(
            'Content-Type',
            name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream',
          );
          response.end(bytes);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const folder of folders) {
        for (const name of readdirSync(resolve(root, folder))) {
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${folder}/${name}`,
            source: readFileSync(resolve(root, folder, name)),
          });
        }
      }
    },
  };
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve('src/main/index.ts') } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          timetable: resolve('src/preload/timetable.ts'),
        },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), pdfAssets()],
  },
});
