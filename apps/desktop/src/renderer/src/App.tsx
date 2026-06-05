import {useEffect, useState} from "react";
import {Navigate, Route, Routes, useLocation} from "react-router-dom";
import type {DocumentRow} from "../../shared/types.ts";
import {MasterView} from "./MasterView.js";
import {ProjectorView} from "./ProjectorView.js";

export function App(): React.ReactElement {
	const location = useLocation();
	const isProjector = location.pathname === "/projector";

	useEffect(() => {
		document.body.classList.toggle("overflow-hidden", isProjector);
		document.documentElement.classList.toggle("overflow-hidden", isProjector);
		return () => {
			document.body.classList.remove("overflow-hidden");
			document.documentElement.classList.remove("overflow-hidden");
		};
	}, [isProjector]);

	return (
		<Routes>
			<Route path="/" element={<MasterView />} />
			<Route path="/projector" element={<ProjectorView />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}

export type {DocumentRow};
