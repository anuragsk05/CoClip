"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/utils/ui";

import type { CollaborationStatus } from "../use-collaboration";
import type { Collaborator } from "@opencut/collab-client";

const MAX_VISIBLE = 4;

export function Collaborators({
	collaborators,
	status,
	className,
}: {
	collaborators: Collaborator[];
	status: CollaborationStatus;
	className?: string;
}) {
	if (status === "disabled") {
		return null;
	}

	// Everyone except this editor; seeing your own avatar in the list is noise.
	const others = collaborators.filter((collaborator) => !collaborator.isSelf);
	const visible = others.slice(0, MAX_VISIBLE);
	const overflow = others.length - visible.length;

	return (
		<div className={cn("flex items-center gap-2", className)}>
			<StatusDot status={status} />
			{visible.length > 0 && (
				// Negative spacing overlaps the avatars; each one gets a ring so the
				// stack still reads as separate people.
				<div className="flex items-center -space-x-2">
					{visible.map((collaborator) => (
						<CollaboratorAvatar
							key={collaborator.connectionId}
							collaborator={collaborator}
						/>
					))}
					{overflow > 0 && (
						<Avatar className="ring-background size-7 ring-2">
							<AvatarFallback className="text-[10px] font-medium">
								+{overflow}
							</AvatarFallback>
						</Avatar>
					)}
				</div>
			)}
		</div>
	);
}

function CollaboratorAvatar({ collaborator }: { collaborator: Collaborator }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Avatar className="ring-background size-7 ring-2">
					<AvatarFallback
						className="text-[10px] font-semibold text-white"
						// The colour is per-collaborator, so it cannot be a utility class.
						style={{ backgroundColor: collaborator.color }}
					>
						{initials(collaborator.name)}
					</AvatarFallback>
				</Avatar>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<span className="font-medium">{collaborator.name}</span>
				{collaborator.kind === "agent" && (
					<span className="text-muted-foreground ml-1">(agent)</span>
				)}
			</TooltipContent>
		</Tooltip>
	);
}

function StatusDot({ status }: { status: CollaborationStatus }) {
	const label = {
		disabled: "Collaboration off",
		connecting: "Connecting…",
		connected: "Live",
		error: "Disconnected",
	}[status];

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"size-2 shrink-0 rounded-full",
						status === "connected" && "bg-emerald-500",
						status === "connecting" && "animate-pulse bg-amber-500",
						status === "error" && "bg-destructive",
						status === "disabled" && "bg-muted-foreground",
					)}
					aria-label={label}
				/>
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
}

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0]!.slice(0, 2).toUpperCase();
	}
	return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
