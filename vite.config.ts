import { rayfinLocalDev } from '@microsoft/rayfin-local-dev/vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, readdirSync, readFileSync, statSync } from 'fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolve, sep } from 'path';

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname;

const LOCAL_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.dzi': 'application/xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.dcm': 'application/dicom',
  '.frames': 'application/octet-stream',
};

/**
 * Local data mode (`npm run dev:local`): serves the pipeline output in work/ at /local-data/, standing in
 * for OneLake. Files are sent as stored, so `.nii.gz` volumes reach NiiVue still gzipped (no
 * Content-Encoding), exactly as OneLake serves them.
 */
function localDataPlugin(): Plugin {
  const roots: Record<string, string> = {
    lakehouse: resolve(projectRoot, 'work', 'lakehouse'),
    volumes: resolve(projectRoot, 'work', 'volumes'),
    dicom: resolve(projectRoot, 'work', 'dicom'),
  };
  return {
    name: 'local-data',
    configureServer(server) {
      server.middlewares.use('/local-data', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const [, folder, ...rest] = path.split('/');
        const root = roots[folder];
        if (!root) return next();
        const file = resolve(root, ...rest);
        if (!file.startsWith(root + sep)) {
          res.statusCode = 403;
          return res.end();
        }
        let size: number;
        try {
          const st = statSync(file);
          if (!st.isFile()) throw new Error('not a file');
          size = st.size;
        } catch {
          res.statusCode = 404;
          return res.end();
        }
        const ext = Object.keys(LOCAL_TYPES).find((e) => file.toLowerCase().endsWith(e));
        res.setHeader('Content-Type', ext ? LOCAL_TYPES[ext] : 'application/octet-stream');
        res.setHeader('Accept-Ranges', 'bytes');
        // Catalogs change when the pipeline is re-run; tiles and volumes are rewritten under the same names too.
        res.setHeader('Cache-Control', ext === '.json' || ext === '.dzi' ? 'no-cache' : 'public, max-age=300');
        // Single byte ranges, as OneLake serves them: the DICOM slide viewer reads one tile per request.
        const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range ?? ''));
        if (range) {
          const start = Number(range[1]);
          const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
          if (start >= size || end < start) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${size}`);
            return res.end();
          }
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', String(end - start + 1));
          return createReadStream(file, { start, end }).pipe(res);
        }
        res.setHeader('Content-Length', String(size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * PDF.js loads its image decoders (JBIG2, JPEG 2000, colour management) and font data at run time from folders,
 * not through the bundler. Serve them from node_modules in dev and copy them into the build under /pdfjs/.
 */
const PDFJS_ASSETS = ['wasm', 'standard_fonts', 'cmaps'];
function pdfjsAssetsPlugin(): Plugin {
  const root = resolve(projectRoot, 'node_modules', 'pdfjs-dist');
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const [, folder, name] = path.split('/');
        if (!PDFJS_ASSETS.includes(folder) || !name || name.includes('..')) return next();
        const file = resolve(root, folder, name);
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const folder of PDFJS_ASSETS) {
        for (const name of readdirSync(resolve(root, folder))) {
          this.emitFile({ type: 'asset', fileName: `pdfjs/${folder}/${name}`, source: readFileSync(resolve(root, folder, name)) });
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  // Pin the dev server to Rayfin's per-project port (VITE_PORT, mapped from
  // RAYFIN_PUBLIC_FRONTEND_PORT in .env.local) so multiple local frontends
  // don't collide and the deployed backend can allow-list one stable origin.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const port = env.VITE_PORT ? Number(env.VITE_PORT) : undefined;
  // Fail the production build early when the Rayfin publishable key is missing
  // for a remote backend. Vite statically inlines `import.meta.env.*`, so an
  // unset key would otherwise ship as `undefined` and only crash at runtime.
  // A localhost API URL resolves to the local-dev path, which needs no key.
  if (command === 'build') {
    const apiUrl = env.VITE_RAYFIN_API_URL;
    const isRemoteBackend =
      !!apiUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(apiUrl);
    if (isRemoteBackend && !env.VITE_RAYFIN_PUBLISHABLE_KEY) {
      throw new Error(
        'Missing required Rayfin client environment variable: VITE_RAYFIN_PUBLISHABLE_KEY.\n' +
          'Regenerate .env.local from rayfin/.env with: rayfin env --framework vite\n' +
          '(run `rayfin up` first if rayfin/.env has not been populated yet).'
      );
    }
  }
  const localData = env.VITE_LOCAL_DATA === '1';
  return {
    plugins: [react(), tailwindcss(), pdfjsAssetsPlugin(), localData ? localDataPlugin() : rayfinLocalDev()],
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src'),
      },
    },
    ...(port ? { server: { port, strictPort: true } } : {}),
    build: {
      // Target ES2022 for modern JavaScript decorators
      target: 'es2022',
    },
    esbuild: {
      target: 'es2022',
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'es2022',
      },
    },
  };
});
