import {OmnisearchBacking} from "./omnisearch/omnisearch-backing.js";

export class RenderMap {
	static _ZOOM_ADJUSTMENT_FACTOR = 1.5;

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

	static _fnGetPopoutSizeProjector () {
		return {
			width: window.screen?.availWidth ?? window.innerWidth,
			height: window.screen?.availHeight ?? window.innerHeight,
		};
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
				helpExtraHtml: "<li>Faint <b>i</b> markers show POI centroids (alignment check).</li><li>POI detail: keep <b>070</b>; <b>074</b> tunnel grid; <b>07c</b> temple; <b>07f</b> watermill; <b>071</b> market; <b>072</b> street (well / junction).</li><li><kbd>SHIFT</kbd> while opening keeps the viewer inline on this page (for laptop review).</li><li>Toolbar: <b>Fullscreen</b> map; <b>Add token</b> (bestiary; optional top-down packs under <code>img/hdq/fa-tokens/</code> and <code>img/hdq/free-tokens/</code>); drag the image to move; top-left handle to resize; bottom-right <b>↻</b> or <kbd>SHIFT</kbd>+scroll on the image to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes (with confirm).</li>",
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
				mode: "fit",
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
		} = opts;

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
		this._normalizePlacedTokensStackZ(mapData.placedTokens);

		const enableCreatureTokens = enableBestiaryTokens !== false;
		const enableAssetLib = enableAssetLibrary !== false;
		const enablePlacedLayer = enableCreatureTokens || enableAssetLib;
		const defaultTokenDiameter = (mapData.grid?.size != null && mapData.grid?.type !== "none")
			? Number(mapData.grid.size)
			: 80;

		const cvs = ee`<canvas class="ve-p-0 ve-m-0"></canvas>`;
		cvs.width = mapData.width;
		cvs.height = mapData.height;
		const ctx = cvs.getContext("2d");

		const wrpTokens = ee`<div class="ve-absolute ve-p-0" style="left:0;top:0;pointer-events:none;z-index:1"></div>`;
		const wrpMapStack = ee`<div class="ve-relative ve-inline-block">${cvs}${wrpTokens}</div>`;

		const getDragBody = () => e_({ele: cvs.ownerDocument.body});

		const saveTokens = MiscUtil.debounce(() => {
			if (!enablePlacedLayer) return;
			try {
				localStorage.setItem(storageKey, JSON.stringify(mapData.placedTokens));
			} catch { /* quota */ }
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
					}
				}

				if (Parser.isNumberNearEqual(lastZoomLevel, mapData.zoomLevel)) return;
			}

			onZoomChange();
		};

		const onZoomChange = () => {
			const zoomInfo = this._getValidZoomInfo(mapData);

			const diffWidth = zoomInfo.widthZoomed - cvs.width;
			const diffHeight = zoomInfo.heightZoomed - cvs.height;

			const scrollLeft = wrpCvs.scrollLeft;
			const scrollTop = wrpCvs.scrollTop;

			cvs.width = zoomInfo.widthZoomed;
			cvs.height = zoomInfo.heightZoomed;

			// Scroll to offset the zoom, keeping the same region centred
			wrpCvs.scrollTo(
				scrollLeft + Math.round(diffWidth / 2),
				scrollTop + Math.round(diffHeight / 2),
			);
			paint();
			mutTokenLayerSize();
			refreshTokens();
		};

		const zoomChangeDebounced = MiscUtil.debounce(zoomChange, 20);

		const getZoomedPoint = (pt) => {
			return [
				Math.round(pt[X] * mapData.zoomLevel),
				Math.round(pt[Y] * mapData.zoomLevel),
			];
		};

		const paint = () => {
			ctx.clearRect(0, 0, cvs.width, cvs.height);
			ctx.drawImage(mapData.loadedImage, 0, 0, cvs.width, cvs.height);

			if (poiDebugMarkers && mapData.regions?.length) {
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
				wrap.css({
					left: `${px - disp / 2}px`,
					top: `${py - disp / 2}px`,
					width: `${disp}px`,
					height: `${disp}px`,
					pointerEvents: "auto",
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
					pointerEvents: "auto",
					cursor: "grab",
					zIndex: "1",
					transform: `rotate(${t.rotation || 0}deg)`,
					transformOrigin: "center center",
				});

				const btnDel = ee`<button type="button" class="rd__dmv-token-del" aria-label="${t.kind === "asset" ? "Remove asset" : "Remove token"}">×</button>`;
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
					hResize.css({opacity: o, pointerEvents: pe});
					hRotate.css({opacity: o, pointerEvents: pe});
					wrpStack.css({opacity: o, pointerEvents: pe});
				};
				const refreshTokenChrome = () => setTokenChromeOpaque(tokenChromeHover || tokenChromeFocus);
				wrap.onn("mouseenter", () => {
					tokenChromeHover = true;
					refreshTokenChrome();
				});
				wrap.onn("mouseleave", () => {
					tokenChromeHover = false;
					refreshTokenChrome();
				});
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
					const onUp = () => {
						getDragBody()
							.off("mousemove", onMove)
							.off("mouseup", onUp);
						if (mapData.grid?.size != null && mapData.grid.type !== "none") {
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
			})
			.onn("mousedown", evt => {
				if (evt.button !== 2) return; // RMB

				cvs.style.cursor = "grabbing";

				lastRmbMeta.fnsCleanup.forEach(fn => fn());

				// Find the nearest body, in case we're in a popout window
				lastRmbMeta.body ||= e_({ele: out.closeste("body")});
				lastRmbMeta.point = [EventUtil.getClientX(evt), EventUtil.getClientY(evt)];
				lastRmbMeta.time = Date.now();
				lastRmbMeta.scrollPos = [wrpCvs.scrollLeft, wrpCvs.scrollTop];
				lastRmbMeta.fnsCleanup = [];

				const onMouseUpBody = evt => {
					if (evt.button !== 2) return; // RMB

					lastRmbMeta.body
						.off(`mouseup`, onMouseUpBody)
						.off(`mousemove`, onMouseMoveBody);

					cvs.style.cursor = "";

					lastRmbMeta.point = null;
					lastRmbMeta.time = null;
					lastRmbMeta.scrollPos = null;
				};

				const onMouseMoveBody = evt => {
					if (lastRmbMeta.point == null) return;

					const movePt = [EventUtil.getClientX(evt), EventUtil.getClientY(evt)];

					const diffX = lastRmbMeta.point[X] - movePt[X];
					const diffY = lastRmbMeta.point[Y] - movePt[Y];

					lastRmbMeta.time = Date.now();

					wrpCvs.scrollTo(
						lastRmbMeta.scrollPos[X] + diffX,
						lastRmbMeta.scrollPos[Y] + diffY,
					);
				};

				const onContextMenuBody = evt => {
					evt.stopPropagation();
					evt.preventDefault();

					lastRmbMeta.body.off(`contextmenu`, onContextMenuBody);
				};

				lastRmbMeta.fnsCleanup.push(
					() => {
						lastRmbMeta.body
							.off("mouseup", onMouseUpBody)
							.off("mousemove", onMouseMoveBody)
							.off("contextmenu", onContextMenuBody)
						;
					},
				);

				lastRmbMeta.body
					.onn("mouseup", onMouseUpBody)
					.onn("mousemove", onMouseMoveBody)
					// Bind a document-wide handler to block the context menu at the end of the pan
					.onn(`contextmenu`, onContextMenuBody);
			});

		const pOpenBestiaryTokenModal = async clickEvt => {
			// Modal must use the DMV document's window (popout tab/window). UiUtil.getShowModal defaults to
			// the page that loaded utils-ui (adventure); without this, overlay/results go to the wrong document.
			const modalHostWindow =
				clickEvt?.currentTarget?.ownerDocument?.defaultView
				?? clickEvt?.view
				?? globalThis;
			const appWindow = RenderMap._getDmvHostAppWindowForSearch(modalHostWindow);
			const docUi = modalHostWindow.document;
			const ParserSafe = appWindow.Parser || globalThis.Parser;

			const {eleModalInner, doClose} = UiUtil.getShowModal({
				title: "Add creature token",
				isMinHeight0: true,
				window: modalHostWindow,
			});

			const iptSearch = ee`<input class="ve-form-control ve-ui-search__ipt-search search ve-mb-2" autocomplete="off" placeholder="Search creatures...">`;
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

			const pHandleSelectCreature = async res => {
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
					mapData.placedTokens.push({
						id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
						mapX: mapData.width / 2,
						mapY: mapData.height / 2,
						href,
						label: mon.name,
						scale: 1,
						rotation: 0,
						baseDiameter: defaultTokenDiameter,
						stackZ: RenderMap._nextDmvPlacedTokenStackZ(mapData.placedTokens),
					});
					doClose();
					refreshTokens();
					saveTokens();
				} catch (err) {
					JqueryUtil.doToast({type: "warning", content: `Token unavailable for this creature. ${VeCt.STR_SEE_CONSOLE}`});
					setTimeout(() => { throw err; });
				}
			};

			// Match dmscreen InitiativeTrackerMonsterAdd: Creature-only Lunr index + pGetFilteredResults({searchTerm}) only
			// (avoids pGetResults SRD/partnered defaults and flaky in:monster queries on adventure.html).
			const pDoSearch = async () => {
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
					filtered = await OmnisearchBacking.pGetFilteredResults(rawFromIndex, {searchTerm});
				} catch (err) {
					setTimeout(() => { throw err; });
					filtered = rawFromIndex;
				}

				const resultCount = filtered.length ? filtered.length : index.documentStore.length;
				const toProcess = filtered.length
					? filtered
					: Object.values(index.documentStore.docs).slice(0, RenderMap._DMV_CREATURE_RESULTS_MAX).map(it => ({doc: it}));

				wrpResults.empty();
				ptrRows._ = [];

				if (toProcess.length) {
					if (flags.doClickFirst) {
						await pHandleSelectCreature(toProcess[0]);
						flags.doClickFirst = false;
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
					wrpAppendHtmlStr(SearchWidget.getSearchNoResults());
				}
			};

			SearchWidget.bindAutoSearch(iptSearch, {
				flags,
				pFnSearch: pDoSearch,
				fnShowWait: () => {
					wrpResults.empty();
					wrpAppendHtmlStr(SearchWidget.getSearchLoading());
				},
				ptrRows,
			});

			iptSearch.focuse();
			await pDoSearch();
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

		const btnZoomFit = ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default" title="Show the whole map in the view (may add empty margins)"><span class="glyphicon glyphicon-resize-small"></span> Zoom to Fit</button>`
			.onn("click", () => zoomChange("fit"));

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
						<li>Right-click and drag to pan.</li>
						<li><kbd>CTRL</kbd>-scroll to zoom.</li>
						<li><b>Zoom to Fit</b> shows the entire map; <b>Zoom to Fill</b> uses the full viewport (may crop).</li>
						${enableCreatureTokens ? "<li><b>Add token</b> picks a creature from the bestiary; if a top-down file exists under <code>img/hdq/fa-tokens/</code> or <code>img/hdq/free-tokens/</code> (Forgotten Adventures overrides FREE on the same creature), you are prompted to use it or the default bestiary token. List rows show <b>TD</b> when a top-down path is mapped. <b>Clear tokens</b> removes creature tokens only (keeps assets).</li>" : ""}
						${enableAssetLib ? "<li><b>Add asset</b> uses <code>data/hdq/dmv-asset-manifest.json</code> (run <code>node tools/generate-dmv-asset-manifest.mjs</code> after copying into <code>img/hdq/fa-assets/</code>; reload the page to refresh the cached manifest). Large libraries: type at least <b>2</b> characters to show thumbnails (max 400 matches). Same drag, resize, rotate, and delete as tokens. <b>Clear assets</b> removes placed assets only.</li>" : ""}
						${enablePlacedLayer ? "<li>Drag the image to move; top-left handle to resize; bottom-right <b>↻</b> (or <kbd>SHIFT</kbd>+scroll on the image) to rotate; <kbd>ALT</kbd>+scroll to resize; top-right <b>×</b> removes one (confirm). Bottom-left <b>▲</b><b>▼</b> (on hover) change stacking order among tokens and assets.</li>" : ""}
						${helpExtraHtml}
					</ul>
				`);
			});

		const onMouseWheelCanvas = evt => {
			if (!EventUtil.isCtrlMetaKey(evt)) return;
			evt.stopPropagation();
			evt.preventDefault();

			const direction = (evt.wheelDelta != null && evt.wheelDelta > 0)
				|| (evt.deltaY != null && evt.deltaY < 0)
				// `evt.detail` seems to work on Firefox
				|| (evt.detail != null && !isNaN(evt.detail) && evt.detail < 0) ? "in" : "out";
			zoomChangeDebounced(direction);
		};

		const wrpCvs = ee`<div class="ve-w-100 ve-h-100 ve-overflow-x-scroll ve-overflow-y-scroll ve-rd__scroller-viewer ${mapData.expectsLightBackground ? "ve-rd__scroller-viewer--bg-light" : mapData.expectsDarkBackground ? "ve-rd__scroller-viewer--bg-dark" : ""}">
			${wrpMapStack}
		</div>`
			.onn("mousewheel", onMouseWheelCanvas)
			.onn("DOMMouseScroll", onMouseWheelCanvas);

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

		const btnAddToken = enableCreatureTokens
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Add creature from bestiary"><span class="glyphicon glyphicon-plus"></span> Add Token</button>`
				.onn("click", evt => { pOpenBestiaryTokenModal(evt); })
			: null;

		const btnClearTokens = enableCreatureTokens
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Remove all creature tokens from this map (keeps assets)"><span class="glyphicon glyphicon-trash"></span> Clear Tokens</button>`
				.onn("click", () => {
					mapData.placedTokens = mapData.placedTokens.filter(t => t.kind === "asset");
					refreshTokens();
					saveTokens();
				})
			: null;

		const btnAddAsset = enableAssetLib
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Add scenery asset from library"><span class="glyphicon glyphicon-picture"></span> Add Asset</button>`
				.onn("click", evt => { pOpenAssetLibraryModal(evt); })
			: null;

		const btnClearAssets = enableAssetLib
			? ee`<button type="button" class="ve-btn ve-btn-xs ve-btn-default ve-mr-2" title="Remove all placed assets from this map (keeps creature tokens)"><span class="glyphicon glyphicon-trash"></span> Clear Assets</button>`
				.onn("click", () => {
					mapData.placedTokens = mapData.placedTokens.filter(t => t.kind !== "asset");
					refreshTokens();
					saveTokens();
				})
			: null;

		const toolbarRow = ee`<div class="ve-flex ve-no-shrink ve-p-2 ve-flex-wrap ve-align-items-center"></div>`;
		toolbarRow.appends(
			ee`<div class="ve-btn-group ve-flex ve-mr-2">${btnZoomMinus}${btnZoomPlus}${btnZoomFit}</div>`,
			btnZoomFill,
			btnFullscreen,
		);
		if (btnAddToken) toolbarRow.appends(btnAddToken);
		if (btnClearTokens) toolbarRow.appends(btnClearTokens);
		if (btnAddAsset) toolbarRow.appends(btnAddAsset);
		if (btnClearAssets) toolbarRow.appends(btnClearAssets);
		toolbarRow.appends(btnHelp);

		const out = ee`<div class="ve-flex-col ve-w-100 ve-h-100">
			${toolbarRow}
			${wrpCvs}
		</div>`;

		zoomChange();

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
