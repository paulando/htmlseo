#!/usr/bin/env node
/*
 * Release build: copies ONLY the shipped extension files to dist/unpacked/ and
 * zips them to dist/htmlseo-<version>.zip (needs the `zip` CLI).
 * The Playwright extension tests load the same staged copy, so tests run against
 * exactly what ships.
 *
 *   npm run build      → dist/unpacked + dist/htmlseo-<version>.zip
 */
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Everything the extension needs at runtime. Add new runtime files here. */
export const SHIPPED = [
    'manifest.json',
    'background.js',
    'content.js',
    'analyzer.js',
    'overlay.js',
    'popup.html',
    'popup.css',
    'popup',
    'icon.png',
    'icon48.png',
    'icon64.png',
    'icon128.png',
    'bg.png',
    'LICENSE',
];

export async function stage(dest) {
    await rm(dest, { recursive: true, force: true });
    await mkdir(dest, { recursive: true });
    for (const f of SHIPPED) {
        await cp(path.join(ROOT, f), path.join(dest, f), { recursive: true, filter: (src) => !src.endsWith('.DS_Store') });
    }
    return dest;
}

async function main() {
    const { version } = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
    const dir = await stage(path.join(ROOT, 'dist/unpacked'));
    const out = path.join(ROOT, `dist/htmlseo-${version}.zip`);
    await rm(out, { force: true });
    execFileSync('zip', ['-r', '-q', out, '.'], { cwd: dir });
    console.log(`Staged ${dir}`);
    console.log(`Built  ${out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
