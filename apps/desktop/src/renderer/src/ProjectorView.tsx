import {useEffect, useState} from "react";

export function ProjectorView(): React.ReactElement {
	const api = window.desktopApi;
	const [payload, setPayload] = useState<unknown>(null);

	useEffect(() => {
		if (!api) return;
		const off = api.onProjectorDisplay((p) => setPayload(p));
		return off;
	}, [api]);

	const title =
		payload &&
		typeof payload === "object" &&
		payload !== null &&
		"title" in payload &&
		typeof (payload as {title?: unknown}).title === "string"
			? (payload as {title: string}).title
			: "Projeção";

	return (
		<div className="flex h-screen w-screen flex-col items-center justify-center bg-black text-white">
			<h1 className="text-4xl font-semibold tracking-tight md:text-6xl">{title}</h1>
			<p className="mt-4 max-w-prose text-center text-lg text-slate-400">
				Janela de projeção — sem barras nem scroll. Estado recebido da janela mestre.
			</p>
			<pre className="mt-8 max-h-[40vh] max-w-[90vw] overflow-auto rounded-lg bg-slate-900 p-4 text-left text-xs text-slate-300">
				{payload != null ? JSON.stringify(payload, null, 2) : "{}"}
			</pre>
		</div>
	);
}
