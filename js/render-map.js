import {OmnisearchBacking} from "./omnisearch/omnisearch-backing.js";

export class RenderMap {
	static _ZOOM_ADJUSTMENT_FACTOR = 1.5;

	/** Ctrl+scroll: exponential zoom per wheel delta pixel (~10% per typical mouse notch). */
	static _ZOOM_WHEEL_SENSITIVITY = 0.0018;

	// See:
	//  - https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
	//  - https://jhildenbiddle.github.io/canvas-size/#/?id=test-results
	static _MAX_CANVAS_AREA = Math.pow(2, 14) * Math.pow(2, 14);
	// Arbitrary
	static _MIN_CANVAS_AREA = Math.pow(2, 8) * Math.pow(2, 8);

	static _AREA_CACHE = {};

	/** Same cap as InitiativeTrackerMonsterAdd; uses DM Screen creature Lunr index (not global omnisearch pGetResults). */
	static _DMV_CREATURE_RESULTS_MAX = 75;

	static _pCachedSearchContentIndices = null;

	/**
	 * Window that owns the full 5etools stack (SearchUiUtil, elasticlunr, DataLoader, …).
	 * DMV opened as a browser popout only loads parser+utils — use opener there.
	 */
	/**
	 * @param {Window} modalHostWindow Document where the DMV UI lives (popout or book page).
	 */
	static _getDmvHostAppWindowForSearch (modalHostWindow) {
		const start = modalHostWindow || globalThis;
		let cur = start;
		const visited = new Set();
		for (let depth = 0; depth < 16 && cur && !visited.has(cur); depth++) {
			visited.add(cur);
			try {
				if (cur.SearchUiUtil) return cur;
			} catch { /* cross-origin */ }
			const op = cur.opener;
			if (op && !op.closed && !visited.has(op)) cur = op;
			else break;
		}
		try {
			const t = start.top;
			if (t && t !== start && !visited.has(t) && t.SearchUiUtil) return t;
		} catch { /* cross-origin */ }
		// DMV UI is always built from the page that loaded render-map (e.g. adventure.html); listeners run in that
		// realm even after nodes move to a popout. Opener chains can be empty (COOP, some browsers) — use that window.
		try {
			if (globalThis.SearchUiUtil) return globalThis;
		} catch { /* */ }
		return start;
	}

	/**
	 * Per-category search indices (incl. Creature), same as SearchUiUtil.pGetContentIndices / dmscreen.
	 * @param {Window} [appWindow] Book / dmscreen window with SearchUiUtil (opener when DMV is in a popout).
	 */
	static _pGetDmvSearchContentIndices (appWindow = globalThis) {
		const su = appWindow.SearchUiUtil;
		if (!su) return Promise.reject(new Error("SearchUiUtil not loaded"));
		if (this._pCachedSearchContentIndices) return this._pCachedSearchContentIndices;
		const p = su.pGetContentIndices();
		this._pCachedSearchContentIndices = p.catch(err => {
			this._pCachedSearchContentIndices = null;
			throw err;
		});
		return this._pCachedSearchContentIndices;
	}

	/**
	 * DMV token picker: when the same name exists in MM (2014) and XMM (2025), drop the XMM row.
	 * Expansion-only creatures (VGM, MTF, etc.) are unchanged.
	 */
	static _dmvDedupeXmmWhenMm2014Present (results) {
		if (!results?.length) return results;

		const namesWithMm = new Set();
		for (const res of results) {
			if (res.doc?.s === Parser.SRC_MM && res.doc?.n) namesWithMm.add(res.doc.n.toLowerCase());
		}
		if (!namesWithMm.size) return results;

		return results.filter(res => {
			if (res.doc?.s !== Parser.SRC_XMM) return true;
			const n = res.doc?.n?.toLowerCase();
			return !n || !namesWithMm.has(n);
		});
	}

	// HotDQ ch.1 — player map references mapParent id "219". Polygons in DM/parent image space 4050×3000.
	static _HOTDQ_GREENEST_PARENT_W = 4050;
	static _HOTDQ_GREENEST_PARENT_H = 3000;
	static _HOTDQ_GREENEST_MAP_REGIONS_PARENT = Object.freeze([
		{
			area: "070",
			points: [[2126, 1732], [2092, 1631], [2132, 1498], [2262, 1505], [2268, 1585], [2206, 1609], [2185, 1671], [2206, 1711]],
		},
		{
			area: "074",
			points: [[2437, 2102], [2468, 1975], [2542, 1892], [2615, 1862], [2714, 1852], [2711, 1745], [2646, 1649], [2520, 1702], [2400, 1778], [2335, 1862], [2311, 1997], [2323, 2102]],
		},
		{
			area: "07c",
			points: [[3317, 2203], [3308, 2028], [3332, 1874], [3600, 1865], [3683, 1929], [3868, 2108], [3840, 2209], [3674, 2314], [3477, 2280]],
		},
		{
			area: "07f",
			points: [[178, 2145], [215, 2055], [329, 2077], [425, 2068], [529, 2129], [548, 2237], [486, 2302], [323, 2298], [197, 2237]],
		},
		// Player-only POI: market — rosa ref (~280,420); match (1255,1948); +50%↑y +30%→x; +10% gap_y↑ +10%|Δx|→; +15%|Δx|→ (centre ~1792,1031)
		{
			area: "071",
			points: [[1922, 1031], [1884, 1123], [1792, 1161], [1700, 1123], [1662, 1031], [1700, 939], [1792, 901], [1884, 939]],
		},
		// Player-only POI #6: street — template+40%|Δx|→ then +20% gap_y↑ (gap_y=1948-420); centre ~1645,1642, r=130
		{
			area: "072",
			points: [[1775, 1642], [1737, 1734], [1645, 1772], [1553, 1734], [1515, 1642], [1553, 1550], [1645, 1512], [1737, 1550]],
		},
	]);

	/* -------------------------------------------- */

	static getHotdqGreenestPlayerMapData (entry, href) {
		return {
			regions: this._scaleHotdqGreenestRegionsToPlayer(entry.width, entry.height),
			width: entry.width,
			height: entry.height,
			href,
			...(entry.grid ? {grid: entry.grid} : {}),
		};
	}

	static _scaleHotdqGreenestRegionsToPlayer (width, height) {
		const sx = width / this._HOTDQ_GREENEST_PARENT_W;
		const sy = height / this._HOTDQ_GREENEST_PARENT_H;
		return this._HOTDQ_GREENEST_MAP_REGIONS_PARENT.map(r => ({
			area: r.area,
			points: r.points.map(([x, y]) => [Math.round(x * sx), Math.round(y * sy)]),
		}));
	}

	// HotDQ ch.2 — player map references mapParent id "276". Polygons in DM/parent image space 4050×3000.
	static _HOTDQ_RAIDER_CAMP_PARENT_W = 4050;
	static _HOTDQ_RAIDER_CAMP_PARENT_H = 3000;
	static _HOTDQ_RAIDER_CAMP_MAP_REGIONS_PARENT = Object.freeze([
		{
			area: "09e",
			points: [[2951, 1822], [3148, 1843], [3317, 1812], [3394, 1680], [3338, 1511], [3169, 1388], [2954, 1372], [2865, 1465], [2840, 1603], [2825, 1754]],
		},
		{
			area: "09c",
			points: [[1692, 2022], [1846, 1942], [2052, 1914], [2262, 1948], [2280, 2083], [2255, 2249], [2200, 2412], [2111, 2560], [1945, 2634], [1742, 2545], [1689, 2378], [1671, 2206]],
		},
		{
			area: "0a2",
			points: [[2338, 2582], [2391, 2314], [2462, 2169], [2637, 2080], [2871, 2046], [3126, 2065], [3277, 2169], [3422, 2280], [3262, 2434], [3065, 2535], [2834, 2585], [2609, 2708]],
		},
		{
			area: "0a1",
			points: [[3489, 2126], [3406, 2080], [3443, 1738], [3625, 1646], [3726, 1772], [3745, 2043], [3618, 2169]],
		},
	]);

	static getHotdqRaiderCampPlayerMapData (entry, href) {
		return {
			regions: this._scaleHotdqRaiderCampRegionsToPlayer(entry.width, entry.height),
			width: entry.width,
			height: entry.height,
			href,
			...(entry.grid ? {grid: entry.grid} : {}),
		};
	}

	static _scaleHotdqRaiderCampRegionsToPlayer (width, height) {
		const sx = width / this._HOTDQ_RAIDER_CAMP_PARENT_W;
		const sy = height / this._HOTDQ_RAIDER_CAMP_PARENT_H;
		return this._HOTDQ_RAIDER_CAMP_MAP_REGIONS_PARENT.map(r => ({
			area: r.area,
			points: r.points.map(([x, y]) => [Math.round(x * sx), Math.round(y * sy)]),
		}));
	}

	// JttRC — Kianna's Farmhouse map 3.1 (DM id "53c", player mapParent "53c"). Image space 753×1024.
	static _JTTRC_KIANNAS_FARMHOUSE_PARENT_W = 753;
	static _JTTRC_KIANNAS_FARMHOUSE_PARENT_H = 1024;
	static _JTTRC_KIANNAS_FARMHOUSE_MAP_REGIONS_PARENT = Object.freeze([
		{area: "0c0", points: [[111, 7], [111, 103], [518, 103], [518, 7]]},
		{area: "0c3", points: [[100, 555], [509, 555], [509, 156], [614, 156], [614, 478], [614, 616], [100, 616]]},
		{area: "0c6", points: [[481, 479], [165, 479], [165, 192], [231, 192], [231, 131], [103, 131], [103, 543], [481, 543]]},
		{area: "0c8", points: [[173, 341], [173, 468], [306, 468], [306, 341]]},
		{area: "0ca", points: [[378, 468], [378, 338], [412, 338], [412, 271], [476, 271], [476, 468]]},
		{area: "0cd", points: [[345, 136], [345, 266], [476, 266], [476, 136]]},
		{area: "0cf", points: [[242, 137], [242, 266], [341, 266], [341, 137]]},
		{area: "0d2", points: [[65, 713], [65, 820], [204, 820], [204, 713]]},
		{
			area: "0d4",
			points: [[281, 837], [272, 825], [269, 800], [277, 788], [284, 776], [310, 774], [313, 766], [310, 748], [322, 742], [327, 736], [344, 735], [350, 729], [362, 725], [390, 731], [402, 725], [406, 706], [415, 703], [429, 690], [443, 681], [458, 678], [480, 682], [492, 690], [508, 695], [521, 699], [513, 709], [520, 720], [525, 726], [526, 734], [544, 744], [557, 744], [567, 738], [575, 740], [592, 743], [605, 753], [604, 764], [617, 779], [630, 792], [630, 801], [634, 816], [637, 842], [624, 848], [616, 847], [606, 853], [588, 850], [579, 836], [572, 826], [562, 819], [549, 816], [532, 816], [526, 818], [515, 828], [510, 839], [502, 849], [496, 862], [484, 865], [468, 861], [451, 865], [445, 886], [427, 893], [410, 893], [390, 888], [373, 878], [356, 862], [354, 849], [354, 830], [350, 816], [330, 810], [321, 815], [313, 818], [308, 838], [320, 852], [326, 864], [323, 878], [320, 888], [305, 889]],
		},
	]);

	static getJttrcKiannasFarmhouseMapData (entry, href) {
		return {
			regions: this._scaleJttrcKiannasFarmhouseRegionsToPlayer(entry.width, entry.height),
			width: entry.width,
			height: entry.height,
			href,
			...(entry.grid ? {grid: entry.grid} : {}),
		};
	}

	static _scaleJttrcKiannasFarmhouseRegionsToPlayer (width, height) {
		const sx = width / this._JTTRC_KIANNAS_FARMHOUSE_PARENT_W;
		const sy = height / this._JTTRC_KIANNAS_FARMHOUSE_PARENT_H;
		return this._JTTRC_KIANNAS_FARMHOUSE_MAP_REGIONS_PARENT.map(r => ({
			area: r.area,
			points: r.points.map(([x, y]) => [Math.round(x * sx), Math.round(y * sy)]),
		}));
	}

	static _fnGetPopoutSizeProjector () {
		return {
			width: window.screen?.availWidth ?? window.innerWidth,
			height: window.screen?.availHeight ?? window.innerHeight,
		};
	}

	/** Nome da janela `window.open` para o espelho do projector (Electron posiciona no 2.º ecrã). */
	static DMV_PROJECTOR_WINDOW_NAME = "fivetoolsProjector";

	static _DMV_BC_PREFIX = "fivetools-dmv-sync-v1-";

	/**
	 * Abre um DMV escravo (só leitura) sincronizado com este mapa via BroadcastChannel.
	 * @param {MouseEvent} evt
	 * @param {{mapData: object, masterWrpCvs: HTMLElement, contentOpts: object}} args
	 */
	static async _pOpenDmvProjectorMirror (evt, {mapData, masterWrpCvs, contentOpts, btnProjetar = null}) {
		const channelId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).toString();
		const bc = new BroadcastChannel(`${this._DMV_BC_PREFIX}${channelId}`);
		if (mapData._dmvProjectorBc) {
			try { mapData._dmvProjectorBc.close(); } catch { /* empty */ }
		}
		mapData._dmvProjectorBc = bc;

		const w = evt?.view?.window ?? window;
		const preTab = w.open("", this.DMV_PROJECTOR_WINDOW_NAME);
		if (!preTab) {
			JqueryUtil.doToast({type: "warning", content: "Não foi possível abrir a janela de projeção (popup bloqueado?)."});
			try { bc.close(); } catch { /* empty */ }
			mapData._dmvProjectorBc = null;
			return;
		}

		const mapDataSlave = {
			href: mapData.href,
			page: mapData.page,
			source: mapData.source,
			hash: mapData.hash,
			regions: mapData.regions?.length ? MiscUtil.copyFast(mapData.regions) : [],
			width: mapData.width,
			height: mapData.height,
			expectsLightBackground: mapData.expectsLightBackground,
			expectsDarkBackground: mapData.expectsDarkBackground,
			...(mapData.grid ? {grid: mapData.grid} : {}),
		};
		await RenderMap._pMutMapData(mapDataSlave);
		if (!mapDataSlave.loadedImage) {
			preTab.close();
			try { bc.close(); } catch { /* empty */ }
			mapData._dmvProjectorBc = null;
			return;
		}
		mapDataSlave.placedTokens = JSON.parse(JSON.stringify(
			RenderMap._dmvTokensForProjector(mapData.placedTokens || []),
		));

		const ziMaster = RenderMap._getValidZoomInfo({
			width: mapDataSlave.width,
			height: mapDataSlave.height,
			zoomLevel: mapData.zoomLevel,
		});
		mapDataSlave.zoomLevel = ziMaster.zoomLevel;

		const slaveInnerPad = {w: 2, h: 2};
		// Mesmo critério que o DMV no mestre: dimensões reais do scroller no popout (após estar no DOM).
		const fnDim = () => {
			try {
				const scroller = preTab.document?.querySelector(".ve-rd__scroller-viewer");
				if (scroller && scroller.clientWidth > 8 && scroller.clientHeight > 8) {
					return {w: scroller.clientWidth | 0, h: scroller.clientHeight | 0};
				}
			} catch { /* empty */ }
			return {
				w: Math.max(64, masterWrpCvs.clientWidth | 0),
				h: Math.max(64, masterWrpCvs.clientHeight | 0),
			};
		};

		const slaveOpts = {
			...contentOpts,
			isProjectorSlave: true,
			projectorSyncChannelId: channelId,
			enableBestiaryTokens: false,
			enableAssetLibrary: false,
			fitFillInnerPad: slaveInnerPad,
		};

		const {wrp, setZoom} = this._getEleWindowContent({
			mapData: mapDataSlave,
			fnGetContainerDimensions: fnDim,
			opts: slaveOpts,
		});

		await Renderer.hover.pDoShowBrowserWindow(wrp, {
			title: "Projeção — jogadores",
			popoutOpenAsNewTab: true,
			existingWindow: preTab,
			pFnGetPopoutContent: () => wrp,
			fnGetPopoutSize: () => this._fnGetPopoutSizeProjector(),
		});

		mapDataSlave._dmvBindKeyboard?.();
		try { wrp.focuse?.(); } catch { /* empty */ }

		try {
			const html = preTab.document.documentElement;
			const body = preTab.document.body;
			html.style.margin = "0";
			html.style.width = "100%";
			html.style.height = "100%";
			html.style.overflow = "hidden";
			body.style.margin = "0";
			body.style.width = "100%";
			body.style.height = "100%";
			body.style.overflow = "hidden";
			const wrap = preTab._wrpHoverContent;
			if (wrap) {
				wrap.style.width = "100%";
				wrap.style.height = "100%";
				wrap.style.maxWidth = "none";
				wrap.style.boxShadow = "none";
				wrap.style.display = "flex";
				wrap.style.flexDirection = "column";
				wrap.style.minHeight = "100%";
				wrap.style.overflow = "hidden";
			}
		} catch { /* empty */ }

		if (!masterWrpCvs._dmvProjectorRo && typeof ResizeObserver !== "undefined") {
			masterWrpCvs._dmvProjectorRo = new ResizeObserver(MiscUtil.debounce(() => {
				mapData._dmvPublishProjectorState?.();
			}, 40));
			masterWrpCvs._dmvProjectorRo.observe(masterWrpCvs);
		}

		const push = () => {
			try {
				bc.postMessage({
					type: "dmvSync",
					masterZoomLevel: mapData.zoomLevel,
					scrollLeft: masterWrpCvs.scrollLeft,
					scrollTop: masterWrpCvs.scrollTop,
					placedTokens: JSON.parse(JSON.stringify(
						RenderMap._dmvTokensForProjector(mapData.placedTokens || []),
					)),
				});
			} catch { /* empty */ }
		};
		push();
		requestAnimationFrame(() => push());
		setTimeout(() => push(), 50);
		setTimeout(() => push(), 200);
		setTimeout(push, 500);

		mapData._dmvProjectorWin = preTab;
		mapData._dmvProjectorBtn = btnProjetar ?? mapData._dmvProjectorBtn;
		const onProjectorClosed = () => RenderMap._closeDmvProjectorMirror(mapData, {skipCloseWindow: true});
		try {
			preTab.addEventListener("pagehide", onProjectorClosed, {once: true});
		} catch { /* empty */ }
		RenderMap._mutDmvProjectorBtnUi(mapData._dmvProjectorBtn, mapData);
	}

	static _isDmvProjectorMirrorOpen (mapData) {
		const w = mapData?._dmvProjectorWin;
		return !!w && !w.closed;
	}

	static _mutDmvProjectorBtnUi (btn, mapData) {
		if (!btn) return;
		const isOpen = RenderMap._isDmvProjectorMirrorOpen(mapData);
		if (isOpen) {
			btn.html(`<span class="glyphicon glyphicon-stop"></span> Parar projeção`);
			btn.attr("title", "Fecha a janela de projeção");
			btn.removeClass("ve-btn-primary").addClass("ve-btn-warning");
		} else {
			btn.html(`<span class="glyphicon glyphicon-modal-window"></span> Projetar`);
			btn.attr("title", "Abre vista espelhada para o projector (pan e tokens sincronizados; zoom independente até Enviar zoom)");
			btn.removeClass("ve-btn-warning").addClass("ve-btn-primary");
		}
	}

	static _closeDmvProjectorMirror (mapData, {skipCloseWindow = false} = {}) {
		if (!mapData) return;
		if (!skipCloseWindow) {
			try {
				const w = mapData._dmvProjectorWin;
				if (w && !w.closed) w.close();
			} catch { /* empty */ }
		}
		try {
			mapData._dmvProjectorBc?.postMessage?.({type: "dmvPortrait", show: false});
		} catch { /* empty */ }
		mapData._dmvProjectorWin = null;
		try { mapData._dmvProjectorBc?.close(); } catch { /* empty */ }
		mapData._dmvProjectorBc = null;
		RenderMap._mutDmvProjectorBtnUi(mapData._dmvProjectorBtn, mapData);
	}

	/** First fluff Images-tab entry (e.g. `fluff-bestiary-mm.json` → `bestiary/MM/Kobold.webp`). */
	static _getDmvFluffPortraitImageEntry (fluff) {
		const images = fluff?.images;
		if (!Array.isArray(images) || !images.length) return null;
		return images.find(it => it?.type === "image" && it.href) || images[0];
	}

	/** Internal path or external URL string from a fluff `images[]` entry. */
	static _getDmvFluffImagePath (fluffImageEntry) {
		const href = fluffImageEntry?.href;
		if (!href) return null;
		if (typeof href === "string") return href;
		if (href.type === "internal") return href.path;
		if (href.type === "external") return href.url;
		return null;
	}

	static _getDmvFluffImageUrl (fluffImageEntry, RendererRoot) {
		if (!fluffImageEntry?.href || !RendererRoot?.utils) return null;
		try {
			return RendererRoot.utils.getEntryMediaUrl(fluffImageEntry, "href", "img") || null;
		} catch {
			return null;
		}
	}

	static _normalizeDmvTokenPortraitCache (t) {
		if (!t?.imageHref || typeof t.imageHref === "string") return;
		const path = RenderMap._getDmvFluffImagePath({href: t.imageHref});
		if (path) t.imagePath = path;
		delete t.imageHref;
	}

	static _DMV_CLIPBOARD_PREFIX = "5ETOOLS_DMV_PLACED_V1:";

	/** @param {object} t Placed token/asset on the map */
	static _dmvSerializePlacedForClipboard (t) {
		const cpy = MiscUtil.copyFast(t);
		delete cpy.id;
		delete cpy.stackZ;
		return cpy;
	}

	/**
	 * @param {object} src Serialized placed entry (no `id` / `stackZ`)
	 * @param {Array} placedTokens
	 */
	static _dmvClonePlacedFromClipboard (src, placedTokens, {offsetMapX = 0, offsetMapY = 0} = {}) {
		const cpy = MiscUtil.copyFast(src);
		cpy.id = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		cpy.mapX = (cpy.mapX ?? 0) + offsetMapX;
		cpy.mapY = (cpy.mapY ?? 0) + offsetMapY;
		cpy.stackZ = this._nextDmvPlacedTokenStackZ(placedTokens);
		this._normalizeDmvTokenPortraitCache(cpy);
		return cpy;
	}

	static _dmvParsePlacedClipboardText (text) {
		const prefix = this._DMV_CLIPBOARD_PREFIX;
		if (!text || !String(text).startsWith(prefix)) return null;
		try {
			const parsed = JSON.parse(String(text).slice(prefix.length));
			if (!parsed || typeof parsed !== "object" || !parsed.href) return null;
			return parsed;
		} catch {
			return null;
		}
	}

	static _dmvGetPlacedOffsetStep (mapData) {
		if (mapData.grid?.size != null && mapData.grid?.type !== "none") return Number(mapData.grid.size);
		return 40;
	}

	/** Duplicate one placed token/asset; returns the new entry. */
	/** Tokens/assets not sent to the projector window (DM-only prep). */
	static _dmvIsProjectorHidden (t) {
		return t?.projectorHidden === true;
	}

	static _dmvTokensForProjector (placedTokens) {
		if (!Array.isArray(placedTokens)) return [];
		return placedTokens.filter(t => !this._dmvIsProjectorHidden(t));
	}

	/**
	 * Bestiary portrait (fluff Images tab) for a placed creature token.
	 * @param {object} t Placed token
	 * @param {Window} appWindow Host with DataLoader + Renderer
	 */
	static async _pResolveDmvTokenPortrait (t, appWindow = globalThis) {
		if (!t || t.kind === "asset") return null;

		RenderMap._normalizeDmvTokenPortraitCache(t);

		const label = t.label || "";
		const tokenHref = t.href || null;
		const R = appWindow.Renderer;
		const Rget = R?.get?.();

		if (t.imagePath) {
			return {
				label,
				imagePath: t.imagePath,
				portraitUrl: Rget ? Rget.getMediaUrl("img", t.imagePath) : null,
				tokenHref,
			};
		}

		const DL = appWindow.DataLoader;
		const Url = appWindow.UrlUtil;
		if (!t.monSource || !t.monHash || !DL || !Url || !R?.monster) {
			return label || tokenHref ? {label, imagePath: null, portraitUrl: null, tokenHref} : null;
		}

		try {
			const mon = await DL.pCacheAndGet(Url.PG_BESTIARY, t.monSource, t.monHash);
			if (!mon) return label || tokenHref ? {label, imagePath: null, portraitUrl: null, tokenHref} : null;

			const fluff = await R.monster.pGetFluff(mon);
			const fluffImg = RenderMap._getDmvFluffPortraitImageEntry(fluff);
			const imagePath = RenderMap._getDmvFluffImagePath(fluffImg);
			const portraitUrl = RenderMap._getDmvFluffImageUrl(fluffImg, R);
			if (imagePath) t.imagePath = imagePath;

			return {
				label: label || mon.name || "",
				imagePath,
				portraitUrl,
				tokenHref,
			};
		} catch {
			return label || tokenHref ? {label, imagePath: null, portraitUrl: null, tokenHref} : null;
		}
	}

	/** Key for `localStorage` (tokens + assets); one key per map identity (href|page|source|hash). */
	static _getDmvTokenStorageKey (mapData) {
		const id = `${mapData.href || ""}|${mapData.page || ""}|${mapData.source || ""}|${mapData.hash || ""}`;
		return `5e_dmv_tokens:${id.slice(0, 240)}`;
	}

	/**
	 * Ensure each placed token has a finite integer `stackZ` (stacking order among tokens + assets).
	 * Saves without `stackZ` keep legacy paint order (array index = bottom to top).
	 * @param {Array} placedTokens
	 */
	static _normalizePlacedTokensStackZ (placedTokens) {
		if (!Array.isArray(placedTokens) || !placedTokens.length) return;
		const decorated = placedTokens.map((t, i) => ({t, i}));
		decorated.sort((a, b) => {
			const za = typeof a.t.stackZ === "number" && Number.isFinite(a.t.stackZ) ? a.t.stackZ : a.i;
			const zb = typeof b.t.stackZ === "number" && Number.isFinite(b.t.stackZ) ? b.t.stackZ : b.i;
			if (za !== zb) return za - zb;
			return a.i - b.i;
		});
		decorated.forEach((d, rank) => {
			d.t.stackZ = rank;
		});
	}

	/** Next free `stackZ` so a newly placed token/asset paints on top. */
	static _nextDmvPlacedTokenStackZ (placedTokens) {
		if (!Array.isArray(placedTokens) || !placedTokens.length) return 0;
		let m = -1;
		for (const t of placedTokens) {
			const z = Number(t?.stackZ);
			if (Number.isFinite(z) && z > m) m = z;
		}
		return m + 1;
	}

	/**
	 * Merged top-down token paths: `data/hdq/free-creature-token-map.json` then `data/hdq/fa-token-map.json`
	 * (FA entries override FREE on the same normalized creature name).
	 */
	static _dmvFaTokenMapP = null;

	static _normalizeDmvFaCreatureName (name) {
		return String(name || "")
			.toLowerCase()
			.replace(/[\u2019']/g, "")
			.replace(/\s*\([^)]*\)\s*$/u, "")
			.replace(/\s+/g, " ")
			.trim();
	}

	/**
	 * @param {Window} appWindow Host with `Renderer` + `DataUtil` (opener when DMV is a popout).
	 */
	static async _pLoadDmvFaTokenMap (appWindow) {
		if (this._dmvFaTokenMapP) return this._dmvFaTokenMapP;
		const win = appWindow || globalThis;
		const R = win.Renderer || globalThis.Renderer;
		const baseUrl = R?.get?.()?.baseUrl ?? "";
		this._dmvFaTokenMapP = (async () => {
			const DU = win.DataUtil || globalThis.DataUtil;
			if (!DU?.loadJSON) return {};
			const parseMap = raw => {
				const m = raw?.map;
				if (!m || typeof m !== "object") return {};
				const out = {};
				for (const [k, v] of Object.entries(m)) {
					if (typeof v === "string" && v) out[k] = v;
					else if (v && typeof v === "object" && v.rel) out[k] = v.rel;
				}
				return out;
			};
			try {
				const [rawFree, rawFa] = await Promise.all([
					DU.loadJSON(`${baseUrl}data/hdq/free-creature-token-map.json`).catch(() => ({})),
					DU.loadJSON(`${baseUrl}data/hdq/fa-token-map.json`).catch(() => ({})),
				]);
				return {...parseMap(rawFree), ...parseMap(rawFa)};
			} catch {
				return {};
			}
		})();
		return this._dmvFaTokenMapP;
	}

	/** @type {Promise<Array<{id: string, rel: string, name: string}>>|null} */
	static _dmvAssetManifestP = null;

	/** Call after regenerating `data/hdq/dmv-asset-manifest.json` if you need a new fetch without reloading the tab. */
	static clearDmvAssetManifestCache () {
		this._dmvAssetManifestP = null;
	}

	/**
	 * DMV asset picker manifest (`data/hdq/dmv-asset-manifest.json`); images under `img/hdq/fa-assets/`.
	 * Cached once per page load (full FA packs can be tens of MB JSON — avoid re-download/re-parse every modal open).
	 * @param {Window} appWindow Host with `Renderer` + `DataUtil` (opener when DMV is a popout).
	 */
	static async _pLoadDmvAssetManifest (appWindow) {
		if (this._dmvAssetManifestP) return this._dmvAssetManifestP;
		const win = appWindow || globalThis;
		const R = win.Renderer || globalThis.Renderer;
		const baseUrl = R?.get?.()?.baseUrl ?? "";
		this._dmvAssetManifestP = (async () => {
			const DU = win.DataUtil || globalThis.DataUtil;
			if (!DU?.loadJSON) return [];
			try {
				const raw = await DU.loadJSON(`${baseUrl}data/hdq/dmv-asset-manifest.json`);
				const arr = raw?.assets;
				if (!Array.isArray(arr)) return [];
				return arr.filter(a => a && typeof a.rel === "string" && a.rel.length);
			} catch {
				return [];
			}
		})();
		return this._dmvAssetManifestP;
	}

	/**
	 * @returns {Promise<string|null>} Path for `Renderer.get().getMediaUrl("img", …)` (FREE map, then FA override) or null.
	 */
	static async _pGetDmvFaTokenRelForMonster (mon, appWindow) {
		if (!mon?.name) return null;
		const map = await this._pLoadDmvFaTokenMap(appWindow);
		const n = this._normalizeDmvFaCreatureName(mon.name);
		if (n && map[n]) return map[n];
		return null;
	}

	/**
	 * Open a blank tab synchronously while the user gesture is still trusted (must run before any `await`).
	 * @returns {undefined|Window|null} `undefined` if this mode should use an inline/sized hover instead; `Window` if opened; `null` if blocked.
	 */
	static _syncPreOpenPopoutTab (evt, isProjectorDefaultPopout, wantsNewTab) {
		if (!wantsNewTab) return undefined;
		const usePopout = isProjectorDefaultPopout ? !evt.shiftKey : !!evt.shiftKey;
		if (!usePopout) return undefined;

		const w = evt?.view?.window ?? window;
		const win = w.open("", "_blank");
		if (!win) {
			JqueryUtil.doToast({type: "warning", content: `Could not open a new window — check your browser's popup blocker.`});
			return null;
		}
		return win;
	}

	/**
	 * @param {boolean} opts.isProjectorDefaultPopout true: popout by default, Shift = inline (player / projector). false: DM pattern (Shift = popout).
	 * @param {Window} [opts.preSyncedPopoutTab] Tab opened synchronously in the click handler (see {@link RenderMap._syncPreOpenPopoutTab}).
	 */
	static async _pOpenDmvWithHoverWindow ({
		evt,
		mapData,
		title,
		isProjectorDefaultPopout,
		getWindowPosition,
		contentOpts = {},
		preSyncedPopoutTab,
	}) {
		const wantsNewTab = contentOpts.popoutOpenAsNewTab === true;
		const usePopout = isProjectorDefaultPopout ? !evt.shiftKey : !!evt.shiftKey;

		let tabWin;
		if (wantsNewTab && usePopout) {
			tabWin = preSyncedPopoutTab;
			if (tabWin === undefined) {
				const w = evt?.view?.window ?? window;
				tabWin = w.open("", "_blank");
				if (!tabWin) {
					JqueryUtil.doToast({type: "warning", content: `Could not open a new window — check your browser's popup blocker.`});
					return null;
				}
			}
		} else {
			tabWin = undefined;
		}

		let hoverWindow;
		const fnGetContainerDimensions = () => {
			if (tabWin) {
				const scroller = tabWin.document?.querySelector(".ve-rd__scroller-viewer");
				if (scroller && scroller.clientWidth > 8 && scroller.clientHeight > 8) {
					return {w: scroller.clientWidth, h: scroller.clientHeight};
				}
				return {
					w: tabWin.innerWidth,
					h: Math.max(1, tabWin.innerHeight - 48),
				};
			}
			const {wWrpContent, hWrapContent} = hoverWindow.getPosition();
			return {w: wWrpContent, h: hWrapContent};
		};

		const fitFillInnerPad = contentOpts.fitFillInnerPad ?? (tabWin ? {w: 2, h: 2} : {w: 10, h: 56});

		const {wrp, setZoom} = this._getEleWindowContent({
			mapData,
			fnGetContainerDimensions,
			opts: {...contentOpts, fitFillInnerPad},
		});

		const fnGetPopoutSize = isProjectorDefaultPopout
			? () => this._fnGetPopoutSizeProjector()
			: () => {
				const zoomInfo = this._getValidZoomInfo(mapData);
				return {
					width: Math.min(window.innerWidth, zoomInfo.widthZoomed),
					height: Math.min(window.innerHeight, zoomInfo.heightZoomed + 32),
				};
			};

		if (tabWin) {
			await Renderer.hover.pDoShowBrowserWindow(wrp, {
				title: title || `Dynamic Map Viewer`,
				popoutOpenAsNewTab: true,
				existingWindow: tabWin,
				pFnGetPopoutContent: () => wrp,
				fnGetPopoutSize,
			});
			mapData._dmvBindKeyboard?.();
			this._mutInitialZoom({
				fnGetContainerDimensions,
				mapData,
				setZoom,
				innerPad: fitFillInnerPad,
			});
			return {_winPopup: tabWin};
		}

		hoverWindow = Renderer.hover.getShowWindow(
			wrp,
			getWindowPosition(evt),
			{
				title: title || `Dynamic Map Viewer`,
				isPermanent: true,
				isBookContent: true,
				width: Math.min(Math.floor(document.body.clientWidth / 2), mapData.width),
				height: mapData.height + 32,
				pFnGetPopoutContent: () => wrp,
				fnGetPopoutSize,
				isPopout: usePopout,
				popoutOpenAsNewTab: wantsNewTab,
			},
		);

		if (hoverWindow.pPoppingOut) await hoverWindow.pPoppingOut;
		mapData._dmvBindKeyboard?.();

		this._mutInitialZoom({
			fnGetContainerDimensions,
			mapData,
			setZoom,
			innerPad: fitFillInnerPad,
		});

		return hoverWindow;
	}

	/* -------------------------------------------- */

	static async pShowViewer (evt, ele) {
		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) return;

		await this._pOpenDmvWithHoverWindow({
			evt,
			mapData,
			title: `Dynamic Map Viewer`,
			isProjectorDefaultPopout: false,
			getWindowPosition: e => Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, e),
			contentOpts: {},
		});
	}

	static async pShowHotdqGreenestPlayerViewer (evt, ele) {
		const preTab = this._syncPreOpenPopoutTab(evt, true, true);
		if (preTab === null) return;

		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) {
			if (preTab) preTab.close();
			return;
		}

		await this._pOpenDmvWithHoverWindow({
			evt,
			mapData,
			title: `Dynamic Map Viewer`,
			isProjectorDefaultPopout: true,
			getWindowPosition: e => Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, e),
			preSyncedPopoutTab: preTab,
			contentOpts: {
				popoutOpenAsNewTab: true,
				paintRegions: false,
				poiDebugMarkers: true,
				helpExtraHtml: "<li>Faint <b>i</b> markers show POI centroids (alignment check).</li><li>POI detail: keep <b>070</b>; <b>074</b> tunnel grid; <b>07c</b> temple; <b>07f</b> watermill; <b>071</b> market; <b>072</b> street (well / junction).</li><li><kbd>SHIFT</kbd> while opening keeps the viewer inline on this page (for laptop review).</li><li><b>Projetar</b> abre uma segunda janela; com projeção ativa o botão passa a <b>Parar projeção</b> e fecha o espelho. <b>Pan</b> e <b>tokens</b> seguem o mestre; o <b>zoom</b> da projeção é <b>independente</b> (botões ou <kbd>CTRL</kbd>+scroll na área do mapa). <b>Enviar zoom</b> ou <kbd>P</kbd> copia o zoom atual do mestre para o projector. <kbd>H</kbd> / <kbd>J</kbd>: Zoom to Fit (largura) / Zoom Fit Height. No app Electron, tenta abrir no 2.º monitor.</li><li>Toolbar: <b>Fullscreen</b> map; <b>Add token</b> (bestiary; optional top-down packs under <code>img/hdq/fa-tokens/</code> and <code>img/hdq/free-tokens/</code>); drag the image to move; top-left handle to resize; bottom-right <b>↻</b> or <kbd>SHIFT</kbd>+scroll on the image to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes (with confirm).</li>",
				onRegionClick: async ({intersectedRegion, evt: clickEvt}) => {
					const a = String(intersectedRegion.area).toLowerCase();
					if (a === "070") {
						await RenderMap._pOpenHotdqGreenestKeepMap(clickEvt);
						return true;
					}
					// Player map POI #2: area 074 → tunnel grid detail
					if (a === "074") {
						await RenderMap._pOpenHotdqGreenestTunnelGridMap(clickEvt);
						return true;
					}
					// Player map POI #3: area 07c → temple detail
					if (a === "07c") {
						await RenderMap._pOpenHotdqGreenestTempleMap(clickEvt);
						return true;
					}
					// Player map POI #4: area 07f → watermill detail
					if (a === "07f") {
						await RenderMap._pOpenHotdqGreenestWatermillMap(clickEvt);
						return true;
					}
					// Player map POI #5: area 071 → market (custom region, town well / junction)
					if (a === "071") {
						await RenderMap._pOpenHotdqGreenestMarketMap(clickEvt);
						return true;
					}
					// Player map POI #6: area 072 → street (second market slot: template-match octagon)
					if (a === "072") {
						await RenderMap._pOpenHotdqGreenestStreetMap(clickEvt);
						return true;
					}
					return false;
				},
			},
		});
	}

	static async _pOpenHotdqGreenestDetailViewer (evt, {title, imgRel}) {
		const preTab = this._syncPreOpenPopoutTab(evt, true, true);
		if (preTab === null) return;

		const href = Renderer.get().getMediaUrl("img", imgRel);
		const mapData = {regions: [], href};
		await RenderMap._pMutMapData(mapData);
		if (!mapData.loadedImage) {
			if (preTab) preTab.close();
			return;
		}

		await this._pOpenDmvWithHoverWindow({
			evt,
			mapData,
			title,
			isProjectorDefaultPopout: true,
			getWindowPosition: e => Renderer.hover.getWindowPositionExactVisibleBottom(
				EventUtil.getClientX(e),
				EventUtil.getClientY(e),
				e,
			),
			preSyncedPopoutTab: preTab,
			contentOpts: {
				popoutOpenAsNewTab: true,
				helpExtraHtml: "<li><kbd>SHIFT</kbd> while opening keeps the viewer inline.</li><li><b>Fullscreen</b> and <b>Add token</b> in the toolbar (top-down prompt if <code>img/hdq/fa-tokens/</code> or <code>img/hdq/free-tokens/</code> is installed); tokens: drag image, top-left resize, bottom-right rotate, top-right <b>×</b> (confirm), <kbd>SHIFT</kbd>+scroll on image to rotate, <kbd>ALT</kbd>+scroll to scale.</li>",
			},
		});
	}

	static async _pOpenHotdqGreenestKeepMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Greenest Keep", imgRel: "adventure/HotDQ/greenest-keep-v3.png"});
	}

	static async _pOpenHotdqGreenestTunnelGridMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Tunnel grid", imgRel: "adventure/HotDQ/greenest-tunnel-grid.png"});
	}

	static async _pOpenHotdqGreenestTempleMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Temple", imgRel: "adventure/HotDQ/greenest-temple.webp"});
	}

	static async _pOpenHotdqGreenestWatermillMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Watermill", imgRel: "adventure/HotDQ/greenest-watermill.webp"});
	}

	static async _pOpenHotdqGreenestMarketMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Market", imgRel: "adventure/HotDQ/greenest-market.webp"});
	}

	static async _pOpenHotdqGreenestStreetMap (evt) {
		return this._pOpenHotdqGreenestDetailViewer(evt, {title: "Street", imgRel: "adventure/HotDQ/greenest-street.webp"});
	}

	static async pShowHotdqRaiderCampPlayerViewer (evt, ele) {
		const preTab = this._syncPreOpenPopoutTab(evt, true, true);
		if (preTab === null) return;

		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) {
			if (preTab) preTab.close();
			return;
		}

		await this._pOpenDmvWithHoverWindow({
			evt,
			mapData,
			title: `Dynamic Map Viewer`,
			isProjectorDefaultPopout: true,
			getWindowPosition: e => Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, e),
			preSyncedPopoutTab: preTab,
			contentOpts: {
				popoutOpenAsNewTab: true,
				paintRegions: false,
				poiDebugMarkers: true,
				helpExtraHtml: "<li>Faint <b>i</b> markers show POI centroids (alignment check).</li><li>POI areas: <b>09e</b> tents; <b>09c</b> prisoners; <b>0a2</b> Leosin; <b>0a1</b> exploring the camp.</li><li><kbd>SHIFT</kbd> while opening keeps the viewer inline on this page (for laptop review).</li><li><b>Projetar</b> abre uma segunda janela; com projeção ativa o botão passa a <b>Parar projeção</b> e fecha o espelho. <b>Pan</b> e <b>tokens</b> seguem o mestre; o <b>zoom</b> da projeção é <b>independente</b> (botões ou <kbd>CTRL</kbd>+scroll na área do mapa). <b>Enviar zoom</b> ou <kbd>P</kbd> copia o zoom atual do mestre para o projector. <kbd>H</kbd> / <kbd>J</kbd>: Zoom to Fit (largura) / Zoom Fit Height. No app Electron, tenta abrir no 2.º monitor.</li><li>Toolbar: <b>Fullscreen</b> map; <b>Add token</b> (bestiary; optional top-down packs under <code>img/hdq/fa-tokens/</code> and <code>img/hdq/free-tokens/</code>); drag the image to move; top-left handle to resize; bottom-right <b>↻</b> or <kbd>SHIFT</kbd>+scroll on the image to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes (with confirm).</li>",
				onRegionClick: async () => false,
			},
		});
	}

	static async pShowJttrcKiannasFarmhouseViewer (evt, ele) {
		const preTab = this._syncPreOpenPopoutTab(evt, true, true);
		if (preTab === null) return;

		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) {
			if (preTab) preTab.close();
			return;
		}

		await this._pOpenDmvWithHoverWindow({
			evt,
			mapData,
			title: `Dynamic Map Viewer`,
			isProjectorDefaultPopout: true,
			getWindowPosition: e => Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, e),
			preSyncedPopoutTab: preTab,
			contentOpts: {
				popoutOpenAsNewTab: true,
				paintRegions: false,
				poiDebugMarkers: true,
				helpExtraHtml: "<li>Faint <b>i</b> markers show room centroids (alignment check).</li><li>Rooms: <b>0c3</b> yard; <b>0c6</b>–<b>0cf</b> interior; <b>0d2</b> / <b>0d4</b> cellar. Click a region to jump to that location entry.</li><li><kbd>SHIFT</kbd> while opening keeps the viewer inline on this page (for laptop review).</li><li><b>Projetar</b> abre uma segunda janela; com projeção ativa o botão passa a <b>Parar projeção</b> e fecha o espelho. <b>Pan</b> e <b>tokens</b> seguem o mestre; o <b>zoom</b> da projeção é <b>independente</b> (botões ou <kbd>CTRL</kbd>+scroll na área do mapa). <b>Enviar zoom</b> ou <kbd>P</kbd> copia o zoom atual do mestre para o projector. <kbd>H</kbd> / <kbd>J</kbd>: Zoom to Fit (largura) / Zoom Fit Height.</li><li>Toolbar: <b>Fullscreen</b> map; <b>Add token</b>; drag the image to move; top-left handle to resize; bottom-right <b>↻</b> or <kbd>SHIFT</kbd>+scroll on the image to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes (with confirm).</li>",
				onRegionClick: async () => false,
			},
		});
	}

	/* -------------------------------------------- */

	/**
	 * @param mapData
	 * @param {?Function} fnGetContainerDimensions
	 */
	static async pGetRendered (mapData, {fnGetContainerDimensions = null} = {}) {
		await RenderMap._pMutMapData(mapData);
		if (!mapData.loadedImage) return;
		const {wrp, setZoom} = this._getEleWindowContent({mapData, fnGetContainerDimensions});
		this._mutInitialZoom({
			fnGetContainerDimensions,
			mapData,
			setZoom,
		});
		return wrp;
	}

	/* -------------------------------------------- */

	static _mutInitialZoom ({fnGetContainerDimensions, mapData, setZoom, innerPad = {w: 10, h: 56}}) {
		if (!fnGetContainerDimensions) return;

		const applyZoomToFit = () => {
			const zoomToFit = this._getValidZoomInfoFitFill({
				width: mapData.width,
				height: mapData.height,
				fnGetContainerDimensions,
				mode: "fitWidth",
				innerPad,
			});
			setZoom(zoomToFit.zoomLevel);
		};
		// POI / new-tab: layout + scroller size often settle after the first frame(s).
		requestAnimationFrame(() => {
			applyZoomToFit();
			requestAnimationFrame(applyZoomToFit);
		});
		setTimeout(applyZoomToFit, 200);
	}

	/* -------------------------------------------- */

	static async _pMutMapData (mapData) {
		// Store some additional data on this mapData state object
		mapData.activeWindows = {};
		mapData.loadedImage = await RenderMap._pLoadImage(mapData);

		if (!mapData.loadedImage) return;

		mapData.width = mapData.width || mapData.loadedImage.naturalWidth;
		mapData.height = mapData.height || mapData.loadedImage.naturalHeight;

		const zoomInfo = this._getValidZoomInfo({width: mapData.width, height: mapData.height, zoomLevel: 1.0});
		mapData.zoomLevel = zoomInfo.zoomLevel;
	}

	static async _pLoadImage (mapData) {
		const image = new Image();
		const pLoad = new Promise((resolve, reject) => {
			image.onload = () => resolve(image);
			image.onerror = err => reject(err);
		});
		image.src = mapData.href;

		let out = null;
		try {
			out = await pLoad;
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Failed to load image! ${VeCt.STR_SEE_CONSOLE}`});
			setTimeout(() => { throw e; });
		}
		return out;
	}

	/* -------------------------------------------- */

	static _ZoomInfo = class {
		isCappedMin = false;
		isCappedMax = false;
		zoomLevel;
		widthZoomed;
		heightZoomed;

		constructor (
			{
				isCappedMin = false,
				isCappedMax = false,
				zoomLevel,
				widthZoomed,
				heightZoomed,
			},
		) {
			this.isCappedMin = isCappedMin;
			this.isCappedMax = isCappedMax;
			this.zoomLevel = zoomLevel;
			this.widthZoomed = widthZoomed;
			this.heightZoomed = heightZoomed;
		}
	};

	static _getValidZoomInfo ({width, height, zoomLevel}) {
		const widthZoomed = Math.round(width * zoomLevel);
		const heightZoomed = Math.round(height * zoomLevel);
		const area = widthZoomed * heightZoomed;

		if (area > this._MAX_CANVAS_AREA) {
			const zoomLevelMax = Math.sqrt(1 / (width * height / this._MAX_CANVAS_AREA));

			// Use `.floor` to ensure rounding doesn't push us over the limit
			const widthZoomedMax = Math.floor(width * zoomLevelMax);
			const heightZoomedMax = Math.floor(height * zoomLevelMax);

			return new this._ZoomInfo({isCappedMax: true, zoomLevel: zoomLevelMax, widthZoomed: widthZoomedMax, heightZoomed: heightZoomedMax});
		}

		if (area < this._MIN_CANVAS_AREA) {
			const zoomLevelMin = Math.sqrt(1 / (width * height / this._MIN_CANVAS_AREA));

			// Use `.ceil` to ensure rounding doesn't push us under the limit
			const widthZoomedMin = Math.ceil(width * zoomLevelMin);
			const heightZoomedMin = Math.ceil(height * zoomLevelMin);

			return new this._ZoomInfo({isCappedMin: true, zoomLevel: zoomLevelMin, widthZoomed: widthZoomedMin, heightZoomed: heightZoomedMin});
		}

		return new this._ZoomInfo({isCappedMax: area === this._MAX_CANVAS_AREA, isCappedMin: area === this._MIN_CANVAS_AREA, zoomLevel, widthZoomed, heightZoomed});
	}

	/* -------------------------------------------- */

	static _getValidZoomInfoFitFill ({width, height, fnGetContainerDimensions = null, mode, innerPad = {w: 10, h: 56}}) {
		if (!fnGetContainerDimensions) return this._getValidZoomInfo({width, height, zoomLevel: 1.0});

		const {w: widthContainer, h: heightContainer} = fnGetContainerDimensions();
		const widthMapDisplay = Math.max(1, widthContainer - innerPad.w);
		const heightMapDisplay = Math.max(1, heightContainer - innerPad.h);

		const zoomLevelFillWidth = widthMapDisplay / width;
		const zoomInfoFillWidth = this._getValidZoomInfo({width, height, zoomLevel: zoomLevelFillWidth});

		const zoomLevelFillHeight = heightMapDisplay / height;
		const zoomInfoFillHeight = this._getValidZoomInfo({width, height, zoomLevel: zoomLevelFillHeight});

		switch (mode) {
			case "fit": return zoomInfoFillHeight.zoomLevel > zoomInfoFillWidth.zoomLevel ? zoomInfoFillWidth : zoomInfoFillHeight;
			case "fitWidth": return zoomInfoFillWidth;
			case "fitHeight": return zoomInfoFillHeight;
			case "fill": return zoomInfoFillWidth.zoomLevel > zoomInfoFillHeight.zoomLevel ? zoomInfoFillWidth : zoomInfoFillHeight;
			default: throw new Error(`Unhandled mode "${mode}"!`);
		}
	}

	/* -------------------------------------------- */

	/**
	 * @param {object} mapData
	 * @param {?Function} fnGetContainerDimensions
	 */
	static _getEleWindowContent ({mapData, fnGetContainerDimensions = null, opts = {}} = {}) {
		const {
			paintRegions = true,
			onRegionClick = null,
			helpExtraHtml = "",
			poiDebugMarkers = false,
			enableBestiaryTokens = true,
			enableAssetLibrary = true,
			popoutOpenAsNewTab = false,
			fitFillInnerPad = {w: 10, h: 56},
			isProjectorSlave = false,
			projectorSyncChannelId = null,
		} = opts;

		let showPoiMarkers = !!poiDebugMarkers;

		const X = 0;
		const Y = 1;

		const storageKey = RenderMap._getDmvTokenStorageKey(mapData);
		if (!mapData.placedTokens) {
			try {
				let raw = localStorage.getItem(storageKey);
				if (!raw) {
					raw = sessionStorage.getItem(storageKey);
					if (raw) {
						try {
							localStorage.setItem(storageKey, raw);
						} catch { /* quota */ }
						sessionStorage.removeItem(storageKey);
					}
				}
				mapData.placedTokens = raw ? JSON.parse(raw) : [];
			} catch {
				mapData.placedTokens = [];
			}
		}
		if (!Array.isArray(mapData.placedTokens)) mapData.placedTokens = [];
		mapData.placedTokens.forEach(t => RenderMap._normalizeDmvTokenPortraitCache(t));
		this._normalizePlacedTokensStackZ(mapData.placedTokens);

		let publishProjectorState = () => {};
		let pushProjectorZoom = () => {};
		let publishPortrait = () => {};
		let mutPortraitPanel = () => {};
		let portraitHoverTokenId = null;
		let portraitShowTimer = null;
		let portraitHideTimer = null;
		/** @type {(opts?: {immediate?: boolean}) => void} */
		let hideDmvPortrait = () => {};

		const enableCreatureTokens = enableBestiaryTokens !== false;
		const enableAssetLib = enableAssetLibrary !== false;
		// Slave precisa da camada para pintar tokens/assets sincronizados (UI de add está desligada).
		const enablePlacedLayer = enableCreatureTokens || enableAssetLib || isProjectorSlave;
		const defaultTokenDiameter = (mapData.grid?.size != null && mapData.grid?.type !== "none")
			? Number(mapData.grid.size)
			: 80;

		const cvs = ee`<canvas class="ve-p-0 ve-m-0"></canvas>`;
		cvs.width = mapData.width;
		cvs.height = mapData.height;
		const ctx = cvs.getContext("2d");

		const wrpTokens = ee`<div class="ve-absolute ve-p-0" style="left:0;top:0;pointer-events:none;z-index:1"></div>`;
		const wrpMapStack = ee`<div class="ve-relative ve-inline-block">${cvs}${wrpTokens}</div>`;

		const dmvGetSelectedIds = () => {
			if (!mapData._dmvSelectedTokenIds) mapData._dmvSelectedTokenIds = new Set();
			if (mapData._dmvSelectedTokenId) {
				mapData._dmvSelectedTokenIds.add(mapData._dmvSelectedTokenId);
				delete mapData._dmvSelectedTokenId;
			}
			return mapData._dmvSelectedTokenIds;
		};

		const dmvGetPrimarySelectedId = () => {
			const ids = dmvGetSelectedIds();
			if (!ids.size) return null;
			return [...ids][ids.size - 1];
		};

		const mutDmvTokenSelectionChrome = () => {
			const root = wrpTokens[0] ?? wrpTokens;
			if (!root?.querySelectorAll) return;
			const sel = dmvGetSelectedIds();
			root.querySelectorAll(".rd__dmv-token-wrap").forEach(el => {
				const id = el.getAttribute("data-dmv-token-id");
				el.classList.toggle("rd__dmv-token-wrap--selected", sel.has(id));
				const tok = mapData.placedTokens.find(pt => pt.id === id);
				el.classList.toggle("rd__dmv-token-wrap--projector-hidden", !!tok && RenderMap._dmvIsProjectorHidden(tok));
			});
		};

		const dmvClearTokenSelection = () => {
			mapData._dmvSelectedTokenIds = new Set();
			delete mapData._dmvSelectedTokenId;
			mutDmvTokenSelectionChrome();
		};

		/** @param {"replace"|"toggle"|"add"} mode */
		const dmvSelectToken = (tokenId, {mode = "replace", focusWrap = null} = {}) => {
			const ids = dmvGetSelectedIds();
			if (mode === "toggle") {
				if (ids.has(tokenId)) ids.delete(tokenId);
				else ids.add(tokenId);
			} else if (mode === "add") {
				ids.add(tokenId);
			} else {
				ids.clear();
				ids.add(tokenId);
			}
			mutDmvTokenSelectionChrome();
			focusWrap?.focuse?.();
		};

		const dmvSetProjectorHiddenForIds = (tokenIds, hidden) => {
			let n = 0;
			for (const t of mapData.placedTokens) {
				if (tokenIds.has(t.id)) {
					t.projectorHidden = !!hidden;
					n++;
				}
			}
			if (!n) return 0;
			if (hidden && portraitHoverTokenId && tokenIds.has(portraitHoverTokenId)) {
				hideDmvPortrait({immediate: true});
			}
			refreshTokens();
			saveTokens();
			return n;
		};

		const getDragBody = () => e_({ele: cvs.ownerDocument.body});

		const saveTokens = MiscUtil.debounce(() => {
			if (!enablePlacedLayer || isProjectorSlave) return;
			try {
				localStorage.setItem(storageKey, JSON.stringify(mapData.placedTokens));
			} catch { /* quota */ }
			publishProjectorState();
		}, 150);

		const applyTokenDom = (t, tokenEls) => {
			const {wrap, img} = tokenEls;
			const zz = mapData.zoomLevel;
			const diam = (t.baseDiameter || defaultTokenDiameter) * (t.scale || 1);
			const disp = diam * zz;
			const px = t.mapX * zz;
			const py = t.mapY * zz;
			const sz = typeof t.stackZ === "number" && Number.isFinite(t.stackZ) ? t.stackZ : 0;
			wrap.css({
				left: `${px - disp / 2}px`,
				top: `${py - disp / 2}px`,
				width: `${disp}px`,
				height: `${disp}px`,
				zIndex: String(2 + Math.round(sz)),
			});
			img.css({
				transform: `rotate(${t.rotation || 0}deg)`,
				transformOrigin: "center center",
			});
		};

		const mutTokenLayerSize = () => {
			wrpMapStack.css({width: `${cvs.width}px`, height: `${cvs.height}px`});
			wrpTokens.css({width: `${cvs.width}px`, height: `${cvs.height}px`});
		};

		const zoomChange = (direction) => {
			if (direction != null) {
				const lastZoomLevel = mapData.zoomLevel;

				switch (direction) {
					case "in": {
						const zoomInfoCurrent = this._getValidZoomInfo(mapData);
						if (zoomInfoCurrent.isCappedMax) return; // FIXME(Future) always false

						mapData.zoomLevel = this._getValidZoomInfo({
							width: mapData.width,
							height: mapData.height,
							zoomLevel: mapData.zoomLevel * this._ZOOM_ADJUSTMENT_FACTOR,
						}).zoomLevel;
						break;
					}

					case "out": {
						const zoomInfoCurrent = this._getValidZoomInfo(mapData);
						if (zoomInfoCurrent.isCappedMin) return; // FIXME(Future) always false

						mapData.zoomLevel = this._getValidZoomInfo({
							width: mapData.width,
							height: mapData.height,
							zoomLevel: mapData.zoomLevel / this._ZOOM_ADJUSTMENT_FACTOR,
						}).zoomLevel;
						break;
					}

					case "fill": {
						mapData.zoomLevel = this._getValidZoomInfoFitFill({
							width: mapData.width,
							height: mapData.height,
							fnGetContainerDimensions,
							mode: "fill",
							innerPad: fitFillInnerPad,
						}).zoomLevel;
						break;
					}

					case "fit": {
						mapData.zoomLevel = this._getValidZoomInfoFitFill({
							width: mapData.width,
							height: mapData.height,
							fnGetContainerDimensions,
							mode: "fit",
							innerPad: fitFillInnerPad,
						}).zoomLevel;
						break;
					}

					case "fitWidth": {
						mapData.zoomLevel = this._getValidZoomInfoFitFill({
							width: mapData.width,
							height: mapData.height,
							fnGetContainerDimensions,
							mode: "fitWidth",
							innerPad: fitFillInnerPad,
						}).zoomLevel;
						break;
					}

					case "fitHeight": {
						mapData.zoomLevel = this._getValidZoomInfoFitFill({
							width: mapData.width,
							height: mapData.height,
							fnGetContainerDimensions,
							mode: "fitHeight",
							innerPad: fitFillInnerPad,
						}).zoomLevel;
						break;
					}
				}

				if (Parser.isNumberNearEqual(lastZoomLevel, mapData.zoomLevel)) return;
				onZoomChange({lastZoom: lastZoomLevel});
				return;
			}

			onZoomChange();
		};

		const onZoomChange = ({lastZoom = null, focal = null} = {}) => {
			const zoomInfo = this._getValidZoomInfo(mapData);
			const newZoom = zoomInfo.zoomLevel;
			const oldZoom = lastZoom ?? (mapData.width > 0 ? cvs.width / mapData.width : newZoom);

			const scrollLeft = wrpCvs.scrollLeft;
			const scrollTop = wrpCvs.scrollTop;

			cvs.width = zoomInfo.widthZoomed;
			cvs.height = zoomInfo.heightZoomed;

			const clampScroll = (sl, st) => {
				const maxX = Math.max(0, wrpCvs.scrollWidth - wrpCvs.clientWidth);
				const maxY = Math.max(0, wrpCvs.scrollHeight - wrpCvs.clientHeight);
				wrpCvs.scrollTo(
					Math.max(0, Math.min(Math.round(sl), maxX)),
					Math.max(0, Math.min(Math.round(st), maxY)),
				);
			};

			if (focal && oldZoom > 0 && newZoom > 0) {
				const rect = wrpCvs.getBoundingClientRect();
				const fx = focal.clientX - rect.left;
				const fy = focal.clientY - rect.top;
				const mx = (scrollLeft + fx) / oldZoom;
				const my = (scrollTop + fy) / oldZoom;
				clampScroll(mx * newZoom - fx, my * newZoom - fy);
			} else if (isProjectorSlave) {
				// Zoom independente do mestre: mantém o canto visível em coordenadas do mapa (px lógicos).
				const mx = oldZoom > 0 ? scrollLeft / oldZoom : 0;
				const my = oldZoom > 0 ? scrollTop / oldZoom : 0;
				clampScroll(mx * newZoom, my * newZoom);
			} else {
				const diffWidth = zoomInfo.widthZoomed - (oldZoom > 0 ? Math.round(mapData.width * oldZoom) : cvs.width);
				const diffHeight = zoomInfo.heightZoomed - (oldZoom > 0 ? Math.round(mapData.height * oldZoom) : cvs.height);
				// Scroll to offset the zoom, keeping the same region centred
				clampScroll(
					scrollLeft + diffWidth / 2,
					scrollTop + diffHeight / 2,
				);
			}
			paint();
			mutTokenLayerSize();
			refreshTokens();
			if (isProjectorSlave && mapData.zoomLevel > 0) {
				mapData._dmvSyncMapOrigin = {
					mx: wrpCvs.scrollLeft / mapData.zoomLevel,
					my: wrpCvs.scrollTop / mapData.zoomLevel,
				};
			}
			if (!isProjectorSlave) publishProjectorState();
		};

		const zoomChangeWheel = evt => {
			const lastZoom = mapData.zoomLevel;
			const {deltaPixelsY} = EventUtil.getDeltaPixels(evt);
			if (!deltaPixelsY) return;

			const factor = Math.exp(-deltaPixelsY * RenderMap._ZOOM_WHEEL_SENSITIVITY);
			const zoomInfo = RenderMap._getValidZoomInfo({
				width: mapData.width,
				height: mapData.height,
				zoomLevel: lastZoom * factor,
			});
			if (Parser.isNumberNearEqual(lastZoom, zoomInfo.zoomLevel)) return;

			mapData.zoomLevel = zoomInfo.zoomLevel;
			onZoomChange({lastZoom, focal: {clientX: evt.clientX, clientY: evt.clientY}});
		};

		const getZoomedPoint = (pt) => {
			return [
				Math.round(pt[X] * mapData.zoomLevel),
				Math.round(pt[Y] * mapData.zoomLevel),
			];
		};

		const paint = () => {
			ctx.clearRect(0, 0, cvs.width, cvs.height);
			ctx.drawImage(mapData.loadedImage, 0, 0, cvs.width, cvs.height);

			if (showPoiMarkers && mapData.regions?.length) {
				ctx.save();
				for (const region of mapData.regions) {
					const pts = region.points;
					let sx = 0;
					let sy = 0;
					for (const p of pts) {
						sx += p[0];
						sy += p[1];
					}
					const cx = sx / pts.length;
					const cy = sy / pts.length;
					const [zx, zy] = getZoomedPoint([cx, cy]);
					const rad = Math.max(8, 12 * mapData.zoomLevel);

					ctx.globalAlpha = 0.28;
					ctx.fillStyle = "#1e6fd9";
					ctx.beginPath();
					ctx.arc(zx, zy, rad, 0, Math.PI * 2);
					ctx.fill();

					ctx.globalAlpha = 0.4;
					ctx.strokeStyle = "#ffffff";
					ctx.lineWidth = Math.max(1, 2 * mapData.zoomLevel);
					ctx.stroke();

					ctx.globalAlpha = 0.72;
					ctx.fillStyle = "#ffffff";
					ctx.font = `italic bold ${Math.max(12, Math.round(14 * mapData.zoomLevel))}px Georgia, "Times New Roman", serif`;
					ctx.textAlign = "center";
					ctx.textBaseline = "middle";
					ctx.fillText("i", zx, zy);
				}
				ctx.restore();
			}

			if (!paintRegions) return;

			mapData.regions.forEach(region => {
				ctx.lineWidth = 2;
				ctx.strokeStyle = "#337ab7";
				ctx.fillStyle = "#337ab760";

				ctx.beginPath();
				region.points.forEach(pt => {
					pt = getZoomedPoint(pt);
					ctx.lineTo(pt[X], pt[Y]);
				});

				let firstPoint = region.points[0];
				firstPoint = getZoomedPoint(firstPoint);
				ctx.lineTo(firstPoint[X], firstPoint[Y]);

				ctx.fill();
				ctx.stroke();
				ctx.closePath();
			});
		};

		const refreshTokens = () => {
			if (!enablePlacedLayer) return;
			if (portraitHoverTokenId) {
				const hovered = mapData.placedTokens.find(pt => pt.id === portraitHoverTokenId);
				if (!hovered || hovered.kind === "asset" || RenderMap._dmvIsProjectorHidden(hovered)) {
					hideDmvPortrait({immediate: true});
				}
			}
			wrpTokens.empty();
			const z = mapData.zoomLevel;
			const tokensSorted = [...mapData.placedTokens].sort((a, b) => a.stackZ - b.stackZ);
			for (const t of tokensSorted) {
				const diam = (t.baseDiameter || defaultTokenDiameter) * (t.scale || 1);
				const disp = diam * z;
				const px = t.mapX * z;
				const py = t.mapY * z;
				const sz = typeof t.stackZ === "number" && Number.isFinite(t.stackZ) ? t.stackZ : 0;

				const wrap = ee`<div class="rd__dmv-token-wrap ve-absolute"></div>`;
				wrap.attr("data-dmv-token-id", t.id);
				if (!isProjectorSlave) wrap.attr("tabindex", "0");
				if (dmvGetSelectedIds().has(t.id)) wrap.addClass("rd__dmv-token-wrap--selected");
				if (!isProjectorSlave && RenderMap._dmvIsProjectorHidden(t)) wrap.addClass("rd__dmv-token-wrap--projector-hidden");
				wrap.css({
					left: `${px - disp / 2}px`,
					top: `${py - disp / 2}px`,
					width: `${disp}px`,
					height: `${disp}px`,
					pointerEvents: isProjectorSlave ? "none" : "auto",
					userSelect: "none",
					zIndex: String(2 + Math.round(sz)),
				});

				const img = ee`<img alt="" class="rd__dmv-token" crossorigin="anonymous" src="${t.href}" draggable="false">`;
				img.css({
					position: "absolute",
					left: "0",
					top: "0",
					width: "100%",
					height: "100%",
					objectFit: "contain",
					pointerEvents: isProjectorSlave ? "none" : "auto",
					cursor: isProjectorSlave ? "default" : "grab",
					zIndex: "1",
					transform: `rotate(${t.rotation || 0}deg)`,
					transformOrigin: "center center",
				});

				const btnDel = ee`<button type="button" class="rd__dmv-token-del" aria-label="${t.kind === "asset" ? "Remove asset" : "Remove token"}">×</button>`;
				const btnProjectorVis = !isProjectorSlave
					? ee`<button type="button" class="rd__dmv-token-projvis" aria-label="${RenderMap._dmvIsProjectorHidden(t) ? "Revelar nos jogadores" : "Ocultar dos jogadores"}" title="${RenderMap._dmvIsProjectorHidden(t) ? "Revelar na projeção (jogadores)" : "Ocultar da projeção (só mestre)"}"><span class="glyphicon ${RenderMap._dmvIsProjectorHidden(t) ? "glyphicon-eye-close" : "glyphicon-eye-open"}"></span></button>`
					: null;
				btnDel.css({
					position: "absolute",
					right: "2px",
					top: "2px",
					zIndex: "10",
					width: "13px",
					height: "13px",
					lineHeight: "11px",
					padding: "0",
					fontSize: "11px",
					fontWeight: "600",
					cursor: "pointer",
					borderRadius: "50%",
					border: "1px solid rgba(0,0,0,0.18)",
					background: "rgba(255,255,255,0.42)",
					color: "rgba(0,0,0,0.45)",
					opacity: "0",
					pointerEvents: "none",
					transition: "opacity 0.15s ease, background 0.12s ease, color 0.12s ease",
					boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
				});
				const tokenChromeBtnCss = {
					position: "absolute",
					zIndex: "10",
					width: "13px",
					height: "13px",
					lineHeight: "11px",
					padding: "0",
					fontSize: "10px",
					fontWeight: "600",
					cursor: "pointer",
					borderRadius: "50%",
					border: "1px solid rgba(0,0,0,0.18)",
					background: "rgba(255,255,255,0.42)",
					color: "rgba(0,0,0,0.45)",
					opacity: "0",
					pointerEvents: "none",
					transition: "opacity 0.15s ease, background 0.12s ease, color 0.12s ease",
					boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
				};
				if (btnProjectorVis) {
					btnProjectorVis.css({
						...tokenChromeBtnCss,
						right: "17px",
						top: "2px",
						fontSize: "8px",
						lineHeight: "12px",
					});
				}

				const hResize = ee`<div class="rd__dmv-token-resize" title="Drag to resize (distance from centre)">⤢</div>`;
				hResize.css({
					position: "absolute",
					left: "2px",
					top: "2px",
					zIndex: "10",
					width: "13px",
					height: "13px",
					lineHeight: "11px",
					fontSize: "11px",
					fontWeight: "600",
					textAlign: "center",
					padding: "0",
					color: "rgba(0,0,0,0.45)",
					cursor: "nwse-resize",
					borderRadius: "50%",
					border: "1px solid rgba(0,0,0,0.18)",
					background: "rgba(255,255,255,0.42)",
					opacity: "0",
					pointerEvents: "none",
					transition: "opacity 0.15s ease, background 0.12s ease, color 0.12s ease",
					boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
					boxSizing: "border-box",
					userSelect: "none",
				});

				const hRotate = ee`<div class="rd__dmv-token-rotate" title="Drag to rotate; Shift+scroll on image for steps">↻</div>`;
				hRotate.css({
					position: "absolute",
					right: "2px",
					bottom: "2px",
					zIndex: "10",
					width: "13px",
					height: "13px",
					lineHeight: "11px",
					fontSize: "11px",
					fontWeight: "600",
					textAlign: "center",
					padding: "0",
					color: "rgba(0,0,0,0.45)",
					cursor: "grab",
					borderRadius: "50%",
					border: "1px solid rgba(0,0,0,0.18)",
					background: "rgba(255,255,255,0.42)",
					opacity: "0",
					pointerEvents: "none",
					transition: "opacity 0.15s ease, background 0.12s ease, color 0.12s ease",
					boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
					boxSizing: "border-box",
					userSelect: "none",
				});

				const btnStackFwd = ee`<button type="button" class="rd__dmv-token-stack" aria-label="Bring forward" title="Bring forward (one layer up)">▲</button>`;
				const btnStackBack = ee`<button type="button" class="rd__dmv-token-stack" aria-label="Send backward" title="Send backward (one layer down)">▼</button>`;
				const stackBtnCss = {
					position: "relative",
					width: "13px",
					height: "12px",
					lineHeight: "10px",
					padding: "0",
					fontSize: "9px",
					fontWeight: "600",
					textAlign: "center",
					cursor: "pointer",
					borderRadius: "3px",
					border: "1px solid rgba(0,0,0,0.18)",
					background: "rgba(255,255,255,0.42)",
					color: "rgba(0,0,0,0.55)",
					boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
					boxSizing: "border-box",
					userSelect: "none",
				};
				btnStackFwd.css(stackBtnCss);
				btnStackBack.css(stackBtnCss);

				const wrpStack = ee`<div class="rd__dmv-token-stack-wrap ve-flex-col"></div>`;
				wrpStack.css({
					position: "absolute",
					left: "2px",
					bottom: "2px",
					zIndex: "10",
					gap: "1px",
					opacity: "0",
					pointerEvents: "none",
					transition: "opacity 0.15s ease, background 0.12s ease, color 0.12s ease",
				});
				wrpStack.appends(btnStackFwd);
				wrpStack.appends(btnStackBack);

				const tokenEls = {wrap, img};
				wrap.appends(img);
				if (btnProjectorVis) wrap.appends(btnProjectorVis);
				wrap.appends(btnDel);
				wrap.appends(hResize);
				wrap.appends(hRotate);
				wrap.appends(wrpStack);

				let tokenChromeHover = false;
				let tokenChromeFocus = false;
				const setTokenChromeOpaque = on => {
					const o = on ? "1" : "0";
					const pe = on ? "auto" : "none";
					btnDel.css({opacity: o, pointerEvents: pe});
					if (btnProjectorVis) btnProjectorVis.css({opacity: o, pointerEvents: pe});
					hResize.css({opacity: o, pointerEvents: pe});
					hRotate.css({opacity: o, pointerEvents: pe});
					wrpStack.css({opacity: o, pointerEvents: pe});
				};
				const refreshTokenChrome = () => setTokenChromeOpaque(tokenChromeHover || tokenChromeFocus);
				wrap.onn("mouseenter", () => {
					tokenChromeHover = true;
					refreshTokenChrome();
					if (!isProjectorSlave && t.kind !== "asset" && !RenderMap._dmvIsProjectorHidden(t)) {
						clearTimeout(portraitHideTimer);
						const tokenId = t.id;
						clearTimeout(portraitShowTimer);
						portraitShowTimer = setTimeout(() => {
							const tok = mapData.placedTokens.find(pt => pt.id === tokenId);
							if (!tok || tok.kind === "asset" || RenderMap._dmvIsProjectorHidden(tok)) return;
							portraitHoverTokenId = tokenId;
							const appWin = RenderMap._getDmvHostAppWindowForSearch(wrap.ownerDocument?.defaultView);
							void RenderMap._pResolveDmvTokenPortrait(tok, appWin).then(info => {
								if (portraitHoverTokenId !== tokenId) {
									if (!portraitHoverTokenId) {
										mutPortraitPanel({show: false});
										publishPortrait({show: false});
									}
									return;
								}
								const tokNow = mapData.placedTokens.find(pt => pt.id === tokenId);
								if (!tokNow || RenderMap._dmvIsProjectorHidden(tokNow)) {
									hideDmvPortrait({immediate: true});
									return;
								}
								if (!info) {
									hideDmvPortrait({immediate: true});
									return;
								}
								mutPortraitPanel({show: true, ...info});
								publishPortrait({show: true, label: info.label, imagePath: info.imagePath, tokenHref: info.tokenHref});
								if (tokNow.imagePath) saveTokens();
							});
						}, 140);
					}
				});
				wrap.onn("mouseleave", () => {
					tokenChromeHover = false;
					refreshTokenChrome();
					if (!isProjectorSlave && t.kind !== "asset") hideDmvPortrait();
				});
				if (!isProjectorSlave) {
					wrap.onn("mousedown", evt => {
						if (evt.button !== 0) return;
						if (evt.target.closest?.(".rd__dmv-token-del, .rd__dmv-token-projvis, .rd__dmv-token-resize, .rd__dmv-token-rotate, .rd__dmv-token-stack, .rd__dmv-token-stack-wrap")) return;
						const mode = evt.shiftKey ? "toggle" : (EventUtil.isCtrlMetaKey(evt) ? "add" : "replace");
						dmvSelectToken(t.id, {mode, focusWrap: wrap});
					});
				}
				wrap.onn("focusin", () => {
					tokenChromeFocus = true;
					refreshTokenChrome();
				});
				wrap.onn("focusout", () => {
					tokenChromeFocus = false;
					refreshTokenChrome();
				});

				btnStackFwd.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.stopPropagation();
				});
				btnStackFwd.onn("click", evt => {
					evt.preventDefault();
					evt.stopPropagation();
					dmvSwapTokenStackOrder(t, "forward");
				});
				btnStackBack.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.stopPropagation();
				});
				btnStackBack.onn("click", evt => {
					evt.preventDefault();
					evt.stopPropagation();
					dmvSwapTokenStackOrder(t, "backward");
				});

				img.onn("error", () => {
					const kindLabel = t.kind === "asset" ? "asset" : "creature";
					JqueryUtil.doToast({type: "warning", content: `${kindLabel === "asset" ? "Asset" : "Token"} image failed to load (${t.label || kindLabel}).`});
					img.attr("src", "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7");
				});

				if (btnProjectorVis) {
					btnProjectorVis.onn("mousedown", evt => {
						if (evt.button !== 0) return;
						evt.stopPropagation();
					});
					btnProjectorVis.onn("click", evt => {
						evt.preventDefault();
						evt.stopPropagation();
						t.projectorHidden = !RenderMap._dmvIsProjectorHidden(t);
						if (RenderMap._dmvIsProjectorHidden(t) && portraitHoverTokenId === t.id) {
							hideDmvPortrait({immediate: true});
						}
						refreshTokens();
						saveTokens();
					});
				}

				btnDel.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.stopPropagation();
				});
				btnDel.onn("click", evt => {
					evt.preventDefault();
					evt.stopPropagation();
					const label = (t.label || "").trim();
					const isAsset = t.kind === "asset";
					const msg = isAsset
						? (label ? `Remove asset "${label}" from this map?` : `Remove this asset from the map?`)
						: (label ? `Remove token "${label}" from this map?` : `Remove this token from the map?`);
					const dlgWin = evt.view ?? btnDel.ownerDocument?.defaultView ?? globalThis;
					if (!dlgWin.confirm(msg)) return;
					const ix = mapData.placedTokens.indexOf(t);
					if (ix >= 0) mapData.placedTokens.splice(ix, 1);
					dmvGetSelectedIds().delete(t.id);
					if (!isProjectorSlave && t.kind !== "asset") hideDmvPortrait({immediate: true});
					refreshTokens();
					saveTokens();
				});

				hResize.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.preventDefault();
					evt.stopPropagation();
					const r0 = wrap.getBoundingClientRect();
					const cx0 = r0.left + r0.width / 2;
					const cy0 = r0.top + r0.height / 2;
					const startDist = Math.hypot(
						EventUtil.getClientX(evt) - cx0,
						EventUtil.getClientY(evt) - cy0,
					);
					const startScale = t.scale || 1;
					const minStart = 8;
					const effStart = Math.max(startDist, minStart);

					const onMove = ev => {
						const d = Math.hypot(
							EventUtil.getClientX(ev) - cx0,
							EventUtil.getClientY(ev) - cy0,
						);
						t.scale = Math.max(0.2, Math.min(12, startScale * (Math.max(d, minStart) / effStart)));
						applyTokenDom(t, tokenEls);
					};
					const onUp = () => {
						getDragBody()
							.off("mousemove", onMove)
							.off("mouseup", onUp);
						applyTokenDom(t, tokenEls);
						saveTokens();
					};
					getDragBody()
						.onn("mousemove", onMove)
						.onn("mouseup", onUp);
				});

				hRotate.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.preventDefault();
					evt.stopPropagation();
					const r0 = wrap.getBoundingClientRect();
					const cx0 = r0.left + r0.width / 2;
					const cy0 = r0.top + r0.height / 2;
					const clientAng = (ex, ey) => Math.atan2(ey - cy0, ex - cx0) * 180 / Math.PI;
					const aStart = clientAng(EventUtil.getClientX(evt), EventUtil.getClientY(evt));
					const rotStart = t.rotation || 0;
					const onMove = ev => {
						const aNow = clientAng(EventUtil.getClientX(ev), EventUtil.getClientY(ev));
						let d = aNow - aStart;
						while (d > 180) d -= 360;
						while (d < -180) d += 360;
						t.rotation = rotStart + d;
						applyTokenDom(t, tokenEls);
					};
					const onUp = () => {
						getDragBody()
							.off("mousemove", onMove)
							.off("mouseup", onUp);
						applyTokenDom(t, tokenEls);
						saveTokens();
					};
					getDragBody()
						.onn("mousemove", onMove)
						.onn("mouseup", onUp);
				});

				img.onn("mousedown", evt => {
					if (evt.button !== 0) return;
					evt.preventDefault();
					evt.stopPropagation();
					if (!isProjectorSlave) {
						const mode = evt.shiftKey ? "toggle" : (EventUtil.isCtrlMetaKey(evt) ? "add" : "replace");
						dmvSelectToken(t.id, {mode, focusWrap: wrap});
					}
					const startClient = [EventUtil.getClientX(evt), EventUtil.getClientY(evt)];
					const startMap = [t.mapX, t.mapY];
					const onMove = ev => {
						const zz = mapData.zoomLevel;
						const dx = (EventUtil.getClientX(ev) - startClient[0]) / zz;
						const dy = (EventUtil.getClientY(ev) - startClient[1]) / zz;
						t.mapX = startMap[0] + dx;
						t.mapY = startMap[1] + dy;
						applyTokenDom(t, tokenEls);
					};
					const onUp = ev => {
						getDragBody()
							.off("mousemove", onMove)
							.off("mouseup", onUp);
						// Free placement by default; hold Shift on release to snap to the map grid.
						if (ev?.shiftKey && mapData.grid?.size != null && mapData.grid.type !== "none") {
							const gs = Number(mapData.grid.size);
							t.mapX = Math.round(t.mapX / gs) * gs;
							t.mapY = Math.round(t.mapY / gs) * gs;
						}
						applyTokenDom(t, tokenEls);
						saveTokens();
					};
					getDragBody()
						.onn("mousemove", onMove)
						.onn("mouseup", onUp);
				});

				img.onn("wheel", evt => {
					if (evt.shiftKey && !evt.altKey) {
						evt.preventDefault();
						evt.stopPropagation();
						const step = (evt.deltaY < 0 ? 1 : -1) * (evt.ctrlKey ? 15 : 5);
						t.rotation = (t.rotation || 0) + step;
						applyTokenDom(t, tokenEls);
						saveTokens();
						return;
					}
					if (!evt.altKey) return;
					evt.preventDefault();
					evt.stopPropagation();
					const factor = evt.deltaY < 0 ? 1.08 : 1 / 1.08;
					t.scale = Math.max(0.2, Math.min(12, (t.scale || 1) * factor));
					applyTokenDom(t, tokenEls);
					saveTokens();
				}, {passive: false});

				wrpTokens.appends(wrap);
			}
		};

		const dmvSwapTokenStackOrder = (t, direction) => {
			const sorted = [...mapData.placedTokens].sort((a, b) => a.stackZ - b.stackZ);
			const i = sorted.indexOf(t);
			if (i < 0) return;
			const j = direction === "forward" ? i + 1 : i - 1;
			if (j < 0 || j >= sorted.length) return;
			const tmp = sorted[i].stackZ;
			sorted[i].stackZ = sorted[j].stackZ;
			sorted[j].stackZ = tmp;
			refreshTokens();
			saveTokens();
		};

		const getEventPoint = evt => {
			const {top: cvsTopPos, left: cvsLeftPos} = cvs.getBoundingClientRect();
			const clientX = EventUtil.getClientX(evt);
			const clientY = EventUtil.getClientY(evt);

			const cvsSpaceX = clientX - cvsLeftPos;
			const cvsSpaceY = clientY - cvsTopPos;

			const cvsZoomedSpaceX = Math.round((1 / mapData.zoomLevel) * cvsSpaceX);
			const cvsZoomedSpaceY = Math.round((1 / mapData.zoomLevel) * cvsSpaceY);

			return [
				cvsZoomedSpaceX,
				cvsZoomedSpaceY,
			];
		};

		const lastRmbMeta = {
			body: null,
			point: null,
			time: null,
			scrollPos: null,
			fnsCleanup: [],
		};

		cvs
			.onn("click", async evt => {
				const clickPt = getEventPoint(evt);

				const intersectedRegions = RenderMap._getIntersectedRegions(mapData.regions, clickPt);

				// Arbitrarily choose the first region if we intersect multiple
				const intersectedRegion = intersectedRegions[0];
				if (!intersectedRegion) return;

				if (onRegionClick) {
					const handled = await onRegionClick({intersectedRegion, intersectedRegions, clickPt, evt, mapData});
					if (handled) return;
				}

				let preTabForBook = null;
				if (popoutOpenAsNewTab && !(evt.shiftKey && globalThis.BookUtil)) {
					const w = evt?.view?.window ?? window;
					preTabForBook = w.open("", "_blank");
					if (!preTabForBook) {
						JqueryUtil.doToast({type: "warning", content: `Could not open a new window — check your browser's popup blocker.`});
						return;
					}
				}

				const area = await RenderMap._pGetArea(intersectedRegion.area, mapData);

				// When in book mode, shift-click a region to navigate to it
				if (evt.shiftKey && globalThis.BookUtil) {
					if (preTabForBook) preTabForBook.close();
					const oldHash = location.hash;
					location.hash = `#${globalThis.BookUtil.curRender.curBookId},${area.chapter},${UrlUtil.encodeForHash(area.entry.name)},0`;
					if (oldHash.toLowerCase() === location.hash.toLowerCase()) {
						globalThis.BookUtil.isHashReload = true;
						globalThis.BookUtil.booksHashChange();
					}
					return;
				}

				// If the window already exists, maximize it and bring it to the front
				if (mapData.activeWindows[area.entry.id]) {
					if (preTabForBook) preTabForBook.close();
					const windowMeta = mapData.activeWindows[area.entry.id];
					if (windowMeta._winPopup && windowMeta._winPopup.closed) {
						delete mapData.activeWindows[area.entry.id];
					} else {
						windowMeta.doZIndexToFront();
						windowMeta.doMaximize();
						return;
					}
				}

				const areaTitle = area.entry.name || "";
				const areaEleContent = Renderer.hover.getHoverContent_generic(area.entry, {isLargeBookContent: true, depth: area.depth});

				// Open in a real browser tab/window immediately — do not mount the hover shell in the DMV document first
				// (that shell reads as an inline "popup" and can remain visible if pop-out async fails).
				if (popoutOpenAsNewTab) {
					const winPopup = await Renderer.hover.pDoShowBrowserWindow(areaEleContent, {
						title: areaTitle,
						popoutOpenAsNewTab: true,
						existingWindow: preTabForBook || undefined,
					});
					if (!winPopup) return;

					const windowMeta = {
						_winPopup: winPopup,
						doZIndexToFront: () => {
							try { winPopup.focus(); } catch { /* empty */ }
						},
						doMaximize: () => {
							try { winPopup.focus(); } catch { /* empty */ }
						},
					};
					winPopup.addEventListener("beforeunload", () => {
						if (mapData.activeWindows[area.entry.id] === windowMeta) delete mapData.activeWindows[area.entry.id];
					});
					mapData.activeWindows[area.entry.id] = windowMeta;
					return;
				}

				mapData.activeWindows[area.entry.id] = Renderer.hover.getShowWindow(
					areaEleContent,
					Renderer.hover.getWindowPositionExactVisibleBottom(
						EventUtil.getClientX(evt),
						EventUtil.getClientY(evt),
						evt,
					),
					{
						title: areaTitle,
						isPermanent: true,
						isBookContent: true,
						isPopout: false,
						popoutOpenAsNewTab: false,
						cbClose: () => {
							delete mapData.activeWindows[area.entry.id];
						},
					},
				);
			});

		const pOpenBestiaryTokenModal = async clickEvt => {
			// Modal must use the DMV document's window (popout tab/window). UiUtil.getShowModal defaults to
			// the page that loaded utils-ui (adventure); without this, overlay/results go to the wrong document.
			const modalHostWindow =
				clickEvt?.currentTarget?.ownerDocument?.defaultView
				?? clickEvt?.view
				?? globalThis;
			const docUi = modalHostWindow.document;
			if (mapData._dmvTokenModalOpen) {
				// Flag can stick if overlay was removed without cbClose — recover instead of blocking forever.
				if (!docUi.querySelector(".ve-ui-modal__overlay")) mapData._dmvTokenModalOpen = false;
				else return;
			}
			const appWindow = RenderMap._getDmvHostAppWindowForSearch(modalHostWindow);
			const ParserSafe = appWindow.Parser || globalThis.Parser;

			mapData._dmvTokenModalOpen = true;
			const {eleModalInner} = UiUtil.getShowModal({
				title: "Add creature token",
				isMinHeight0: true,
				window: modalHostWindow,
				cbClose: () => {
					mapData._dmvTokenModalOpen = false;
				},
			});

			const iptSearch = ee`<input class="ve-form-control ve-ui-search__ipt-search search ve-mb-2" autocomplete="off" placeholder="Search creatures...">`;
			// DMV map shortcuts (H/J/P) listen on `window` — do not steal keys while typing here.
			iptSearch.onn("keydown", evt => evt.stopPropagation());
			iptSearch.onn("keypress", evt => evt.stopPropagation());
			iptSearch.onn("keyup", evt => evt.stopPropagation());
			const wrpResults = ee`<div class="ve-ui-search__wrp-results ve-flex-col ve-max-h-mobile-500 ve-overflow-y-auto" style="min-height:12rem"></div>`;
			// `.appends` only accepts one node; second arg was ignored — wrpResults must be attached (see dmscreen-initiativetracker-monsteradd.js).
			iptSearch.appendTo(eleModalInner);
			wrpResults.appendTo(eleModalInner);

			const wrpAppendHtmlStr = html => {
				const tpl = docUi.createElement("template");
				tpl.innerHTML = String(html).trim();
				while (tpl.content.firstChild) wrpResults.appendChild(tpl.content.firstChild);
			};

			const flags = {isWait: false, doClickFirst: false};
			const ptrRows = {_: []};
			let tokenSearchGen = 0;
			let isTokenPickerSelecting = false;

			const resetTokenSearchForAnother = () => {
				iptSearch.val("");
				flags.doClickFirst = false;
				flags.isWait = false;
				ptrRows._ = [];
				queueMicrotask(() => {
					void pDoSearchWrapped().then(() => UiUtil.pDoForceFocus(iptSearch));
				});
			};

			const pHandleSelectCreature = async res => {
				if (isTokenPickerSelecting) return;
				isTokenPickerSelecting = true;
				try {
					const DL = appWindow.DataLoader;
					const Url = appWindow.UrlUtil;
					const R = appWindow.Renderer;
					if (!DL || !Url || !R) throw new Error("Bestiary loader unavailable in this window");
					const mon = await DL.pCacheAndGet(Url.PG_BESTIARY, res.doc.s, res.doc.u);
					if (!mon) return;
					const dlgWin = modalHostWindow ?? globalThis;
					let href = R.monster.getTokenUrl(mon);
					const faRel = await RenderMap._pGetDmvFaTokenRelForMonster(mon, appWindow);
					if (faRel) {
						const faHref = R.get().getMediaUrl("img", faRel);
						const useTopdown = dlgWin.confirm(
							`Existe arte de token top-down instalada para "${mon.name}".\n\n`
							+ `OK = usar token top-down\nCancelar = usar token do bestiário`,
						);
						if (useTopdown) href = faHref;
					}
					const placed = {
						id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
						mapX: mapData.width / 2,
						mapY: mapData.height / 2,
						href,
						label: mon.name,
						monSource: res.doc.s,
						monHash: res.doc.u,
						scale: 1,
						rotation: 0,
						baseDiameter: defaultTokenDiameter,
						stackZ: RenderMap._nextDmvPlacedTokenStackZ(mapData.placedTokens),
						projectorHidden: true,
					};
					mapData.placedTokens.push(placed);
					void RenderMap._pResolveDmvTokenPortrait(placed, appWindow).then(() => saveTokens());
					refreshTokens();
					saveTokens();
				} catch (err) {
					JqueryUtil.doToast({type: "warning", content: `Token unavailable for this creature. ${VeCt.STR_SEE_CONSOLE}`});
					setTimeout(() => { throw err; });
				} finally {
					isTokenPickerSelecting = false;
					resetTokenSearchForAnother();
				}
			};

			// Match dmscreen InitiativeTrackerMonsterAdd: Creature-only Lunr index + pGetFilteredResults({searchTerm}) only
			// (avoids pGetResults SRD/partnered defaults and flaky in:monster queries on adventure.html).
			const pDoSearch = async () => {
				const searchGen = ++tokenSearchGen;
				const searchTerm = iptSearch.val().trim();
				let availContent;
				try {
					availContent = await RenderMap._pGetDmvSearchContentIndices(appWindow);
				} catch {
					wrpResults.empty();
					wrpAppendHtmlStr(`<div class="ve-ui-search__message text-danger">Search unavailable.</div>`);
					return;
				}

				const index = availContent.Creature;
				if (!index) {
					wrpResults.empty();
					wrpAppendHtmlStr(`<div class="ve-ui-search__message text-danger">Creature index unavailable.</div>`);
					return;
				}

				const topdownTokenMap = await RenderMap._pLoadDmvFaTokenMap(appWindow);
				if (searchGen !== tokenSearchGen) return;

				const searchCfg = {
					fields: {
						n: {boost: 5, expand: true},
						s: {expand: true},
					},
					bool: "AND",
					expand: true,
				};
				const rawFromIndex = index.search(searchTerm, searchCfg);
				let filtered;
				try {
					filtered = await OmnisearchBacking.pGetFilteredResults(rawFromIndex, {
						searchTerm,
						preferMm2014Creatures: true,
					});
					filtered = RenderMap._dmvDedupeXmmWhenMm2014Present(filtered);
				} catch (err) {
					setTimeout(() => { throw err; });
					filtered = rawFromIndex;
				}

				const resultCount = filtered.length ? filtered.length : index.documentStore.length;
				const toProcess = filtered.length
					? filtered
					: Object.values(index.documentStore.docs).slice(0, RenderMap._DMV_CREATURE_RESULTS_MAX).map(it => ({doc: it}));

				if (searchGen !== tokenSearchGen) return;

				wrpResults.empty();
				ptrRows._ = [];

				if (toProcess.length) {
					flags.isWait = false;
					if (flags.doClickFirst) {
						try {
							await pHandleSelectCreature(toProcess[0]);
						} finally {
							flags.doClickFirst = false;
						}
						return;
					}

					const resultsShown = toProcess.slice(0, RenderMap._DMV_CREATURE_RESULTS_MAX);

					for (const res of resultsShown) {
						const rowEle = docUi.createElement("div");
						rowEle.className = "ve-ui-search__row ve-flex-v-center ve-clickable";
						rowEle.tabIndex = 0;
						const spName = docUi.createElement("span");
						spName.textContent = res.doc.n ?? "";
						const faKey = RenderMap._normalizeDmvFaCreatureName(res.doc.n ?? "");
						if (faKey && topdownTokenMap[faKey]) {
							const spFa = docUi.createElement("span");
							spFa.className = "ve-small ve-ml-1 ve-no-shrink";
							spFa.title = "Token top-down disponível (pack FA ou FREE em img/hdq; escolha ao adicionar)";
							spFa.textContent = "TD";
							spFa.style.cssText = "font-size:0.62rem;font-weight:700;letter-spacing:0.02em;padding:1px 4px;border-radius:3px;border:1px solid rgba(51,122,183,0.45);background:rgba(51,122,183,0.12);color:#337ab7;line-height:1.2;";
							rowEle.append(spName, spFa);
						} else {
							rowEle.append(spName);
						}
						const spSrc = docUi.createElement("span");
						spSrc.className = "ve-muted ve-small ve-ml-auto";
						try {
							spSrc.textContent = res.doc.s && ParserSafe ? ParserSafe.sourceJsonToAbv(res.doc.s) : "";
						} catch {
							spSrc.textContent = "";
						}
						rowEle.append(spSrc);
						const row = globalThis.e_({ele: rowEle});
						SearchWidget.bindRowHandlers({
							result: res,
							row,
							ptrRows,
							fnHandleClick: pHandleSelectCreature,
							iptSearch,
						});
						row.appendTo(wrpResults);
						ptrRows._.push(row);
					}

					if (resultCount > RenderMap._DMV_CREATURE_RESULTS_MAX) {
						const diff = resultCount - RenderMap._DMV_CREATURE_RESULTS_MAX;
						wrpAppendHtmlStr(`<div class="ve-ui-search__row ve-ui-search__row--readonly">...${diff} more result${diff === 1 ? " was" : "s were"} hidden. Refine your search!</div>`);
					}
				} else if (!searchTerm.trim()) {
					flags.isWait = true;
					wrpAppendHtmlStr(SearchWidget.getSearchEnter());
				} else {
					flags.isWait = false;
					wrpAppendHtmlStr(SearchWidget.getSearchNoResults());
				}
			};

			const pDoSearchWrapped = async () => {
				try {
					await pDoSearch();
				} catch (err) {
					flags.isWait = false;
					flags.doClickFirst = false;
					setTimeout(() => { throw err; });
					wrpResults.empty();
					wrpAppendHtmlStr(`<div class="ve-ui-search__message text-danger">Search failed. Try again.</div>`);
				}
			};

			SearchWidget.bindAutoSearch(iptSearch, {
				flags,
				pFnSearch: pDoSearchWrapped,
				fnShowWait: () => {
					wrpResults.empty();
					wrpAppendHtmlStr(SearchWidget.getSearchLoading());
				},
				ptrRows,
			});

			iptSearch.focuse();
			await pDoSearchWrapped();
		};

		const pOpenAssetLibraryModal = async clickEvt => {
			const modalHostWindow =
				clickEvt?.currentTarget?.ownerDocument?.defaultView
				?? clickEvt?.view
				?? globalThis;
			const appWindow = RenderMap._getDmvHostAppWindowForSearch(modalHostWindow);
			const docUi = modalHostWindow.document;
			const Rget = appWindow.Renderer?.get?.() ?? globalThis.Renderer?.get?.();
			if (!Rget?.getMediaUrl) {
				JqueryUtil.doToast({type: "warning", content: "Renderer unavailable to load assets."});
				return;
			}

			const assets = await RenderMap._pLoadDmvAssetManifest(appWindow);

			const {eleModalInner, doClose} = UiUtil.getShowModal({
				title: "Adicionar asset ao mapa",
				isMinHeight0: true,
				window: modalHostWindow,
			});

			const iptSearch = ee`<input class="ve-form-control ve-ui-search__ipt-search search ve-mb-2" autocomplete="off" placeholder="Filtrar… (≥2 letras se tens muitos assets)">`;
			const wrpGrid = ee`<div class="ve-flex ve-flex-wrap ve-overflow-y-auto ve-max-h-mobile-500" style="min-height:12rem;gap:0.35rem;"></div>`;
			iptSearch.appendTo(eleModalInner);
			wrpGrid.appendTo(eleModalInner);

			const ASSET_LIB_LARGE = 500;
			const ASSET_FILTER_MIN = 2;
			const ASSET_GRID_MAX = 400;

			const categoryFromAssetRel = rel => {
				const norm = String(rel || "").replace(/\\/g, "/");
				const low = norm.toLowerCase();
				const needle = "hdq/fa-assets/";
				const idx = low.indexOf(needle);
				if (idx < 0) return "_outro";
				const rest = norm.slice(idx + needle.length);
				const seg = rest.split("/").filter(Boolean)[0];
				return seg || "_outro";
			};

			const appendAssetThumbCell = a => {
				const cell = docUi.createElement("button");
				cell.type = "button";
				cell.className = "ve-btn ve-btn-default ve-flex-col ve-align-items-center ve-p-1";
				cell.style.cssText = "width:5.5rem;min-height:5.5rem;";
				const thumb = docUi.createElement("img");
				thumb.alt = "";
				thumb.loading = "lazy";
				thumb.draggable = false;
				thumb.crossOrigin = "anonymous";
				thumb.style.cssText = "width:4rem;height:4rem;object-fit:contain;display:block;";
				thumb.src = Rget.getMediaUrl("img", a.rel);
				const cap = docUi.createElement("span");
				cap.className = "ve-small ve-text-left";
				cap.style.cssText = "max-width:5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
				cap.textContent = a.name || a.rel;
				cap.title = a.name || a.rel;
				cell.append(thumb, cap);
				cell.addEventListener("click", () => {
					const href = Rget.getMediaUrl("img", a.rel);
					mapData.placedTokens.push({
						id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
						kind: "asset",
						assetId: a.id,
						mapX: mapData.width / 2,
						mapY: mapData.height / 2,
						href,
						label: a.name || a.rel,
						scale: 1,
						rotation: 0,
						baseDiameter: defaultTokenDiameter,
						stackZ: RenderMap._nextDmvPlacedTokenStackZ(mapData.placedTokens),
						projectorHidden: true,
					});
					doClose();
					refreshTokens();
					saveTokens();
				});
				wrpGrid.appendChild(cell);
			};

			const renderGridCore = () => {
				const q = String(iptSearch.val() || "").trim().toLowerCase();
				wrpGrid.empty();
				if (!assets.length) {
					const p = docUi.createElement("p");
					p.className = "ve-muted ve-small";
					p.textContent = "Sem entradas no manifesto. Se já tens imagens em img/hdq/fa-assets/, na raiz do projeto corre node tools/generate-dmv-asset-manifest.mjs e recarrega a página (ou RenderMap.clearDmvAssetManifestCache() na consola). Vê img/hdq/fa-assets/README.txt";
					wrpGrid.appendChild(p);
					return;
				}
				if (assets.length > ASSET_LIB_LARGE && q.length < ASSET_FILTER_MIN) {
					const p = docUi.createElement("p");
					p.className = "ve-muted ve-small";
					p.textContent = `Biblioteca com ${assets.length} assets (manifesto grande). Escreve pelo menos ${ASSET_FILTER_MIN} caracteres no filtro para listar miniaturas (máx. ${ASSET_GRID_MAX} por pesquisa).`;
					wrpGrid.appendChild(p);
					return;
				}
				const filtered = !q
					? assets
					: assets.filter(a => {
						const n = String(a.name || "").toLowerCase();
						const r = String(a.rel || "").toLowerCase();
						return n.includes(q) || r.includes(q);
					});
				if (!filtered.length) {
					const p = docUi.createElement("p");
					p.className = "ve-muted";
					p.textContent = "Nenhum resultado.";
					wrpGrid.appendChild(p);
					return;
				}
				const total = filtered.length;
				/** @type {Map<string, Array>} */
				const buckets = new Map();
				for (const a of filtered) {
					const cat = categoryFromAssetRel(a.rel);
					if (!buckets.has(cat)) buckets.set(cat, []);
					buckets.get(cat).push(a);
				}
				const catsSorted = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
				const numCats = catsSorted.length;
				let totalShown = 0;

				if (numCats <= 1) {
					const slice = filtered.slice(0, ASSET_GRID_MAX);
					for (const a of slice) appendAssetThumbCell(a);
					totalShown = slice.length;
				} else {
					const perCat = Math.max(6, Math.floor(ASSET_GRID_MAX / numCats));
					for (const cat of catsSorted) {
						const arr = buckets.get(cat) || [];
						const take = arr.slice(0, Math.min(perCat, arr.length));
						if (!take.length) continue;
						const h = docUi.createElement("div");
						h.className = "ve-w-100 ve-small";
						h.style.cssText = "flex-basis:100%;margin-top:0.45rem;font-weight:600;opacity:0.88;padding:0.15rem 0;border-bottom:1px solid rgba(0,0,0,0.1);";
						const extra = arr.length > take.length ? ` — ${take.length} de ${arr.length}` : ` — ${arr.length}`;
						h.textContent = `${cat}${extra}`;
						wrpGrid.appendChild(h);
						for (const a of take) appendAssetThumbCell(a);
						totalShown += take.length;
					}
				}

				if (total > totalShown) {
					const more = docUi.createElement("p");
					more.className = "ve-small ve-muted ve-w-100";
					more.style.cssText = "flex-basis:100%;";
					const perCatCap = numCats > 1 ? Math.max(6, Math.floor(ASSET_GRID_MAX / numCats)) : ASSET_GRID_MAX;
					const catNote = numCats > 1 ? ` (${numCats} categorias, até ${perCatCap} miniaturas por categoria)` : "";
					more.textContent = `Mostrando ${totalShown} de ${total} resultados${catNote} — afinar a pesquisa para ver mais.`;
					wrpGrid.appendChild(more);
				}
			};

			const renderGridDebounced = MiscUtil.debounce(renderGridCore, 120);
			iptSearch.onn("input", renderGridDebounced);
			iptSearch.focuse();
			renderGridCore();
		};

		const btnZoomMinus = ee`<button class="ve-btn ve-btn-xs ve-btn-default"><span class="glyphicon glyphicon-zoom-out"></span> Zoom Out</button>`
			.onn("click", () => zoomChange("out"));

		const btnZoomPlus = ee`<button class="ve-btn ve-btn-xs ve-btn-default"><span class="glyphicon glyphicon-zoom-in"></span> Zoom In</button>`
			.onn("click", () => zoomChange("in"));

		const btnZoomFitWidth = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default" title="Zoom to fit map width in the view (scroll vertically for the rest) — atalho H"><span class="glyphicon glyphicon-resize-horizontal"></span> Zoom to Fit</button>`
			.onn("click", () => zoomChange("fitWidth"));

		const btnZoomFitHeight = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default" title="Fit map height to the view (scroll horizontally for the rest) — atalho J"><span class="glyphicon glyphicon-resize-vertical"></span> Zoom Fit Height</button>`
			.onn("click", () => zoomChange("fitHeight"));

		const btnZoomFill = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Fill the view with the map (edges may be cropped)"><span class="glyphicon glyphicon-resize-full"></span> Zoom to Fill</button>`
			.onn("click", () => zoomChange("fill"));

		const btnHelp = ee`<button class="ve-btn ve-btn-xs ve-btn-default ve-ml-auto ve-mr-2" title="Help"><span class="glyphicon glyphicon-info-sign"></span> Help</button>`
			.onn("click", evt => {
				const {eleModalInner} = UiUtil.getShowModal({
					title: "Help",
					isMinHeight0: true,
					window: evt.view?.window,
				});

				eleModalInner.appends(`
					<p><i>Use of the &quot;Open as Popup Window&quot; button in the window title bar is recommended.</i></p>
					<ul>
						<li>Left-click to open an area as a new window.</li>
						<li><kbd>SHIFT</kbd>-left-click to jump to an area.</li>
						<li>Right-click and drag to pan (master and projection window).</li>
						<li><kbd>CTRL</kbd>-scroll to zoom (smooth, centred on cursor).</li>
						<li><b>Zoom to Fit</b> scales to the viewport width (pan vertically) — <kbd>H</kbd>; <b>Zoom Fit Height</b> scales to the viewport height (pan horizontally) — <kbd>J</kbd>; <b>Zoom to Fill</b> uses the full viewport (may crop).</li>
						${!isProjectorSlave ? "<li><b>Projetar</b> / <b>Parar projeção</b> abre ou fecha a janela espelhada para jogadores.</li><li><b>Enviar zoom</b> (ou <kbd>P</kbd> no mapa do mestre) aplica no projector o zoom e pan atuais do mestre. Na janela de projeção: <kbd>H</kbd> / <kbd>J</kbd> ajustam o zoom local (só na tela dos jogadores).</li><li>Novos tokens começam <b>ocultos na projeção</b> (contorno tracejado no mestre). <b>Shift+clique</b> seleciona vários; <b>Revelar</b> / <b>Ocultar</b> na barra ou o ícone de olho em cada token.</li>" : ""}
						${isProjectorSlave ? "<li><kbd>H</kbd> Zoom to Fit (largura); <kbd>J</kbd> Zoom Fit Height — só nesta janela de projeção.</li>" : ""}
						${enableCreatureTokens ? "<li><b>Add token</b> picks a creature from the bestiary; if a top-down file exists under <code>img/hdq/fa-tokens/</code> or <code>img/hdq/free-tokens/</code> (Forgotten Adventures overrides FREE on the same creature), you are prompted to use it or the default bestiary token. List rows show <b>TD</b> when a top-down path is mapped. Remove individual tokens with <b>×</b> on each piece.</li>" : ""}
						${enableAssetLib ? "<li><b>Add asset</b> uses <code>data/hdq/dmv-asset-manifest.json</code> (run <code>node tools/generate-dmv-asset-manifest.mjs</code> after copying into <code>img/hdq/fa-assets/</code>; reload the page to refresh the cached manifest). Large libraries: type at least <b>2</b> characters to show thumbnails (max 400 matches). Same drag, resize, rotate, and delete (<b>×</b>) as tokens.</li>" : ""}
						${enablePlacedLayer && !isProjectorSlave ? "<li>Click a token or asset to select it (blue outline). <kbd>CTRL</kbd>+<kbd>C</kbd> / <kbd>CTRL</kbd>+<kbd>V</kbd> copy and paste (works in popout windows). Each paste is offset slightly on the grid.</li>" : ""}
						${enablePlacedLayer ? "<li>Drag the image to move freely; release with <kbd>SHIFT</kbd> held to snap to the grid. Top-left handle to resize; bottom-right <b>↻</b> (or <kbd>SHIFT</kbd>+scroll on the image) to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes one (confirm); eye icon toggles projection visibility. Bottom-left <b>▲</b><b>▼</b> (on hover) change stacking order among tokens and assets.</li>" : ""}
						${!isProjectorSlave && enableCreatureTokens ? "<li>Hover a <b>creature token</b> (master map) to show its <b>Images</b> tab art from the bestiary (fluff) on this window and on the projection.</li>" : ""}
						${hasPoiRegions && !isProjectorSlave ? "<li><b>POI</b> alterna os marcadores <b>i</b> dos pontos de interesse no mapa (útil para alinhar ou limpar a vista na mesa).</li>" : ""}
						${helpExtraHtml}
					</ul>
				`);
			});

		const onMouseWheelCanvas = evt => {
			if (!EventUtil.isCtrlMetaKey(evt)) return;
			evt.stopPropagation();
			evt.preventDefault();
			zoomChangeWheel(evt);
		};

		const scrollerBg = mapData.expectsLightBackground ? "ve-rd__scroller-viewer--bg-light" : mapData.expectsDarkBackground ? "ve-rd__scroller-viewer--bg-dark" : "";
		const scrollerClass = `ve-w-100 ve-h-100 ve-overflow-x-scroll ve-overflow-y-scroll ve-rd__scroller-viewer ${isProjectorSlave ? "ve-rd__scroller-viewer--projector " : ""}${scrollerBg}`;
		const wrpCvs = ee`<div class="${scrollerClass}">
			${wrpMapStack}
		</div>`
			.onn("wheel", onMouseWheelCanvas, {passive: false});

		if (isProjectorSlave) {
			// Igual ao mestre: scroller ocupa o espaço vertical restante (toolbar escondida colapsa).
			wrpCvs.css({flex: "1 1 auto", minHeight: 0, cursor: "grab"});
		}

		if (enablePlacedLayer) {
			wrpCvs.onn("mousedown", evt => {
				if (evt.button !== 0) return;
				if (!isProjectorSlave && evt.target.closest?.(".rd__dmv-token-wrap")) return;
				if (!isProjectorSlave) dmvClearTokenSelection();
				out.focuse?.();
			});
		}

		wrpCvs.onn("mousedown", evt => {
			if (evt.button !== 2) return; // RMB — on scroller so projector (canvas pointer-events: none) can pan too

			wrpCvs.style.cursor = "grabbing";

			lastRmbMeta.fnsCleanup.forEach(fn => fn());

			lastRmbMeta.body ||= e_({ele: wrpCvs.ownerDocument?.body ?? out.closeste("body")});
			lastRmbMeta.point = [EventUtil.getClientX(evt), EventUtil.getClientY(evt)];
			lastRmbMeta.time = Date.now();
			lastRmbMeta.scrollPos = [wrpCvs.scrollLeft, wrpCvs.scrollTop];
			lastRmbMeta.fnsCleanup = [];

			const onMouseUpBody = evtUp => {
				if (evtUp.button !== 2) return;

				lastRmbMeta.body
					.off(`mouseup`, onMouseUpBody)
					.off(`mousemove`, onMouseMoveBody);

				wrpCvs.style.cursor = isProjectorSlave ? "grab" : "";

				lastRmbMeta.point = null;
				lastRmbMeta.time = null;
				lastRmbMeta.scrollPos = null;
			};

			const onMouseMoveBody = evtMove => {
				if (lastRmbMeta.point == null) return;

				const movePt = [EventUtil.getClientX(evtMove), EventUtil.getClientY(evtMove)];

				const diffX = lastRmbMeta.point[X] - movePt[X];
				const diffY = lastRmbMeta.point[Y] - movePt[Y];

				lastRmbMeta.time = Date.now();

				wrpCvs.scrollTo(
					lastRmbMeta.scrollPos[X] + diffX,
					lastRmbMeta.scrollPos[Y] + diffY,
				);

				if (isProjectorSlave && mapData.zoomLevel > 0) {
					mapData._dmvSyncMapOrigin = {
						mx: wrpCvs.scrollLeft / mapData.zoomLevel,
						my: wrpCvs.scrollTop / mapData.zoomLevel,
					};
				}
			};

			const onContextMenuBody = evtCtx => {
				evtCtx.stopPropagation();
				evtCtx.preventDefault();

				lastRmbMeta.body.off(`contextmenu`, onContextMenuBody);
			};

			lastRmbMeta.fnsCleanup.push(
				() => {
					lastRmbMeta.body
						.off("mouseup", onMouseUpBody)
						.off("mousemove", onMouseMoveBody)
						.off("contextmenu", onContextMenuBody);
				},
			);

			lastRmbMeta.body
				.onn("mouseup", onMouseUpBody)
				.onn("mousemove", onMouseMoveBody)
				.onn(`contextmenu`, onContextMenuBody);
		});

		const postProjectorSync = ({applySlaveZoom = false} = {}) => {
			if (isProjectorSlave || !mapData._dmvProjectorBc) return;
			try {
				mapData._dmvProjectorBc.postMessage({
					type: "dmvSync",
					masterZoomLevel: mapData.zoomLevel,
					scrollLeft: wrpCvs.scrollLeft,
					scrollTop: wrpCvs.scrollTop,
					placedTokens: JSON.parse(JSON.stringify(
						RenderMap._dmvTokensForProjector(mapData.placedTokens || []),
					)),
					...(applySlaveZoom ? {applySlaveZoom: true} : {}),
				});
			} catch { /* empty */ }
		};

		publishProjectorState = MiscUtil.debounce(() => postProjectorSync(), 35);
		mapData._dmvPublishProjectorState = publishProjectorState;

		pushProjectorZoom = () => postProjectorSync({applySlaveZoom: true});
		mapData._dmvPushProjectorZoom = pushProjectorZoom;

		publishPortrait = ({show = false, label = "", imagePath = null, tokenHref = null} = {}) => {
			if (isProjectorSlave || !mapData._dmvProjectorBc) return;
			try {
				mapData._dmvProjectorBc.postMessage({
					type: "dmvPortrait",
					show: !!show,
					label: label || "",
					imagePath: imagePath || null,
					tokenHref: tokenHref || null,
				});
			} catch { /* empty */ }
		};

		wrpCvs.onn("scroll", () => {
			if (!isProjectorSlave) publishProjectorState();
		});

		if (isProjectorSlave) {
			cvs.css({pointerEvents: "none"});
		}

		if (isProjectorSlave && projectorSyncChannelId && typeof BroadcastChannel !== "undefined") {
			mapData._dmvSyncMapOrigin = {mx: 0, my: 0};
			const applySlaveScrollFromMasterPan = () => {
				const o = mapData._dmvSyncMapOrigin;
				if (!o || mapData.zoomLevel <= 0) return;
				const maxX = Math.max(0, wrpCvs.scrollWidth - wrpCvs.clientWidth);
				const maxY = Math.max(0, wrpCvs.scrollHeight - wrpCvs.clientHeight);
				const sl = Math.round(o.mx * mapData.zoomLevel);
				const st = Math.round(o.my * mapData.zoomLevel);
				wrpCvs.scrollLeft = Math.max(0, Math.min(sl, maxX));
				wrpCvs.scrollTop = Math.max(0, Math.min(st, maxY));
			};
			const bcIn = new BroadcastChannel(`${RenderMap._DMV_BC_PREFIX}${projectorSyncChannelId}`);
			mapData._dmvProjectorListenBc = bcIn;
			bcIn.onmessage = (ev289) => {
				const d = ev289.data;
				if (!d) return;
				if (d.type === "dmvPortrait") {
					mutPortraitPanel({
						show: !!d.show,
						label: d.label || "",
						imagePath: d.imagePath || null,
						tokenHref: d.tokenHref || null,
					});
					return;
				}
				if (d.type !== "dmvSync") return;
				try {
					const mzRaw = d.masterZoomLevel ?? d.zoomLevel;
					const mz = RenderMap._getValidZoomInfo({
						width: mapData.width,
						height: mapData.height,
						zoomLevel: mzRaw,
					}).zoomLevel;
					if (!(mz > 0)) return;
					mapData._dmvSyncMapOrigin = {
						mx: (d.scrollLeft | 0) / mz,
						my: (d.scrollTop | 0) / mz,
					};
					mapData.placedTokens = JSON.parse(JSON.stringify(d.placedTokens || []));
					refreshTokens();
					if (d.applySlaveZoom && !Parser.isNumberNearEqual(mz, mapData.zoomLevel)) {
						const zoomInfo = RenderMap._getValidZoomInfo({
							width: mapData.width,
							height: mapData.height,
							zoomLevel: mz,
						});
						mapData.zoomLevel = zoomInfo.zoomLevel;
						cvs.width = zoomInfo.widthZoomed;
						cvs.height = zoomInfo.heightZoomed;
						paint();
						mutTokenLayerSize();
						refreshTokens();
					}
					applySlaveScrollFromMasterPan();
				} catch { /* empty */ }
			};
			const winV = wrpCvs.ownerDocument?.defaultView;
			winV?.addEventListener("beforeunload", () => {
				try { bcIn.close(); } catch { /* empty */ }
				try { mapData._dmvSlaveScrollerRo?.disconnect(); } catch { /* empty */ }
				mapData._dmvSlaveScrollerRo = null;
			});
			if (typeof ResizeObserver !== "undefined") {
				const roSl = new ResizeObserver(() => applySlaveScrollFromMasterPan());
				roSl.observe(wrpCvs);
				mapData._dmvSlaveScrollerRo = roSl;
			}
		}

		const btnFullscreen = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Fullscreen map area (ESC to exit)"><span class="glyphicon glyphicon-fullscreen"></span> Fullscreen</button>`
			.onn("click", async evt => {
				const rawEl = wrpCvs;
				const doc = rawEl?.ownerDocument || document;
				try {
					if (doc.fullscreenElement === rawEl) await doc.exitFullscreen();
					else if (rawEl?.requestFullscreen) await rawEl.requestFullscreen();
				} catch {
					JqueryUtil.doToast({type: "warning", content: "Fullscreen not available."});
				}
			});

		const btnProjetar = !isProjectorSlave
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-primary ve-mr-2" title="Abre vista espelhada para o projector (pan e tokens sincronizados; zoom independente até Enviar zoom)"><span class="glyphicon glyphicon-modal-window"></span> Projetar</button>`
				.onn("click", async evt => {
					if (RenderMap._isDmvProjectorMirrorOpen(mapData)) {
						RenderMap._closeDmvProjectorMirror(mapData);
						return;
					}
					await RenderMap._pOpenDmvProjectorMirror(evt, {mapData, masterWrpCvs: wrpCvs, contentOpts: opts, btnProjetar});
				})
			: null;

		if (btnProjetar) {
			mapData._dmvProjectorBtn = btnProjetar;
			RenderMap._mutDmvProjectorBtnUi(btnProjetar, mapData);
		}

		const btnEnviarZoom = !isProjectorSlave
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Aplica no projector o zoom e enquadramento atuais deste mapa (atalho P)"><span class="glyphicon glyphicon-share"></span> Enviar zoom</button>`
				.onn("click", () => pushProjectorZoom())
			: null;

		const btnRevealProjector = !isProjectorSlave && enablePlacedLayer
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-success ve-mr-2" title="Mostra os tokens/assets selecionados na janela de projeção (Shift+clique para selecionar vários)"><span class="glyphicon glyphicon-eye-open"></span> Revelar</button>`
				.onn("click", () => {
					const ids = dmvGetSelectedIds();
					if (!ids.size) {
						JqueryUtil.doToast({type: "warning", content: "Selecione um ou mais tokens (Shift+clique para vários)."});
						return;
					}
					const n = dmvSetProjectorHiddenForIds(ids, false);
					JqueryUtil.doToast({type: "success", content: `${n} token${n === 1 ? "" : "s"} visíve${n === 1 ? "l" : "is"} na projeção.`});
				})
			: null;

		const btnHideProjector = !isProjectorSlave && enablePlacedLayer
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Oculta os selecionados da projeção (continuam visíveis no mapa do mestre)"><span class="glyphicon glyphicon-eye-close"></span> Ocultar</button>`
				.onn("click", () => {
					const ids = dmvGetSelectedIds();
					if (!ids.size) {
						JqueryUtil.doToast({type: "warning", content: "Selecione um ou mais tokens (Shift+clique para vários)."});
						return;
					}
					const n = dmvSetProjectorHiddenForIds(ids, true);
					JqueryUtil.doToast({type: "success", content: `${n} token${n === 1 ? "" : "s"} oculto${n === 1 ? "" : "s"} na projeção.`});
				})
			: null;

		const btnAddToken = enableCreatureTokens
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Add creature from bestiary"><span class="glyphicon glyphicon-plus"></span> Add Token</button>`
				.onn("click", evt => { pOpenBestiaryTokenModal(evt); })
			: null;

		const btnAddAsset = enableAssetLib
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Add scenery asset from library"><span class="glyphicon glyphicon-picture"></span> Add Asset</button>`
				.onn("click", evt => { pOpenAssetLibraryModal(evt); })
			: null;

		const hasPoiRegions = !!mapData.regions?.length;
		const btnTogglePoi = !isProjectorSlave && hasPoiRegions
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-mr-2" title="Ocultar marcadores de POI no mapa"><span class="glyphicon glyphicon-map-marker"></span> POI</button>`
			: null;

		const mutBtnTogglePoiUi = () => {
			if (!btnTogglePoi) return;
			btnTogglePoi
				.toggleClass("ve-btn-primary", showPoiMarkers)
				.toggleClass("ve-btn-default", !showPoiMarkers)
				.attr("title", showPoiMarkers
					? "Ocultar marcadores de POI no mapa"
					: "Mostrar marcadores de POI no mapa");
		};

		if (btnTogglePoi) {
			btnTogglePoi.onn("click", () => {
				showPoiMarkers = !showPoiMarkers;
				mutBtnTogglePoiUi();
				paint();
			});
			mutBtnTogglePoiUi();
		}

		const toolbarRow = ee`<div class="ve-flex ve-no-shrink ve-p-2 ve-flex-wrap ve-align-items-center"></div>`;
		toolbarRow.appends(
			ee`<div class="ve-btn-group ve-flex ve-mr-2">${btnZoomMinus}${btnZoomPlus}${btnZoomFitWidth}${btnZoomFitHeight}</div>`,
			btnZoomFill,
			btnFullscreen,
		);
		if (!isProjectorSlave) {
			if (btnProjetar) toolbarRow.appends(btnProjetar);
			if (btnEnviarZoom) toolbarRow.appends(btnEnviarZoom);
			if (btnRevealProjector) toolbarRow.appends(btnRevealProjector);
			if (btnHideProjector) toolbarRow.appends(btnHideProjector);
			if (btnAddToken) toolbarRow.appends(btnAddToken);
			if (btnAddAsset) toolbarRow.appends(btnAddAsset);
			if (btnTogglePoi) toolbarRow.appends(btnTogglePoi);
		}
		toolbarRow.appends(btnHelp);

		const elePortraitTitle = ee`<div class="rd__dmv-portrait-panel__title"></div>`;
		const imgPortrait = ee`<img alt="" class="rd__dmv-portrait-panel__img" crossorigin="anonymous">`;
		const wrpPortraitImg = ee`<div class="rd__dmv-portrait-panel__img-wrap">${imgPortrait}</div>`;
		const portraitPanel = ee`<div class="rd__dmv-portrait-panel ve-hidden" aria-hidden="true">${elePortraitTitle}${wrpPortraitImg}</div>`;
		if (isProjectorSlave) portraitPanel.addClass("rd__dmv-portrait-panel--projector");

		mutPortraitPanel = ({show, label, imagePath, portraitUrl, tokenHref}) => {
			if (!show) {
				portraitPanel.addClass("ve-hidden").attr("aria-hidden", "true");
				imgPortrait.attr("src", "");
				return;
			}
			const win = portraitPanel.ownerDocument?.defaultView ?? globalThis;
			const Rget = win.Renderer?.get?.();
			let src = portraitUrl || "";
			if (!src && imagePath && Rget) src = Rget.getMediaUrl("img", imagePath);
			if (!src) src = tokenHref || "";
			elePortraitTitle.txt(label || "");
			imgPortrait.attr("src", src).attr("alt", label || "");
			portraitPanel.removeClass("ve-hidden").attr("aria-hidden", "false");
		};

		hideDmvPortrait = ({immediate = false} = {}) => {
			clearTimeout(portraitShowTimer);
			portraitShowTimer = null;
			clearTimeout(portraitHideTimer);
			portraitHideTimer = null;
			portraitHoverTokenId = null;
			const go = () => {
				mutPortraitPanel({show: false});
				publishPortrait({show: false});
			};
			if (immediate) go();
			else portraitHideTimer = setTimeout(go, 100);
		};

		const out = isProjectorSlave
			? ee`<div class="ve-flex-col ve-w-100 ve-h-100 ve-rd__dmv-slave-root">
			${toolbarRow}
			${wrpCvs}
		</div>`.css({
				flex: "1 1 auto",
				minHeight: 0,
				width: "100%",
				minWidth: "100%",
				boxSizing: "border-box",
			})
			: ee`<div class="ve-flex-col ve-w-100 ve-h-100">
			${toolbarRow}
			${wrpCvs}
		</div>`;
		out.attr("tabindex", "-1");
		portraitPanel.appendTo(out);

		zoomChange();

		const dmvIsCopyKey = evt => EventUtil.isCtrlMetaKey(evt)
			&& (evt.code === "KeyC" || evt.key === "c" || evt.key === "C");
		const dmvIsPasteKey = evt => EventUtil.isCtrlMetaKey(evt)
			&& (evt.code === "KeyV" || evt.key === "v" || evt.key === "V");

		const dmvCopySelectedPlaced = (evt = null) => {
			const selId = dmvGetPrimarySelectedId();
			const t = selId ? mapData.placedTokens.find(pt => pt.id === selId) : null;
			if (!t) {
				JqueryUtil.doToast({type: "warning", content: "Selecione um token ou asset no mapa (clique nele) antes de copiar."});
				return false;
			}
			const payload = RenderMap._dmvSerializePlacedForClipboard(t);
			const text = `${RenderMap._DMV_CLIPBOARD_PREFIX}${JSON.stringify(payload)}`;
			mapData._dmvClipboardPlaced = payload;
			mapData._dmvClipboardPasteCount = 0;
			if (evt?.clipboardData) evt.clipboardData.setData("text/plain", text);
			else void MiscUtil.pCopyTextToClipboard(text);
			JqueryUtil.doToast({type: "success", content: `Copiado: ${t.label || (t.kind === "asset" ? "asset" : "token")}`});
			return true;
		};

		const dmvPastePlaced = async (evt = null) => {
			let src = mapData._dmvClipboardPlaced;
			const clipText = evt?.clipboardData?.getData("text/plain");
			if (clipText) {
				const parsed = RenderMap._dmvParsePlacedClipboardText(clipText);
				if (parsed) {
					src = parsed;
					mapData._dmvClipboardPlaced = src;
				}
			}
			if (!src) {
				try {
					const text = await navigator.clipboard.readText();
					src = RenderMap._dmvParsePlacedClipboardText(text);
					if (src) mapData._dmvClipboardPlaced = src;
				} catch { /* empty */ }
			}
			if (!src?.href) {
				JqueryUtil.doToast({type: "warning", content: "Nada para colar. Copie um token ou asset com Ctrl+C primeiro."});
				return;
			}
			const n = (mapData._dmvClipboardPasteCount = (mapData._dmvClipboardPasteCount || 0) + 1);
			const step = RenderMap._dmvGetPlacedOffsetStep(mapData);
			const placed = RenderMap._dmvClonePlacedFromClipboard(src, mapData.placedTokens, {
				offsetMapX: step * n,
				offsetMapY: step * n,
			});
			if (placed.projectorHidden == null) placed.projectorHidden = true;
			mapData.placedTokens.push(placed);
			dmvGetSelectedIds().clear();
			dmvGetSelectedIds().add(placed.id);
			refreshTokens();
			saveTokens();
			if (!isProjectorSlave) publishProjectorState();
			const root = wrpTokens[0] ?? wrpTokens;
			const focusEl = root?.querySelector?.(`[data-dmv-token-id="${placed.id}"]`);
			if (focusEl) e_({ele: focusEl}).focuse();
			JqueryUtil.doToast({type: "success", content: `Colado: ${placed.label || (placed.kind === "asset" ? "asset" : "token")}`});
		};

		const onDmvCopy = evt => {
			if (isProjectorSlave || !enablePlacedLayer) return;
			if (EventUtil.isInInput(evt)) return;
			if (!isDmvKeyEvent(evt)) return;
			if (!dmvGetPrimarySelectedId()) return;
			evt.preventDefault();
			dmvCopySelectedPlaced(evt);
		};

		const onDmvPaste = evt => {
			if (isProjectorSlave || !enablePlacedLayer) return;
			if (EventUtil.isInInput(evt)) return;
			if (!isDmvKeyEvent(evt)) return;
			evt.preventDefault();
			void dmvPastePlaced(evt);
		};

		const isDmvKeyEvent = evt => {
			const root = out[0] ?? out;
			if (!root) return false;
			if (root === evt.target || root.contains?.(evt.target)) return true;
			const active = root.ownerDocument?.activeElement;
			return !!(active && active !== root.ownerDocument?.body && root.contains(active));
		};

		const onDmvKeydown = evt => {
			if (EventUtil.isInInput(evt)) return;
			if (!isDmvKeyEvent(evt)) return;

			if (!isProjectorSlave && enablePlacedLayer) {
				if (dmvIsCopyKey(evt)) {
					evt.preventDefault();
					evt.stopPropagation();
					dmvCopySelectedPlaced(evt);
					return;
				}
				if (dmvIsPasteKey(evt)) {
					evt.preventDefault();
					evt.stopPropagation();
					void dmvPastePlaced(evt);
					return;
				}
			}

			if (!EventUtil.noModifierKeys(evt)) return;
			const k = (EventUtil.getKeyIgnoreCapsLock(evt) || evt.key || "").toLowerCase();
			switch (k) {
				case "h":
					evt.preventDefault();
					zoomChange("fitWidth");
					break;
				case "j":
					evt.preventDefault();
					zoomChange("fitHeight");
					break;
				case "p":
					if (!isProjectorSlave) {
						evt.preventDefault();
						pushProjectorZoom();
					}
					break;
			}
		};

		// Listeners on the DMV window (moves with popout/projector). Re-call `_dmvBindKeyboard` after pDoShowBrowserWindow.
		const bindDmvKeyboard = () => {
			mapData._dmvTeardownKeyboard?.();
			const root = out[0] ?? out;
			const win = root?.ownerDocument?.defaultView;
			if (!win?.addEventListener) return;
			win.addEventListener("keydown", onDmvKeydown, true);
			if (!isProjectorSlave && enablePlacedLayer) {
				win.addEventListener("copy", onDmvCopy, true);
				win.addEventListener("paste", onDmvPaste, true);
			}
			mapData._dmvTeardownKeyboard = () => {
				win.removeEventListener("keydown", onDmvKeydown, true);
				if (!isProjectorSlave && enablePlacedLayer) {
					win.removeEventListener("copy", onDmvCopy, true);
					win.removeEventListener("paste", onDmvPaste, true);
				}
			};
		};
		mapData._dmvBindKeyboard = bindDmvKeyboard;
		bindDmvKeyboard();

		const winDmvKeys = wrpCvs.ownerDocument?.defaultView;

		if (!isProjectorSlave && enablePlacedLayer) {
			const winPersist = cvs.ownerDocument?.defaultView;
			const persistPlacedTokensNow = () => {
				try {
					saveTokens.flush();
				} catch { /* empty */ }
				try {
					localStorage.setItem(storageKey, JSON.stringify(mapData.placedTokens));
				} catch { /* quota */ }
			};
			if (winPersist) {
				winPersist.addEventListener("pagehide", persistPlacedTokensNow);
				winPersist.addEventListener("beforeunload", persistPlacedTokensNow);
			}
			const docPersist = cvs.ownerDocument;
			if (docPersist) {
				docPersist.addEventListener("visibilitychange", () => {
					if (docPersist.visibilityState === "hidden") persistPlacedTokensNow();
				});
			}
		}

		winDmvKeys?.addEventListener("beforeunload", () => mapData._dmvTeardownKeyboard?.());

		return {
			wrp: out,
			setZoom: zoomLevel => {
				if (Parser.isNumberNearEqual(zoomLevel, mapData.zoomLevel)) return;

				const zoomInfo = this._getValidZoomInfo({width: mapData.width, height: mapData.height, zoomLevel});
				mapData.zoomLevel = zoomInfo.zoomLevel;

				onZoomChange();
			},
		};
	}

	static async _pGetArea (areaId, mapData) {
		// When in book mode, we already have the area info cached
		if (globalThis.BookUtil) return globalThis.BookUtil.curRender.headerMap[areaId] || {entry: {name: ""}};

		if (mapData.page && mapData.source && mapData.hash) {
			const fromCache = MiscUtil.get(RenderMap._AREA_CACHE, mapData.source, mapData.hash, areaId);
			if (fromCache) return fromCache;

			const loaded = await DataLoader.pCacheAndGet(mapData.page, mapData.source, mapData.hash);
			(RenderMap._AREA_CACHE[mapData.source] =
				RenderMap._AREA_CACHE[mapData.source] || {})[mapData.hash] =
				Renderer.adventureBook.getEntryIdLookup((loaded.adventureData || loaded.bookData).data);
			return RenderMap._AREA_CACHE[mapData.source][mapData.hash][areaId];
		}

		throw new Error(`Could not load area "${areaId}"`);
	}

	static _getIntersectedRegions (regions, pt) {
		return regions.filter(region => this._getIntersectedRegions_isIntersected(region.points.map(it => ({x: it[0], y: it[1]})), pt));
	}

	// Based on: https://rosettacode.org/wiki/Ray-casting_algorithm
	static _getIntersectedRegions_isIntersected (bounds, pt) {
		const [x, y] = pt;

		let count = 0;
		const len = bounds.length;
		for (let i = 0; i < len; ++i) {
			const vertex1 = bounds[i];
			const vertex2 = bounds[(i + 1) % len];
			if (this._getIntersectedRegions_isWest(vertex1, vertex2, x, y)) ++count;
		}

		return count % 2;
	}

	/**
	 * @return {boolean} true if (x,y) is west of the line segment connecting A and B
	 */
	static _getIntersectedRegions_isWest (A, B, x, y) {
		if (A.y <= B.y) {
			if (y <= A.y || y > B.y || (x >= A.x && x >= B.x)) {
				return false;
			} else if (x < A.x && x < B.x) {
				return true;
			} else {
				return (y - A.y) / (x - A.x) > (B.y - A.y) / (B.x - A.x);
			}
		} else {
			return this._getIntersectedRegions_isWest(B, A, x, y);
		}
	}
}

globalThis.RenderMap = RenderMap;
