import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type {DocumentRow} from "../shared/types.js";
import {getDbPath} from "./paths.js";

let db: Database.Database | null = null;

export function openDatabase(): Database.Database {
	if (db) return db;
	const dbPath = getDbPath();
	fs.mkdirSync(path.dirname(dbPath), {recursive: true});
	db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	db.pragma("synchronous = OFF");
	db.pragma("temp_store = MEMORY");
	db.pragma("cache_size = -64000");
	initSchema(db);
	return db;
}

function initSchema(database: Database.Database): void {
	database.exec(`
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
}

/** Sanitized prefix search; query must not contain SQL wildcards from user — we escape % and _. */
export function searchDocuments(rawQuery: string, limit = 100): DocumentRow[] {
	const database = openDatabase();
	const q = rawQuery.trim();
	if (!q) return [];
	const like = `%${escapeLike(q)}%`;
	const stmt = database.prepare(`
		SELECT path, source, type, name, body_json FROM documents
		WHERE path LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR body_json LIKE ? ESCAPE '\\'
		LIMIT ?
	`);
	return stmt.all(like, like, like, limit) as DocumentRow[];
}

function escapeLike(s: string): string {
	return s.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export function getDocumentByPath(filePath: string): DocumentRow | null {
	const database = openDatabase();
	const row = database.prepare(
		`SELECT path, source, type, name, body_json FROM documents WHERE path = ?`,
	).get(filePath) as DocumentRow | undefined;
	return row ?? null;
}

export function getDocumentCount(): number {
	const database = openDatabase();
	const row = database.prepare(`SELECT COUNT(*) AS c FROM documents`).get() as {c: number};
	return row.c;
}

/** Bulk insert (e.g. indexer). */
export function replaceAllDocuments(rows: DocumentRow[]): void {
	const database = openDatabase();
	const insert = database.prepare(`
		INSERT OR REPLACE INTO documents (path, source, type, name, body_json)
		VALUES (@path, @source, @type, @name, @body_json)
	`);
	const tx = database.transaction(() => {
		for (const r of rows) insert.run(r);
	});
	tx();
}

export function clearDocuments(): void {
	openDatabase().exec(`DELETE FROM documents`);
}

export {getDataDir} from "./paths.js";
