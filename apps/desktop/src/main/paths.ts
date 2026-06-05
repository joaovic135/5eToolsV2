import path from "path";
import {fileURLToPath} from "url";
import {app} from "electron";

const MIRROR_DIR_NAME = "5etools-mirror";

/** Repo root: `FIVETOOLS_ROOT`, or four levels up from `out/main` / `dist-electron/main`, ou `cwd/../..`. */
export function getRepoRoot(): string {
	if (process.env.FIVETOOLS_ROOT) return path.resolve(process.env.FIVETOOLS_ROOT);
	try {
		const here = path.dirname(fileURLToPath(import.meta.url));
		const inBundledMain =
			here.includes(`${path.sep}out${path.sep}main`) ||
			here.includes(`${path.sep}dist-electron${path.sep}main`);
		if (inBundledMain) return path.resolve(here, "../../../..");
	} catch {/* ignore */}
	return path.resolve(process.cwd(), "../..");
}

/**
 * Raiz do mirror servido ao 5etools (contém `adventure.html`).
 * Empacotado: `resources/5etools-mirror`. Dev: raiz do repo.
 */
export function getMirrorRoot(): string {
	if (process.env.FIVETOOLS_ROOT) return path.resolve(process.env.FIVETOOLS_ROOT);
	if (app.isPackaged) {
		return path.join(process.resourcesPath, MIRROR_DIR_NAME);
	}
	return getRepoRoot();
}

export function getDataDir(): string {
	return path.join(getRepoRoot(), "data");
}

/** Pasta `apps/desktop` (pai de `dist-electron/main`). Alinha com `scripts/index-data.mjs`. */
export function getDesktopRoot(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..");
}

/** SQLite partilhado pela app e pelo CLI; substituir com `FIVETOOLS_DB` ou OS userData via env em builds empacotados. */
export function getDbPath(): string {
	if (process.env.FIVETOOLS_DB) return path.resolve(process.env.FIVETOOLS_DB);
	return path.join(getDesktopRoot(), "user-data", "5etoolsv2.db");
}
