/**
 * One-shot: match Forgotten Adventures top-down tokens to 5etools bestiary names.
 * Run from repo root: node tools/generate-fa-token-map.mjs "C:/Users/brand/Downloads/FA_Tokens"
 * Copies nothing — writes data/hdq/fa-token-map.json with paths under img/hdq/fa-tokens/.
 * Copy FA_Tokens/Creatures and FA_Tokens/Adversaries into img/hdq/fa-tokens/ (same structure).
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "hdq", "fa-token-map.json");
const BESTIARY_DIR = path.join(ROOT, "data", "bestiary");

const SIZES = new Set(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]);

function normalizeName (s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[\u2019']/g, "")
		.replace(/\s*\([^)]*\)\s*$/u, "")
		.replace(/\s+/g, " ")
		.trim();
}

function faBasenameToKey (basename) {
	const base = basename.replace(/\.(png|webp|jpg|jpeg)$/i, "");
	const parts = base.split("_");
	const keyParts = [];
	for (const p of parts) {
		if (/^A\d+$/i.test(p)) break;
		if (SIZES.has(p)) break;
		if (/^Scale\d+$/i.test(p)) break;
		if (/^v\d+$/i.test(p)) break;
		if (p === "01" || p === "02") break;
		keyParts.push(p);
	}
	return keyParts.join(" ");
}

function scorePath (rel) {
	let s = 0;
	if (/\/[^/]*_A1_/i.test(rel)) s += 10;
	if (/\/Underwater/i.test(rel)) s -= 3;
	if (/\/Flying/i.test(rel)) s -= 2;
	if (/\/Swimming/i.test(rel)) s -= 2;
	if (/\/Mutate/i.test(rel)) s -= 1;
	return s;
}

function collectImages (dir, subRoots, outList) {
	for (const sub of subRoots) {
		const root = path.join(dir, sub);
		if (!fs.existsSync(root)) continue;
		const walk = d => {
			for (const ent of fs.readdirSync(d, {withFileTypes: true})) {
				const full = path.join(d, ent.name);
				if (ent.isDirectory()) walk(full);
				else if (/\.(png|webp|jpg|jpeg)$/i.test(ent.name)) outList.push(full);
			}
		};
		walk(root);
	}
}

function loadBestiaryNames () {
	const names = new Set();
	for (const ent of fs.readdirSync(BESTIARY_DIR, {withFileTypes: true})) {
		if (!ent.isFile() || !ent.name.startsWith("bestiary-") || !ent.name.endsWith(".json")) continue;
		const raw = JSON.parse(fs.readFileSync(path.join(BESTIARY_DIR, ent.name), "utf8"));
		const mons = raw.monster;
		if (!Array.isArray(mons)) continue;
		for (const m of mons) {
			if (m?.name) names.add(normalizeName(m.name));
		}
	}
	return names;
}

function main () {
	const faRoot = process.argv[2] || path.join(process.env.USERPROFILE || "", "Downloads", "FA_Tokens");
	if (!fs.existsSync(faRoot)) {
		console.error("FA_Tokens folder not found:", faRoot);
		process.exit(1);
	}

	const bestiary = loadBestiaryNames();
	const files = [];
	collectImages(faRoot, ["Creatures", "Adversaries"], files);

	/** @type {Map<string, {rel: string, score: number}>} */
	const bestByKey = new Map();

	for (const abs of files) {
		const base = path.basename(abs);
		const keyRaw = faBasenameToKey(base);
		if (!keyRaw) continue;
		const key = normalizeName(keyRaw);
		if (!key || !bestiary.has(key)) continue;

		const underRoot = abs.slice(faRoot.length).replace(/^[/\\]/, "").split(path.sep).join("/");
		const rel = `hdq/fa-tokens/${underRoot.replace(/\\/g, "/")}`;
		const sc = scorePath(rel);
		const prev = bestByKey.get(key);
		if (!prev || sc > prev.score) bestByKey.set(key, {rel, score: sc});
	}

	const flat = Object.fromEntries(
		[...bestByKey.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([k, v]) => [k, v.rel]),
	);
	fs.mkdirSync(path.dirname(OUT_JSON), {recursive: true});
	fs.writeFileSync(
		OUT_JSON,
		JSON.stringify({
			_meta: {
				generated: true,
				faPackHint: "Copy FA_Tokens/Creatures and FA_Tokens/Adversaries into img/hdq/fa-tokens/ (same folder layout).",
			},
			map: flat,
		}, null, "\t"),
	);
	console.log("Wrote", OUT_JSON, "entries:", Object.keys(flat).length);
}

main();
