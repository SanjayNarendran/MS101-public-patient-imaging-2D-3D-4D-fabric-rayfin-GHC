#!/usr/bin/env node
/**
 * Builds the OHIF Viewer used by the Pathology (OHIF) and 3D/4D (OHIF) tabs and copies it to public/ohif/,
 * so Vite serves it in development and `npm run build` ships it in dist/ohif/.
 *
 *   node ohif/build.mjs            (needs Node 24 or later, as OHIF 3.13 does)
 *
 * Steps: clone OHIF at a pinned tag into ohif/.build/Viewers (git-ignored), install its dependencies with pnpm,
 * add the Rayfin extension (ohif/extension-rayfin), apply ohif/patches/*.patch, use the trimmed plugin list and app
 * config from ohif/config/, build with PUBLIC_URL=/ohif/, then copy the output without source maps or the unused AI
 * model runtime (ort/).
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const OHIF_TAG = 'v3.13.13';
const PNPM = 'npx -y pnpm@12.8.1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(HERE, '.build', 'Viewers');
const OUT = join(ROOT, 'public', 'ohif');

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.error(`OHIF ${OHIF_TAG} needs Node 24 or later; this is Node ${process.versions.node}.`);
  process.exit(1);
}

const run = (cmd, cwd = SRC, env = {}) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
};

if (!existsSync(SRC)) {
  mkdirSync(dirname(SRC), { recursive: true });
  run(`git clone --depth 1 --branch ${OHIF_TAG} https://github.com/OHIF/Viewers.git ${SRC}`, ROOT);
}
if (!existsSync(join(SRC, 'node_modules'))) {
  run(`${PNPM} install --frozen-lockfile`);
}

// Start from a clean checkout of the files we change, then apply our changes.
run('git checkout -- extensions/dicom-microscopy platform/app/pluginConfig.json');
for (const patch of readdirSync(join(HERE, 'patches')).filter(f => f.endsWith('.patch'))) {
  run(`git apply ${join(HERE, 'patches', patch)}`);
}
rmSync(join(SRC, 'extensions', 'rayfin'), { recursive: true, force: true });
cpSync(join(HERE, 'extension-rayfin'), join(SRC, 'extensions', 'rayfin'), { recursive: true });
cpSync(join(HERE, 'config', 'pluginConfig.json'), join(SRC, 'platform', 'app', 'pluginConfig.json'));
cpSync(join(HERE, 'config', 'rayfin.js'), join(SRC, 'platform', 'app', 'public', 'config', 'rayfin.js'));

run(`${PNPM} run build`, join(SRC, 'platform', 'app'), {
  NODE_ENV: 'production',
  PUBLIC_URL: '/ohif/',
  APP_CONFIG: 'config/rayfin.js',
});

const dist = join(SRC, 'platform', 'app', 'dist');
rmSync(OUT, { recursive: true, force: true });
cpSync(dist, OUT, {
  recursive: true,
  filter: src => {
    const rel = relative(dist, src);
    return !rel.endsWith('.map') && rel !== 'ort' && !rel.startsWith(`ort/`);
  },
});

// Fira Sans for the light-touch Rayfin theme (see ohif/extension-rayfin/src/theme.ts).
mkdirSync(join(OUT, 'fonts'), { recursive: true });
for (const w of [400, 500, 600]) {
  const file = `fira-sans-latin-${w}-normal.woff2`;
  cpSync(join(ROOT, 'node_modules', '@fontsource', 'fira-sans', 'files', file), join(OUT, 'fonts', file));
}

const size = dir =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size),
    0
  );
writeFileSync(
  join(OUT, 'rayfin-build.json'),
  JSON.stringify({ ohif: OHIF_TAG, builtAt: new Date().toISOString() }, null, 2)
);
console.log(`OHIF ${OHIF_TAG} → public/ohif (${(size(OUT) / 1e6).toFixed(1)} MB)`);
