"use client";

import { useEffect, useState } from "react";
import { EyeIcon, PencilIcon, Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

import { useCollaborationState } from "../collaboration-provider";
import {
	buildShareUrl,
	readShareToken,
	type ShareAccess,
} from "../share-access";

export function ShareLink() {
	const { status, session, canWrite, isHost, sessionLive, departure } =
		useCollaborationState();
	const projectId = useEditor((editor) => editor.project.getActive().metadata.id);
	const [open, setOpen] = useState(false);
	const [access, setAccess] = useState<ShareAccess>("write");
	const [token, setToken] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [starting, setStarting] = useState(false);

	const selectedAccess: ShareAccess = canWrite ? access : "view";

	useEffect(() => {
		if (!open || !sessionLive) {
			return;
		}
		if (!canWrite) {
			setToken(readShareToken());
			setLoading(false);
			return;
		}
		if (!session || status !== "connected") {
			return;
		}

		let cancelled = false;
		setLoading(true);
		void session
			.ensureShareInvite(selectedAccess === "write")
			.then((next) => {
				if (!cancelled) {
					setToken(next);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setToken(null);
					toast.error("Could not create a share link");
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [open, session, selectedAccess, status, canWrite, isHost, sessionLive]);

	const startSession = async () => {
		if (!session) {
			return;
		}
		setStarting(true);
		try {
			await session.startLiveSession();
		} catch {
			toast.error("Could not start the CoClip session");
		} finally {
			setStarting(false);
		}
	};

	const stopSession = async () => {
		if (!session) {
			return;
		}
		try {
			await session.stopLiveSession();
			toast.success("CoClip session ended");
		} catch {
			toast.error("Could not stop the session");
		}
	};

	if (status === "disabled") {
		return null;
	}

	const origin =
		typeof window === "undefined" ? "" : window.location.origin;
	const link = !origin
		? ""
		: token
			? buildShareUrl(origin, projectId, token)
			: canWrite
				? ""
				: `${origin}/editor/${projectId}`;
	const onThisComputer =
		typeof window !== "undefined" &&
		(window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1");

	const copy = async () => {
		if (!link) {
			return;
		}
		try {
			await navigator.clipboard.writeText(link);
			toast.success(
				selectedAccess === "write"
					? "Edit link copied"
					: "View-only link copied",
			);
		} catch {
			toast.error("Could not copy the link");
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" className="gap-1.5">
					<Share2Icon className="size-3.5" />
					Share
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-80 flex-col gap-3 p-3">
				{status === "connecting" ? (
					<p className="text-muted-foreground text-xs leading-relaxed">
						Connecting…
					</p>
				) : isHost && !sessionLive ? (
					<>
						<div className="flex flex-col gap-1">
							<p className="text-sm font-medium">Start a CoClip session</p>
							<p className="text-muted-foreground text-xs leading-relaxed">
								You can edit alone until you start. After that, people with
								the link can join. Up to 4 people can edit at once.
							</p>
						</div>
						<Button
							size="sm"
							onClick={() => void startSession()}
							disabled={starting || status !== "connected"}
						>
							{starting ? "Starting…" : "Start CoClip Session"}
						</Button>
					</>
				) : !sessionLive ? (
					<p className="text-muted-foreground text-xs leading-relaxed">
						The host has not started a CoClip session.
					</p>
				) : departure ? (
					<p className="text-muted-foreground text-xs leading-relaxed">
						{departure === "removed"
							? "The host removed you from this session."
							: departure === "left"
								? "You left this CoClip session."
								: "The host ended this CoClip session."}
					</p>
				) : (
					<>
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium">Live share</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Anyone with the link joins this timeline. Up to 4 people can edit
						at once. Video and audio are shared with the session, so everyone
						can play them.
					</p>
				</div>
				{canWrite ? (
					<div className="grid grid-cols-2 gap-1.5">
						<AccessChoice
							selected={access === "view"}
							onSelect={() => setAccess("view")}
							icon={<EyeIcon className="size-3.5" />}
							label="View only"
							hint="Watch and cursors"
						/>
						<AccessChoice
							selected={access === "write"}
							onSelect={() => setAccess("write")}
							icon={<PencilIcon className="size-3.5" />}
							label="Can edit"
							hint="Change the timeline"
						/>
					</div>
				) : (
					<p className="text-muted-foreground text-xs leading-relaxed">
						You joined with a view-only link. You can copy that link, not
						an edit link.
					</p>
				)}
				<p className="bg-muted min-h-10 break-all rounded-md px-2 py-1.5 font-mono text-[11px]">
					{loading || !link ? "Creating link…" : link}
				</p>
				{onThisComputer && (
					<p className="text-muted-foreground text-xs leading-relaxed">
						This address only works on this computer. On the same Wi-Fi,
						open the app via this computer’s LAN address first, then share.
						Off this network, the app and database need a public host.
					</p>
				)}
				<Button size="sm" onClick={() => void copy()} disabled={!link}>
					Copy {selectedAccess === "write" ? "edit" : "view-only"} link
				</Button>
				{isHost && (
					<Button
						size="sm"
						variant="outline"
						onClick={() => void stopSession()}
					>
						Stop session
					</Button>
				)}
					</>
				)}
			</PopoverContent>
		</Popover>
	);
}

function AccessChoice({
	selected,
	onSelect,
	icon,
	label,
	hint,
}: {
	selected: boolean;
	onSelect: () => void;
	icon: React.ReactNode;
	label: string;
	hint: string;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-pressed={selected}
			className={cn(
				"flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors",
				selected
					? "border-primary bg-primary/10"
					: "border-border hover:bg-muted/60",
			)}
		>
			<span className="flex items-center gap-1.5 text-xs font-medium">
				{icon}
				{label}
			</span>
			<span className="text-muted-foreground text-[11px] leading-snug">
				{hint}
			</span>
		</button>
	);
}
