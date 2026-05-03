/**
 * Match FREE_Creature_Tokens_* + FREE_Epic_Creatures_Tarrasque packs to 5etools bestiary names.
 * Run: node tools/generate-free-creature-token-map.mjs "C:/Users/brand/Pictures/Tokens"
 * Writes data/hdq/free-creature-token-map.json; paths under img/hdq/free-tokens/<packFolder>/...
 * Copy each discovered pack folder into img/hdq/free-tokens/ preserving structure.
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const OUT_JSON = path.join(ROOT, "data", "hdq", "free-creature-token-map.json");
const BESTIARY_DIR = path.join(ROOT, "data", "bestiary");

const FREE_PACK_RE = /^FREE_Creature_Tokens_\d+$/i;
const FREE_EPIC_DIR = "FREE_Epic_Creatures_Tarrasque";

const SIZES = new Set(["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"]);

function normalizeName (s) {
	return String(s || "")
		.toLowerCase()
		.replace(/[\u2019']/g, "")
		.replace(/\s*\([^)]*\)\s*$/u, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Same rules as FA pack (Forgotten Adventures filename convention). */
function basenameToCreatureKey (basename) {
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
	let key = keyParts.join(" ");
	if (!key) return "";
	return key;
}

/** Fallback keys if primary does not match bestiary (e.g. optional _01 strip). */
function basenameToKeyVariants (basename) {
	const keys = new Set();
	const primary = basenameToCreatureKey(basename);
	if (primary) keys.add(normalizeName(primary));

	const base = basename.replace(/\.(png|webp|jpg|jpeg)$/i, "");
	const noNum = base.replace(/_\d+$/u, "");
	if (noNum !== base) {
		const k2 = basenameToCreatureKey(noNum + ".png");
		if (k2) keys.add(normalizeName(k2));
	}
	return [...keys].filter(Boolean);
}

function scorePath (rel) {
	let s = 0;
	if (/_01\.(png|webp|jpe?g)$/i.test(rel)) s += 8;
	if (/\/[^/]*_A1_/i.test(rel)) s += 6;
	if (/Sleep/i.test(rel)) s -= 3;
	if (/Underwater|Flying|Swimming/i.test(rel)) s -= 2;
	s -= Math.min(rel.length / 250, 1.5);
	return s;
}

function discoverPackRoots (tokensRoot) {
	const roots = [];
	for (const ent of fs.readdirSync(tokensRoot, {withFileTypes: true})) {
		if (!ent.isDirectory()) continue;
		const n = ent.name;
		if (FREE_PACK_RE.test(n) || n.toLowerCase() === FREE_EPIC_DIR.toLowerCase()) {
			roots.push(path.join(tokensRoot, n));
		}
	}
	return roots.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, {numeric: true}));
}

function collectImagesUnder (rootDir, outList) {
	const walk = d => {
		for (const ent of fs.readdirSync(d, {withFileTypes: true})) {
			const full = path.join(d, ent.name);
			if (ent.isDirectory()) walk(full);
			else if (/\.(png|webp|jpg|jpeg)$/i.test(ent.name)) outList.push(full);
		}
	};
	walk(rootDir);
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
	const tokensRoot = process.argv[2] || path.join(process.env.USERPROFILE || "", "Pictures", "Tokens");
	if (!fs.existsSync(tokensRoot)) {
		console.error("Tokens root not found:", tokensRoot);
		process.exit(1);
	}

	const packRoots = discoverPackRoots(tokensRoot);
	if (!packRoots.length) {
		console.error("No FREE_Creature_Tokens_* or FREE_Epic_Creatures_Tarrasque under:", tokensRoot);
		process.exit(1);
	}

	const bestiary = loadBestiaryNames();
	/** @type {Map<string, {rel: string, score: number}>} */
	const bestByKey = new Map();

	for (const packRoot of packRoots) {
		const packBase = path.basename(packRoot);
		const files = [];
		collectImagesUnder(packRoot, files);

		for (const abs of files) {
			const base = path.basename(abs);
			const variants = basenameToKeyVariants(base);
			const relFromPack = path.relative(packRoot, abs).split(path.sep).join("/");
			const rel = `hdq/free-tokens/${packBase}/${relFromPack}`.replace(/\\/g, "/");
			const sc = scorePath(rel);

			for (const key of variants) {
				if (!key || !bestiary.has(key)) continue;
				const prev = bestByKey.get(key);
				if (!prev || sc > prev.score) bestByKey.set(key, {rel, score: sc});
				break;
			}
		}
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
				packsScanned: packRoots.map(p => path.basename(p)),
				hint: "Copy each pack folder (FREE_Creature_Tokens_* and FREE_Epic_Creatures_Tarrasque) into img/hdq/free-tokens/ with the same folder name.",
				mergeNote: "In the DMV, fa-token-map.json entries override the same creature key (Forgotten Adventures wins).",
			},
			map: flat,
		}, null, "\t"),
	);
	console.log("Packs:", packRoots.length, path.basename(packRoots[0]), "…", path.basename(packRoots[packRoots.length - 1]));
	console.log("Wrote", OUT_JSON, "entries:", Object.keys(flat).length);
}

main();
