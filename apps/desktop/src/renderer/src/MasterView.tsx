import {useCallback, useEffect, useState} from "react";
import type {DocumentRow} from "./App.js";

export function MasterView(): React.ReactElement {
	const api = window.desktopApi;
	const [q, setQ] = useState("");
	const [rows, setRows] = useState<DocumentRow[]>([]);
	const [count, setCount] = useState<number | null>(null);
	const [busy, setBusy] = useState(false);
	const [searched, setSearched] = useState(false);

	const refreshCount = useCallback(async () => {
		if (!api) return;
		setCount(await api.count());
	}, [api]);

	useEffect(() => {
		void refreshCount();
	}, [refreshCount]);

	const runSearch = useCallback(async () => {
		if (!api) return;
		setBusy(true);
		try {
			setRows(await api.search(q, 80));
			setSearched(true);
		} finally {
			setBusy(false);
		}
	}, [api, q]);

	const openProjector = useCallback(async () => {
		await api?.windows.openProjector();
		await api?.pushProjector({title: "Mesa", note: "Conteúdo de exemplo"});
	}, [api]);

	if (!api) {
		return (
			<div className="p-6">
				<p className="text-amber-400">API Electron não disponível (abrir na app desktop).</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight text-white">5eToolsV2</h1>
					<p className="text-sm text-slate-400">
						Documentos indexados: {count ?? "…"}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
						onClick={() => void openProjector()}
					>
						Projeção (2.º ecrã)
					</button>
					<button
						type="button"
						className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
						onClick={() => void api.windows.closeProjector()}
					>
						Fechar projeção
					</button>
				</div>
			</header>

			<div className="flex gap-2">
				<input
					className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none ring-indigo-500 focus:ring-2"
					placeholder="Pesquisar em path, nome e JSON…"
					value={q}
					onChange={(e) => setQ(e.target.value)}
					onKeyDown={(e) => e.key === "Enter" && void runSearch()}
				/>
				<button
					type="button"
					disabled={busy}
					className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
					onClick={() => void runSearch()}
				>
					{busy ? "…" : "Pesquisar"}
				</button>
			</div>

			<ul className="divide-y divide-slate-800 rounded-lg border border-slate-800">
				{rows.length === 0 && searched && (
					<li className="px-4 py-8 text-center text-sm text-slate-500">
						Sem resultados. Corra <code className="text-slate-400">npm run index:data</code> em{" "}
						<code className="text-slate-400">apps/desktop</code> se a base estiver vazia.
					</li>
				)}
				{rows.length === 0 && !searched && (
					<li className="px-4 py-8 text-center text-sm text-slate-600">
						Escreva um termo e pesquise (path, nome ou conteúdo JSON).
					</li>
				)}
				{rows.map((r) => (
					<li key={r.path} className="px-4 py-3">
						<div className="font-mono text-xs text-indigo-300">{r.path}</div>
						{r.name && <div className="text-sm text-white">{r.name}</div>}
						{r.type && (
							<div className="text-xs text-slate-500">
								{r.type}
								{r.source ? ` · ${r.source}` : ""}
							</div>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}
