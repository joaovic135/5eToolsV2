#!/usr/bin/env node
/**
 * Copia imagem de detalhe (ex.: Downloads) para img/adventure/...
 * Uso: node node/add-player-map-copy.mjs --from "C:/Users/.../mapa.jpg" --dest "adventure/HotDQ/nomeDestino.jpg"
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs (argv) {
	const out = {from: null, dest: null};
	for (let i = 2; i < argv.length; i++) {
		if (argv[i] === "--from" && argv[i + 1]) {
			out.from = argv[++i];
		} else if (argv[i] === "--dest" && argv[i + 1]) {
			out.dest = argv[++i].replace(/^[/\\]+/, "");
		}
	}
	return out;
}

const {from, dest} = parseArgs(process.argv);

if (!from || !dest) {
	console.error(`Usage: node node/add-player-map-copy.mjs --from "<absolute path to source image>" --dest "adventure/<Source>/<filename>.<ext>"`);
	process.exit(1);
}

const srcAbs = path.resolve(from);
const destUnderImg = dest.replace(/^img[/\\]/i, "");
const destAbs = path.join(repoRoot, "img", ...destUnderImg.split(/[/\\]/));

if (!fs.existsSync(srcAbs)) {
	console.error(`Source not found: ${srcAbs}`);
	process.exit(1);
}

fs.mkdirSync(path.dirname(destAbs), {recursive: true});
fs.copyFileSync(srcAbs, destAbs);
console.log(`Copied:\n  ${srcAbs}\n→ ${destAbs}`);
