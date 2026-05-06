/**
 * Scans img/hdq/fa-assets/ (or CLI dir) and writes data/hdq/dmv-asset-manifest.json for the DMV asset picker.
 *
 * From repo root:
 *   node tools/generate-dmv-asset-manifest.mjs
 *   node tools/generate-dmv-asset-manifest.mjs "C:/path/to/other/img/root"   # optional: absolute path whose files map under img/hdq/fa-assets/
 *
 * Copy FA_Assets (or any pack) into img/hdq/fa-assets/ first — see img/hdq/fa-assets/README.txt
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "hdq", "dmv-asset-manifest.json");
const DEFAULT_SCAN = path.join(ROOT, "img", "hdq", "fa-assets");

const IMG_EXT = /\.(png|webp|jpg|jpeg|gif)$/i;

function slugId (rel) {
	const h = crypto.createHash("sha1").update(rel).digest("hex").slice(0, 12);
	return `a_${h}`;
}

function walkImages (dir, out, relPrefix) {
	if (!fs.existsSync(dir)) return;
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) walkImages(full, out, relPrefix);
		else if (ent.isFile() && IMG_EXT.test(ent.name)) {
			const under = path.relative(relPrefix, full).split(path.sep).join("/");
			const rel = `hdq/fa-assets/${under}`.replace(/\/+/g, "/");
			const name = path.basename(ent.name).replace(IMG_EXT, "").replace(/[_]+/g, " ").trim() || ent.name;
			out.push({rel, name, under});
		}
	}
}

function main () {
	const arg = process.argv[2];
	const scanRoot = arg ? path.resolve(arg) : DEFAULT_SCAN;
	const relPrefix = scanRoot;

	if (!fs.existsSync(scanRoot)) {
		console.warn("Scan folder missing (will write empty assets):", scanRoot);
		fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
		fs.writeFileSync(
			OUT_JSON,
			JSON.stringify({
				_meta: {
					generated: new Date().toISOString(),
					scanRoot: path.relative(ROOT, scanRoot).split(path.sep).join("/") || ".",
					hint: "Copy images into img/hdq/fa-assets/ then re-run this script.",
				},
				assets: [],
			}, null, "\t"),
		);
		console.log("Wrote", OUT_JSON, "assets: 0");
		return;
	}

	const raw = [];
	walkImages(scanRoot, raw, relPrefix);

	const seen = new Set();
	const assets = [];
	for (const {rel, name, under} of raw.sort((a, b) => a.rel.localeCompare(b.rel))) {
		if (seen.has(rel)) continue;
		seen.add(rel);
		assets.push({
			id: slugId(rel),
			rel,
			name: `${name} (${under})`,
		});
	}

	fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
	fs.writeFileSync(
		OUT_JSON,
		JSON.stringify({
			_meta: {
				generated: new Date().toISOString(),
				scanRoot: path.relative(ROOT, scanRoot).split(path.sep).join("/") || ".",
				count: assets.length,
			},
			assets,
		}, null, "\t"),
	);
	console.log("Wrote", OUT_JSON, "assets:", assets.length);
}

main();
