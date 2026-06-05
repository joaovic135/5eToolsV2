#!/usr/bin/env node
/**
 * Copia o mirror 5etools (raiz do repo) para resources-staging/5etools-mirror
 * para electron-builder extraResources.
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const destRoot = path.join(desktopRoot, "resources-staging", "5etools-mirror");

const repoRoot =
	process.env.FIVETOOLS_ROOT != null && process.env.FIVETOOLS_ROOT !== ""
		? path.resolve(process.env.FIVETOOLS_ROOT)
		: path.resolve(desktopRoot, "../..");

/** Pastas na raiz que não entram no mirror do site. */
const SKIP_DIRS = new Set([
	".cursor",
	".git",
	"apps",
	"certs-dev-only",
	"coverage",
	"node",
	"node_modules",
	"release",
	"resources-staging",
	"scss",
	"test",
]);

function rmrf(p) {
	if (fs.existsSync(p)) fs.rmSync(p, {recursive: true, force: true});
}

function copyMirror() {
	if (!fs.existsSync(path.join(repoRoot, "adventure.html"))) {
		console.error(`[pack-mirror] Raiz inválida (sem adventure.html): ${repoRoot}`);
		process.exit(1);
	}

	rmrf(destRoot);
	fs.mkdirSync(destRoot, {recursive: true});

	for (const name of fs.readdirSync(repoRoot)) {
		if (SKIP_DIRS.has(name)) continue;
		const src = path.join(repoRoot, name);
		const dest = path.join(destRoot, name);
		const stat = fs.statSync(src);
		if (stat.isDirectory()) {
			fs.cpSync(src, dest, {recursive: true});
		} else {
			fs.copyFileSync(src, dest);
		}
	}

	console.log(`[pack-mirror] Origem: ${repoRoot}`);
	console.log(`[pack-mirror] Destino: ${destRoot}`);
}

copyMirror();
