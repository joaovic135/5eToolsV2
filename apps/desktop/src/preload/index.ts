import {contextBridge, ipcRenderer} from "electron";
import type {DocumentRow} from "../shared/types.js";

export type {DocumentRow};

contextBridge.exposeInMainWorld("desktopApi", {
	search: (query: string, limit?: number) =>
		ipcRenderer.invoke("db:search", query, limit) as Promise<DocumentRow[]>,
	getByPath: (filePath: string) =>
		ipcRenderer.invoke("db:getByPath", filePath) as Promise<DocumentRow | null>,
	count: () => ipcRenderer.invoke("db:count") as Promise<number>,
	windows: {
		openProjector: () => ipcRenderer.invoke("windows:openProjector") as Promise<boolean>,
		closeProjector: () => ipcRenderer.invoke("windows:closeProjector") as Promise<boolean>,
	},
	pushProjector: (payload: unknown) =>
		ipcRenderer.invoke("projector:push", payload) as Promise<boolean>,
	onProjectorDisplay: (cb: (payload: unknown) => void) => {
		const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => cb(payload);
		ipcRenderer.on("projector:display", handler);
		return () => ipcRenderer.removeListener("projector:display", handler);
	},
});
