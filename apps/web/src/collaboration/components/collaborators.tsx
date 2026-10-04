"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/utils/ui";

import { useCollaborationState } from "../collaboration-provider";
import { participantInitials } from "../participant-initials";
import type { CollaborationStatus } from "../use-collaboration";
import type { Collaborator } from "@opencut/collab-client";

const MAX_VISIBLE = 4;
/** Matches `MAX_ACTIVE_EDITORS` in the Spacetime module. */
const MAX_EDITORS = 4;

export function Collaborators({ className }: { className?: string }) {
	const { collaborators, status, session, isHost, sessionLive, departure } =
		useCollaborationState();
	const [open, setOpen] = useState(false);
	const [leaving, setLeaving] = useState(false);

	if (status === "disabled") {
		return null;
	}

	const others = collaborators.filter((collaborator) => !collaborator.isSelf);
	const visible = others.slice(0, MAX_VISIBLE);
	const overflow = others.length - visible.length;
	const people = [...collaborators].sort((a, b) => {
		if (a.isSelf !== b.isSelf) {
			return a.isSelf ? -1 : 1;
		}
		return a.name.localeCompare(b.name);
	});
	const editorCount = session?.editorCount() ?? 0;
	const canManage = isHost;

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (next && session) {
					void session.refreshParticipants().catch(() => {
						toast.error("Could not refresh participants");
					});
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className={cn(
						"flex items-center gap-2 rounded-md px-1 py-1 hover:bg-muted/60",
						className,
					)}
					aria-label="Participants"
				>
					<StatusDot status={status} />
					{visible.length > 0 && (
						<div className="flex items-center -space-x-2">
							{visible.map((collaborator) => (
								<CollaboratorAvatar
									key={collaborator.identity}
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
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="flex w-80 flex-col gap-2 p-3"
				onPointerDownOutside={(event) => {
					const target = event.target;
					if (
						target instanceof Element &&
						target.closest("[role='option'], [role='listbox']")
					) {
						event.preventDefault();
					}
				}}
				onFocusOutside={(event) => {
					const target = event.target;
					if (
						target instanceof Element &&
						target.closest("[role='option'], [role='listbox']")
					) {
						event.preventDefault();
					}
				}}
			>
				<div className="flex items-baseline justify-between gap-2">
					<p className="text-sm font-medium">Participants</p>
					<p className="text-muted-foreground text-xs">
						{editorCount} of {MAX_EDITORS} editors
					</p>
				</div>
				{people.length === 0 ? (
					<p className="text-muted-foreground text-xs">No one is in this session yet.</p>
				) : (
					<ul className="flex flex-col gap-1.5">
						{people.map((collaborator) => (
							<ParticipantRow
								key={collaborator.identity}
								collaborator={collaborator}
								canManage={canManage}
								isHost={isHost}
								editFull={editorCount >= MAX_EDITORS}
								onRemove={() => {
									if (!session) {
										return;
									}
									void session
										.removeParticipant(collaborator.identity)
										.catch((error: unknown) => {
											const message =
												error instanceof Error
													? error.message
													: "Could not remove that person";
											toast.error(message);
										});
								}}
								onChange={(next) => {
									if (!session) {
										return;
									}
									void session
										.setParticipantAccess(collaborator.connectionId, next)
										.catch((error: unknown) => {
											const message =
												error instanceof Error
													? error.message
													: "Could not change access";
											toast.error(message);
										});
								}}
							/>
						))}
					</ul>
				)}
				{sessionLive && !isHost && !departure && (
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={leaving || status !== "connected" || !session}
						onClick={() => {
							if (!session) {
								return;
							}
							setLeaving(true);
							void session.leaveSession().catch((error: unknown) => {
								const message =
									error instanceof Error
										? error.message
										: "Could not leave the session";
								toast.error(message);
								setLeaving(false);
							});
						}}
					>
						{leaving ? "Leaving…" : "Leave session"}
					</Button>
				)}
			</PopoverContent>
		</Popover>
	);
}

function ParticipantRow({
	collaborator,
	canManage,
	isHost,
	editFull,
	onChange,
	onRemove,
}: {
	collaborator: Collaborator;
	canManage: boolean;
	isHost: boolean;
	editFull: boolean;
	onChange: (canWrite: boolean) => void;
	onRemove: () => void;
}) {
	const state = collaborator.canWrite ? "edit" : "view";
	const promoteBlocked = editFull && !collaborator.canWrite;

	return (
		<li className="flex items-center gap-2">
			<Avatar className="size-7">
				<AvatarFallback
					className="text-[10px] font-semibold text-white"
					style={{ backgroundColor: collaborator.color }}
				>
					{participantInitials(collaborator.name)}
				</AvatarFallback>
			</Avatar>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm">
					{collaborator.name}
					{collaborator.isSelf && (
						<span className="text-muted-foreground"> (you)</span>
					)}
					{collaborator.role === "owner" && (
						<span className="text-primary ml-1 text-[11px] font-medium">Host</span>
					)}
				</p>
				{collaborator.atCapacity && !collaborator.canWrite && (
					<p className="text-muted-foreground text-[11px]">Session is full</p>
				)}
			</div>
			{collaborator.role === "owner" ? null : collaborator.kind === "agent" ? (
				<span className="text-muted-foreground text-xs">Agent</span>
			) : canManage ? (
				<Select
					value={state}
					onValueChange={(value) => {
						onChange(value === "edit");
					}}
				>
					<SelectTrigger
						variant="outline"
						size="sm"
						className="h-7 w-[7.25rem] text-xs"
						aria-label={`${collaborator.name} access`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="edit" disabled={promoteBlocked}>
							Can edit
						</SelectItem>
						<SelectItem value="view">View only</SelectItem>
					</SelectContent>
				</Select>
			) : (
				<span className="text-muted-foreground text-xs">
					{collaborator.canWrite ? "Can edit" : "View only"}
				</span>
			)}
			{isHost && !collaborator.isSelf && collaborator.role !== "owner" && collaborator.kind !== "agent" && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 px-2 text-xs"
					onClick={onRemove}
				>
					Remove
				</Button>
			)}
		</li>
	);
}

function CollaboratorAvatar({ collaborator }: { collaborator: Collaborator }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Avatar className="ring-background size-7 ring-2">
					<AvatarFallback
						className="text-[10px] font-semibold text-white"
						style={{ backgroundColor: collaborator.color }}
					>
						{participantInitials(collaborator.name)}
					</AvatarFallback>
				</Avatar>
			</TooltipTrigger>
			<TooltipContent side="bottom">
				<span className="font-medium">{collaborator.name}</span>
				<span className="text-muted-foreground ml-1">
					{collaborator.role === "owner"
						? "(host)"
						: collaborator.kind === "agent"
							? "(agent)"
							: collaborator.canWrite
								? "(can edit)"
								: "(view only)"}
				</span>
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
	);
}

