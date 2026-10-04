"use client";

/**
 * Other people's pointers, drawn over the editor.
 *
 * Positions are fractions of this shell so two windows of different sizes
 * still point at the same place. This layer never takes clicks.
 */

import { useEffect, useRef } from "react";

import type { Collaborator } from "@opencut/collab-client";

import { useCollaborationState } from "../collaboration-provider";
import { isLiveCursor, setLocalCursor } from "../local-cursor";

export function LiveCursors() {
	const { collaborators } = useCollaborationState();
	const layerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const hide = () => setLocalCursor({ x: -1, y: -1 });

		const onMove = (event: PointerEvent) => {
			const layer = layerRef.current;
			if (!layer) {
				return;
			}
			const rect = layer.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				hide();
				return;
			}
			const x = (event.clientX - rect.left) / rect.width;
			const y = (event.clientY - rect.top) / rect.height;
			if (x < 0 || y < 0 || x > 1 || y > 1) {
				hide();
				return;
			}
			setLocalCursor({ x, y });
		};

		const onLeaveWindow = (event: PointerEvent) => {
			if (event.relatedTarget == null) {
				hide();
			}
		};

		window.addEventListener("pointermove", onMove);
		window.addEventListener("blur", hide);
		document.addEventListener("pointerout", onLeaveWindow);
		return () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("blur", hide);
			document.removeEventListener("pointerout", onLeaveWindow);
			hide();
		};
	}, []);

	const visible = collaborators.filter(
		(collaborator) =>
			!collaborator.isSelf &&
			collaborator.kind !== "agent" &&
			isLiveCursor(collaborator.cursor),
	);

	return (
		<div
			ref={layerRef}
			className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
		>
			{visible.map((collaborator) => (
				<RemoteCursor key={collaborator.identity} collaborator={collaborator} />
			))}
		</div>
	);
}

function RemoteCursor({ collaborator }: { collaborator: Collaborator }) {
	return (
		<div
			className="absolute"
			data-live-cursor={collaborator.name}
			style={{
				left: `${collaborator.cursor.x * 100}%`,
				top: `${collaborator.cursor.y * 100}%`,
				transition: "left 60ms linear, top 60ms linear",
			}}
		>
			<div role="img" aria-label={`${collaborator.name} cursor`}>
				<svg
					width="18"
					height="18"
					viewBox="0 0 18 18"
					className="drop-shadow-md"
					aria-hidden
				>
					<path
						d="M1 1 L1 14.2 L5.1 10.6 L8.2 17 L10.6 16 L7.5 9.7 L13.2 9.7 Z"
						fill={collaborator.color}
						stroke="white"
						strokeWidth="1.2"
						strokeLinejoin="round"
					/>
				</svg>
				<span
					className="absolute top-3.5 left-3.5 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none text-white shadow-sm"
					style={{ backgroundColor: collaborator.color }}
				>
					{collaborator.name}
				</span>
			</div>
		</div>
	);
}
