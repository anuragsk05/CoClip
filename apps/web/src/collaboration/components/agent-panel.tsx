"use client";

import { useState } from "react";
import { SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useEditor } from "@/editor/use-editor";
import { cn } from "@/utils/ui";

import { useCollaborationState } from "../collaboration-provider";

type Mode = "chat" | "goal";

interface ChatLine {
	role: "user" | "agent" | "tool";
	text: string;
}

export function AgentPanel() {
	const { status } = useCollaborationState();
	const projectId = useEditor((editor) => editor.project.getActive().metadata.id);
	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("chat");
	const [prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false);
	const [lines, setLines] = useState<ChatLine[]>([]);

	if (status === "disabled") {
		return null;
	}

	const submit = async () => {
		const text = prompt.trim();
		if (!text || busy) {
			return;
		}

		setPrompt("");
		setBusy(true);
		setLines((current) => [...current, { role: "user", text }]);

		try {
			const response = await fetch("/api/collaboration/agent", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ projectId, prompt: text, mode }),
			});
			const payload = (await response.json()) as {
				reply?: string;
				error?: string;
				events?: { type: string; name?: string; result?: { detail: string } }[];
			};

			if (!response.ok) {
				setLines((current) => [
					...current,
					{ role: "agent", text: payload.error ?? "The agent could not run." },
				]);
				return;
			}

			const extras =
				payload.events
					?.filter((event) => event.type === "tool" && event.name)
					.map((event) => ({
						role: "tool" as const,
						text: event.name ?? "",
					})) ?? [];

			setLines((current) => [
				...current,
				...extras,
				{ role: "agent", text: payload.reply ?? "Done." },
			]);
		} catch (error) {
			setLines((current) => [
				...current,
				{
					role: "agent",
					text: error instanceof Error ? error.message : String(error),
				},
			]);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm" className="gap-1.5">
					<SparklesIcon className="size-3.5" />
					Agent
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-96 flex-col gap-3 p-3">
				<div className="flex items-center justify-between gap-2">
					<p className="text-sm font-medium">AI collaborator</p>
					<div className="bg-muted flex rounded-md p-0.5 text-xs">
						<ModeButton current={mode} value="chat" onChange={setMode}>
							Chat
						</ModeButton>
						<ModeButton current={mode} value="goal" onChange={setMode}>
							Goal
						</ModeButton>
					</div>
				</div>
				<ScrollArea className="h-56 rounded-md border px-2 py-1.5">
					{lines.length === 0 && (
						<p className="text-muted-foreground text-xs">
							{mode === "goal"
								? "Give it a goal, like “tighten the pacing”."
								: "Ask for one edit, like “cut the first 3 seconds off the first clip”."}
						</p>
					)}
					<div className="flex flex-col gap-2">
						{lines.map((line, index) => (
							<p
								key={`${line.role}-${index}`}
								className={cn(
									"text-xs leading-relaxed",
									line.role === "user" && "text-foreground font-medium",
									line.role === "tool" && "text-muted-foreground",
									line.role === "agent" && "text-foreground",
								)}
							>
								{line.role === "tool" ? `→ ${line.text}` : line.text}
							</p>
						))}
						{busy && <Spinner className="text-muted-foreground" />}
					</div>
				</ScrollArea>
				<Textarea
					value={prompt}
					onChange={(event) => setPrompt(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder={
						mode === "goal" ? "Tighten the pacing…" : "Mute the B-roll…"
					}
					className="min-h-[72px]"
					disabled={busy || status !== "connected"}
				/>
				<Button
					size="sm"
					onClick={() => void submit()}
					disabled={busy || status !== "connected" || prompt.trim().length === 0}
				>
					{busy ? "Working…" : mode === "goal" ? "Run goal" : "Send"}
				</Button>
			</PopoverContent>
		</Popover>
	);
}

function ModeButton({
	current,
	value,
	onChange,
	children,
}: {
	current: Mode;
	value: Mode;
	onChange: (mode: Mode) => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={() => onChange(value)}
			className={cn(
				"rounded-sm px-2 py-0.5",
				current === value
					? "bg-background text-foreground shadow-xs"
					: "text-muted-foreground",
			)}
		>
			{children}
		</button>
	);
}
