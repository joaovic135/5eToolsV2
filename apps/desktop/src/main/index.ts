import fs from "fs";
import path from "path";
import {pathToFileURL} from "url";
import {BrowserWindow, app, ipcMain, screen} from "electron";
import {
	getDocumentByPath,
	getDocumentCount,
	openDatabase,
	searchDocuments,
} from "./db.js";
import {startFiveStaticServer} from "./five-static-server.js";
import {getMirrorRoot} from "./paths.js";

function applyGpuSwitches(): void {
	app.commandLine.appendSwitch("enable-gpu-rasterization");
	if (process.platform === "win32") {
		app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization");
	}
}

applyGpuSwitches();

function legacyWebPreferences(): Electron.WebPreferences {
	return {
		contextIsolation: true,
		nodeIntegration: false,
		sandbox: false,
	};
}

/** Must match `RenderMap.DMV_PROJECTOR_WINDOW_NAME` in `js/render-map.js` (window.open target name). */
const DMV_PROJECTOR_FRAME_NAME = "fivetoolsProjector";

function attachWindowOpenHandler(wc: Electron.WebContents): void {
	wc.setWindowOpenHandler((details) => {
		if (details.frameName === DMV_PROJECTOR_FRAME_NAME) {
			// Tamanho inicial modesto: o renderer redimensiona ao viewport do mapa (`resizeTo`) para evitar letterboxing.
			const display = getSecondaryDisplay();
			const bounds = display?.bounds ?? screen.getPrimaryDisplay().bounds;
			const initW = Math.min(1024, Math.max(480, bounds.width - 80));
			const initH = Math.min(768, Math.max(360, bounds.height - 80));
			return {
				action: "allow",
				overrideBrowserWindowOptions: {
					x: bounds.x + Math.max(0, Math.floor((bounds.width - initW) / 2)),
					y: bounds.y + Math.max(0, Math.floor((bounds.height - initH) / 2)),
					width: initW,
					height: initH,
					fullscreen: false,
					frame: false,
					autoHideMenuBar: true,
					webPreferences: legacyWebPreferences(),
				},
			};
		}
		return {
			action: "allow",
			overrideBrowserWindowOptions: {
				webPreferences: legacyWebPreferences(),
			},
		};
	});
}

function getPreloadPath(): string {
	const dir = path.join(__dirname, "../preload");
	for (const name of ["index.js", "index.mjs", "index.cjs"] as const) {
		const p = path.join(dir, name);
		if (fs.existsSync(p)) return p;
	}
	return path.join(dir, "index.js");
}

function getLegacyStartUrl(port: number): string {
	if (process.env.FIVETOOLS_START_URL) return process.env.FIVETOOLS_START_URL;
	const startPath = process.env.FIVETOOLS_START_PATH ?? "/adventure.html";
	let hash = process.env.FIVETOOLS_START_HASH ?? "hotdq,1";
	if (!hash.startsWith("#")) hash = `#${hash}`;
	const pathPart = startPath.startsWith("/") ? startPath : `/${startPath}`;
	return `http://127.0.0.1:${port}${pathPart}${hash}`;
}

let mainWindow: BrowserWindow | null = null;
let projectorWindow: BrowserWindow | null = null;
let staticHandle: Awaited<ReturnType<typeof startFiveStaticServer>> | null = null;

function createLegacyWindow(startUrl: string): BrowserWindow {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		webPreferences: legacyWebPreferences(),
		show: false,
	});
	void win.loadURL(startUrl);
	win.once("ready-to-show", () => win.show());
	return win;
}

function createReactShellWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 900,
		height: 700,
		webPreferences: {
			preload: getPreloadPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (!app.isPackaged && rendererUrl) {
		void win.loadURL(`${rendererUrl.replace(/\/$/, "")}#/`);
	} else {
		const indexHtml = path.join(__dirname, "../renderer/index.html");
		void win.loadURL(pathToFileURL(indexHtml).href + "#/");
	}
	return win;
}

function getSecondaryDisplay(): Electron.Display | null {
	const displays = screen.getAllDisplays();
	const primary = screen.getPrimaryDisplay();
	const other = displays.find((d) => d.id !== primary.id);
	return other ?? null;
}

function createProjectorWindow(): BrowserWindow | null {
	const display = getSecondaryDisplay();
	const bounds = display?.bounds ?? screen.getPrimaryDisplay().bounds;
	const win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		fullscreen: display != null,
		autoHideMenuBar: true,
		show: true,
		webPreferences: {
			preload: getPreloadPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});
	win.setMenuBarVisibility(false);
	if (display) {
		win.setBounds(bounds);
		win.setFullScreen(true);
	} else {
		win.maximize();
	}
	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (!app.isPackaged && rendererUrl) {
		void win.loadURL(`${rendererUrl.replace(/\/$/, "")}#/projector`);
	} else {
		const indexHtml = path.join(__dirname, "../renderer/index.html");
		void win.loadURL(pathToFileURL(indexHtml).href + "#/projector");
	}
	win.webContents.on("did-finish-load", () => {
		void win.webContents.insertCSS(`
			html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100% !important; height: 100% !important; }
			#root { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; }
		`);
	});
	return win;
}

function registerIpc(): void {
	ipcMain.handle("db:search", (_evt, query: string, limit?: number) => {
		return searchDocuments(String(query ?? ""), typeof limit === "number" ? limit : 100);
	});
	ipcMain.handle("db:getByPath", (_evt, filePath: string) => {
		return getDocumentByPath(String(filePath ?? ""));
	});
	ipcMain.handle("db:count", () => getDocumentCount());
	ipcMain.handle("windows:openProjector", () => {
		if (!projectorWindow || projectorWindow.isDestroyed()) {
			projectorWindow = createProjectorWindow();
			projectorWindow.on("closed", () => {
				projectorWindow = null;
			});
		} else {
			projectorWindow.focus();
		}
		return true;
	});
	ipcMain.handle("windows:closeProjector", () => {
		if (projectorWindow && !projectorWindow.isDestroyed()) {
			projectorWindow.close();
			projectorWindow = null;
		}
		return true;
	});
	ipcMain.handle("projector:push", (_evt, payload: unknown) => {
		if (projectorWindow && !projectorWindow.isDestroyed()) {
			projectorWindow.webContents.send("projector:display", payload);
		}
		return true;
	});
}

app.on("browser-window-created", (_e, window) => {
	attachWindowOpenHandler(window.webContents);
});

app.whenReady().then(async () => {
	const mirrorRoot = getMirrorRoot();
	const adventurePath = path.join(mirrorRoot, "adventure.html");
	if (!fs.existsSync(adventurePath)) {
		// eslint-disable-next-line no-console
		console.error(
			`[5etoolsv3] Mirror inválido: não encontrado ${adventurePath}. ` +
				`Defina FIVETOOLS_ROOT para a raiz do repo ou rode npm run pack:mirror antes de electron-builder.`,
		);
		app.quit();
		return;
	}

	openDatabase();
	registerIpc();

	try {
		staticHandle = await startFiveStaticServer(mirrorRoot);
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error("[5etoolsv3] Falha ao subir servidor estático:", err);
		app.quit();
		return;
	}

	const startUrl = getLegacyStartUrl(staticHandle.port);
	mainWindow = createLegacyWindow(startUrl);
	mainWindow.on("closed", () => {
		mainWindow = null;
	});

	if (process.env.FIVETOOLS_OPEN_REACT_SHELL === "1") {
		createReactShellWindow();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0 && staticHandle) {
		mainWindow = createLegacyWindow(getLegacyStartUrl(staticHandle.port));
		mainWindow.on("closed", () => {
			mainWindow = null;
		});
	}
});

app.on("before-quit", () => {
	void staticHandle?.close();
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
