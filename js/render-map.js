export class RenderMap {
	static _ZOOM_ADJUSTMENT_FACTOR = 1.5;

	// See:
	//  - https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
	//  - https://jhildenbiddle.github.io/canvas-size/#/?id=test-results
	static _MAX_CANVAS_AREA = Math.pow(2, 14) * Math.pow(2, 14);
	// Arbitrary
	static _MIN_CANVAS_AREA = Math.pow(2, 8) * Math.pow(2, 8);

	static _AREA_CACHE = {};

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
	]);

	/* -------------------------------------------- */

	static getHotdqGreenestPlayerMapData (entry, href) {
		return {
			regions: this._scaleHotdqGreenestRegionsToPlayer(entry.width, entry.height),
			width: entry.width,
			height: entry.height,
			href,
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

	/* -------------------------------------------- */

	static async pShowViewer (evt, ele) {
		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) return;

		const fnGetContainerDimensions = () => {
			const {wWrpContent, hWrapContent} = hoverWindow.getPosition();
			return {w: wWrpContent, h: hWrapContent};
		};

		const {wrp, setZoom} = this._getEleWindowContent({mapData, fnGetContainerDimensions});

		const hoverWindow = Renderer.hover.getShowWindow(
			wrp,
			// Open in the top-right corner of the screen
			Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, evt),
			{
				title: `Dynamic Map Viewer`,
				isPermanent: true,
				isBookContent: true,
				width: Math.min(Math.floor(document.body.clientWidth / 2), mapData.width),
				height: mapData.height + 32,
				pFnGetPopoutContent: () => wrp,
				fnGetPopoutSize: () => {
					const zoomInfo = this._getValidZoomInfo(mapData);
					return {
						width: Math.min(window.innerWidth, zoomInfo.widthZoomed),
						height: Math.min(window.innerHeight, zoomInfo.heightZoomed + 32),
					};
				},
				isPopout: !!evt.shiftKey,
			},
		);

		if (hoverWindow.pPoppingOut) await hoverWindow.pPoppingOut;

		this._mutInitialZoom({
			fnGetContainerDimensions,
			mapData,
			setZoom,
		});
	}

	static async pShowHotdqGreenestPlayerViewer (evt, ele) {
		const mapData = JSON.parse(ele.dataset.rdPackedMap);

		if (!mapData.page) mapData.page = ele.dataset.rdAdventureBookMapPage;
		if (!mapData.source) mapData.source = ele.dataset.rdAdventureBookMapSource;
		if (!mapData.hash) mapData.hash = ele.dataset.rdAdventureBookMapHash;

		await RenderMap._pMutMapData(mapData);

		if (!mapData.loadedImage) return;

		const fnGetContainerDimensions = () => {
			const {wWrpContent, hWrapContent} = hoverWindow.getPosition();
			return {w: wWrpContent, h: hWrapContent};
		};

		const {wrp, setZoom} = this._getEleWindowContent({
			mapData,
			fnGetContainerDimensions,
			opts: {
				paintRegions: false,
				poiDebugMarkers: true,
				helpExtraHtml: "<li>Faint <b>i</b> markers show POI centroids (alignment check).</li><li>Click the keep (070) for a detailed map.</li>",
				onRegionClick: async ({intersectedRegion, evt: clickEvt}) => {
					if (String(intersectedRegion.area).toLowerCase() !== "070") return false;
					await RenderMap._pOpenHotdqGreenestKeepMap(clickEvt);
					return true;
				},
			},
		});

		const hoverWindow = Renderer.hover.getShowWindow(
			wrp,
			Renderer.hover.getWindowPositionExact(document.body.clientWidth, 7, evt),
			{
				title: `Dynamic Map Viewer`,
				isPermanent: true,
				isBookContent: true,
				width: Math.min(Math.floor(document.body.clientWidth / 2), mapData.width),
				height: mapData.height + 32,
				pFnGetPopoutContent: () => wrp,
				fnGetPopoutSize: () => {
					const zoomInfo = this._getValidZoomInfo(mapData);
					return {
						width: Math.min(window.innerWidth, zoomInfo.widthZoomed),
						height: Math.min(window.innerHeight, zoomInfo.heightZoomed + 32),
					};
				},
				isPopout: !!evt.shiftKey,
			},
		);

		if (hoverWindow.pPoppingOut) await hoverWindow.pPoppingOut;

		this._mutInitialZoom({
			fnGetContainerDimensions,
			mapData,
			setZoom,
		});
	}

	static async _pOpenHotdqGreenestKeepMap (evt) {
		const href = Renderer.get().getMediaUrl("img", "adventure/HotDQ/greenestKeepV2.png");
		const mapData = {regions: [], href};
		await RenderMap._pMutMapData(mapData);
		if (!mapData.loadedImage) return;

		const fnGetContainerDimensions = () => {
			const {wWrpContent, hWrapContent} = hoverWindow.getPosition();
			return {w: wWrpContent, h: hWrapContent};
		};

		const {wrp, setZoom} = this._getEleWindowContent({mapData, fnGetContainerDimensions});

		const hoverWindow = Renderer.hover.getShowWindow(
			wrp,
			Renderer.hover.getWindowPositionExactVisibleBottom(
				EventUtil.getClientX(evt),
				EventUtil.getClientY(evt),
				evt,
			),
			{
				title: "Greenest Keep",
				isPermanent: true,
				isBookContent: true,
				width: Math.min(Math.floor(document.body.clientWidth / 2), mapData.width),
				height: mapData.height + 32,
				pFnGetPopoutContent: () => wrp,
				fnGetPopoutSize: () => {
					const zoomInfo = this._getValidZoomInfo(mapData);
					return {
						width: Math.min(window.innerWidth, zoomInfo.widthZoomed),
						height: Math.min(window.innerHeight, zoomInfo.heightZoomed + 32),
					};
				},
				isPopout: !!evt.shiftKey,
			},
		);

		if (hoverWindow.pPoppingOut) await hoverWindow.pPoppingOut;

		this._mutInitialZoom({
			fnGetContainerDimensions,
			mapData,
			setZoom,
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

	static _mutInitialZoom ({fnGetContainerDimensions, mapData, setZoom}) {
		if (!fnGetContainerDimensions) return;

		const zoomLevelFill = this._getValidZoomInfoFitFill({width: mapData.width, height: mapData.height, fnGetContainerDimensions, mode: "fill"});

		setZoom(zoomLevelFill.zoomLevel);
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

	static _getValidZoomInfoFitFill ({width, height, fnGetContainerDimensions = null, mode}) {
		if (!fnGetContainerDimensions) return this._getValidZoomInfo({width, height, zoomLevel: 1.0});

		const {w: widthContainer, h: heightContainer} = fnGetContainerDimensions();
		// Compensate for scrollbars/header
		const widthMapDisplay = widthContainer - 10;
		const heightMapDisplay = heightContainer - 56;

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
		} = opts;

		const X = 0;
		const Y = 1;

		const cvs = ee`<canvas class="ve-p-0 ve-m-0"></canvas>`;
		cvs.width = mapData.width;
		cvs.height = mapData.height;
		const ctx = cvs.getContext("2d");

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
						}).zoomLevel;
						break;
					}

					case "fit": {
						mapData.zoomLevel = this._getValidZoomInfoFitFill({
							width: mapData.width,
							height: mapData.height,
							fnGetContainerDimensions,
							mode: "fit",
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

				const area = await RenderMap._pGetArea(intersectedRegion.area, mapData);

				// When in book mode, shift-click a region to navigate to it
				if (evt.shiftKey && globalThis.BookUtil) {
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
					const windowMeta = mapData.activeWindows[area.entry.id];
					windowMeta.doZIndexToFront();
					windowMeta.doMaximize();
					return;
				}

				mapData.activeWindows[area.entry.id] = Renderer.hover.getShowWindow(
					Renderer.hover.getHoverContent_generic(area.entry, {isLargeBookContent: true, depth: area.depth}),
					Renderer.hover.getWindowPositionExactVisibleBottom(
						EventUtil.getClientX(evt),
						EventUtil.getClientY(evt),
						evt,
					),
					{
						title: area.entry.name || "",
						isPermanent: true,
						isBookContent: true,
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

		const btnZoomMinus = ee`<button class="ve-btn ve-btn-xs ve-btn-default"><span class="glyphicon glyphicon-zoom-out"></span> Zoom Out</button>`
			.onn("click", () => zoomChange("out"));

		const btnZoomPlus = ee`<button class="ve-btn ve-btn-xs ve-btn-default"><span class="glyphicon glyphicon-zoom-in"></span> Zoom In</button>`
			.onn("click", () => zoomChange("in"));

		const btnZoomReset = ee`<button class="ve-btn ve-btn-xs ve-btn-default ve-mr-2"><span class="glyphicon glyphicon-search"></span> Reset Zoom</button>`
			.onn("click", () => zoomChange("fill"));

		const btnZoomFit = ee`<button class="ve-btn ve-btn-xs ve-btn-default"><span class="glyphicon glyphicon-search"></span> Zoom to Fit</button>`
			.onn("click", () => zoomChange("fit"));

		const btnHelp = ee`<button class="ve-btn ve-btn-xs ve-btn-default ve-ml-auto ve-mr-4" title="Help"><span class="glyphicon glyphicon-info-sign"></span> Help</button>`
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
			${cvs}
		</div>`
			.onn("mousewheel", onMouseWheelCanvas)
			.onn("DOMMouseScroll", onMouseWheelCanvas);

		const out = ee`<div class="ve-flex-col ve-w-100 ve-h-100">
			<div class="ve-flex ve-no-shrink ve-p-2">
				<div class="ve-btn-group ve-flex ve-mr-2">
					${btnZoomMinus}
					${btnZoomPlus}
				</div>
				${btnZoomReset}
				${btnZoomFit}
				${btnHelp}
			</div>
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
