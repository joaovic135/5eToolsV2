#!/usr/bin/env node
/**
 * Indexa todos os JSON sob data/ do repositório 5etools para SQLite (documents).
 * Variáveis: FIVETOOLS_ROOT (raiz do repo), FIVETOOLS_DB (ficheiro SQLite).
 */
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const repoRoot =
	process.env.FIVETOOLS_ROOT != null && process.env.FIVETOOLS_ROOT !== ""
		? path.resolve(process.env.FIVETOOLS_ROOT)
		: path.resolve(desktopRoot, "../..");
const dataDir = path.join(repoRoot, "data");
const dbPath =
	process.env.FIVETOOLS_DB != null && process.env.FIVETOOLS_DB !== ""
		? path.resolve(process.env.FIVETOOLS_DB)
		: path.join(desktopRoot, "user-data/5etoolsv2.db");

function walkJson(dir) {
	const out = [];
	if (!fs.existsSync(dir)) {
		console.warn(`[index-data] Pasta data não encontrada: ${dir}`);
		return out;
	}
	for (const ent of fs.readdirSync(dir, {withFileTypes: true})) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) out.push(...walkJson(p));
		else if (ent.isFile() && ent.name.endsWith(".json")) out.push(p);
	}
	return out;
}

function inferMeta(relPath, parsed) {
	const parts = relPath.split(path.sep).filter(Boolean);
	const type = parts[0] ?? null;
	let name = null;
	let source = null;
	if (parsed && typeof parsed === "object") {
		if ("name" in parsed && typeof parsed.name === "string") name = parsed.name;
		if ("source" in parsed && typeof parsed.source === "string") source = parsed.source;
		if (!source && "_meta" in parsed && parsed._meta && typeof parsed._meta === "object") {
			const m = parsed._meta;
			if ("source" in m && typeof m.source === "string") source = m.source;
		}
	}
	return {type, name, source};
}

fs.mkdirSync(path.dirname(dbPath), {recursive: true});
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = OFF");
db.pragma("temp_store = MEMORY");
db.pragma("cache_size = -64000");

db.exec(`
	CREATE TABLE IF NOT EXISTS documents (
		path TEXT PRIMARY KEY,
		source TEXT,
		type TEXT,
		name TEXT,
		body_json TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source);
	CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
`);

const insert = db.prepare(`
	INSERT OR REPLACE INTO documents (path, source, type, name, body_json)
	VALUES (@path, @source, @type, @name, @body_json)
`);

const files = walkJson(dataDir);
let n = 0;
const tx = db.transaction(() => {
	for (const abs of files) {
		const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
		let raw;
		try {
			raw = fs.readFileSync(abs, "utf8");
		} catch {
			continue;
		}
		let parsed = null;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = null;
		}
		const meta = inferMeta(path.relative(dataDir, abs), parsed);
		insert.run({
			path: rel,
			source: meta.source,
			type: meta.type,
			name: meta.name,
			body_json: raw,
		});
		n++;
	}
});
tx();

console.log(`[index-data] Repo: ${repoRoot}`);
console.log(`[index-data] DB:   ${dbPath}`);
console.log(`[index-data] Linhas: ${n} ficheiros JSON`);
db.close();
