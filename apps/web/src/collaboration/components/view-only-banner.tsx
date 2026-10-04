"use client";

import { EyeIcon } from "lucide-react";

import { useCollaborationState } from "../collaboration-provider";

export function ViewOnlyBanner() {
	const { status, canWrite, atCapacity, departure } = useCollaborationState();

	if (status !== "connected") {
		return null;
	}

	const message =
		departure === "ended"
			? "The host ended this CoClip session."
			: departure === "removed"
				? "The host removed you from this session."
				: departure === "left"
					? "You left this CoClip session."
					: !canWrite
					? atCapacity
						? "This project already has 4 editors. You can watch."
						: "View only — you can watch this project, not edit it."
					: null;

	if (!message) {
		return null;
	}

	return (
		<div className="bg-accent border-b flex h-9 items-center justify-center gap-1.5 text-xs text-muted-foreground">
			<EyeIcon className="size-3.5" />
			<span>{message}</span>
		</div>
	);
}
