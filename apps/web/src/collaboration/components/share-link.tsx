"use client";

import { useState } from "react";
import { Share2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useEditor } from "@/editor/use-editor";

import { useCollaborationState } from "../collaboration-provider";

export function ShareLink() {
	const { status } = useCollaborationState();
	const projectId = useEditor((editor) => editor.project.getActive().metadata.id);
	const [open, setOpen] = useState(false);

	if (status === "disabled") {
		return null;
	}

	const link =
		typeof window === "undefined"
			? `/editor/${projectId}`
			: `${window.location.origin}/editor/${projectId}`;
	const onThisComputer =
		typeof window !== "undefined" &&
		(window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1");

	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link);
			toast.success("Share link copied");
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
				<div className="flex flex-col gap-1">
					<p className="text-sm font-medium">Live share</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Anyone with this link joins the same timeline. Media stays on the
						computer that imported it.
					</p>
				</div>
				<p className="bg-muted break-all rounded-md px-2 py-1.5 font-mono text-[11px]">
					{link}
				</p>
				{onThisComputer && (
					<p className="text-muted-foreground text-xs leading-relaxed">
						Another browser on this computer can open it as-is. On another
						device, replace localhost with this computer’s address.
					</p>
				)}
				<Button size="sm" onClick={() => void copy()}>
					Copy link
				</Button>
			</PopoverContent>
		</Popover>
	);
}
