/// <reference types="vite/client" />

type DocumentRow = {
	path: string;
	source: string | null;
	type: string | null;
	name: string | null;
	body_json: string;
};

export type DesktopApi = {
	search: (query: string, limit?: number) => Promise<DocumentRow[]>;
	getByPath: (filePath: string) => Promise<DocumentRow | null>;
	count: () => Promise<number>;
	windows: {
		openProjector: () => Promise<boolean>;
		closeProjector: () => Promise<boolean>;
	};
	pushProjector: (payload: unknown) => Promise<boolean>;
	onProjectorDisplay: (cb: (payload: unknown) => void) => () => void;
};

declare global {
	interface Window {
		desktopApi?: DesktopApi;
	}
}

export {};
