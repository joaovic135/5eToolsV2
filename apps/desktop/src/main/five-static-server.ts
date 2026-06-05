import type {Server} from "http";
import http from "http";
import path from "path";
import finalhandler from "finalhandler";
import serveStatic from "serve-static";

export type StaticServerHandle = {
	/** e.g. http://127.0.0.1:PORT */
	baseUrl: string;
	port: number;
	close: () => Promise<void>;
};

/** Porta estável por defeito para o mesmo `localStorage` entre arranques (origem = host+porta). */
const DEFAULT_STATIC_PORT = 45281;

function resolvePreferredPort (): number {
	const fromEnv = Number(process.env.FIVETOOLS_STATIC_PORT);
	if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
	return DEFAULT_STATIC_PORT;
}

/**
 * Serve arquivos estáticos do mirror 5etools em 127.0.0.1 (paridade com http-server).
 * Usa porta **fixa** por defeito para `localStorage` (ex. tokens do DMV) persistir ao reiniciar a app.
 */
export function startFiveStaticServer (root: string): Promise<StaticServerHandle> {
	const serve = serveStatic(path.resolve(root), {
		index: false,
		redirect: false,
		dotfiles: "ignore",
	});

	const preferredPort = resolvePreferredPort();

	const tryListen = (port: number): Promise<StaticServerHandle> =>
		new Promise((resolve, reject) => {
			const server: Server = http.createServer((req, res) => {
				const done = finalhandler(req, res, {
					onerror: (err) => {
						console.error("[five-static-server]", err);
					},
				});
				serve(req, res, done);
			});

			const onError = (err: NodeJS.ErrnoException) => {
				server.off("error", onError);
				reject(err);
			};
			server.once("error", onError);

			server.listen(port, "127.0.0.1", () => {
				server.off("error", onError);
				const addr = server.address();
				const actualPort = typeof addr === "object" && addr && "port" in addr ? addr.port : 0;
				if (!actualPort) {
					reject(new Error("Static server: porta inválida"));
					return;
				}
				const baseUrl = `http://127.0.0.1:${actualPort}`;
				resolve({
					baseUrl,
					port: actualPort,
					close: () =>
						new Promise((res, rej) => {
							server.close((err) => (err ? rej(err) : res()));
						}),
				});
			});
		});

	return tryListen(preferredPort).catch((err: NodeJS.ErrnoException) => {
		if (err?.code === "EADDRINUSE" && preferredPort !== 0) {
			// eslint-disable-next-line no-console
			console.warn(
				`[five-static-server] Porta ${preferredPort} em uso; a usar porta atribuída pelo SO. ` +
					"O localStorage (tokens/assets do DMV) pode não persistir entre arranques — " +
					`liberte a porta, ou defina FIVETOOLS_STATIC_PORT para outra porta livre.`,
			);
			return tryListen(0);
		}
		throw err;
	});
}
