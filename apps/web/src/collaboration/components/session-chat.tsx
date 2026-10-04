"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import type { ChatMessage, CollabSession } from "@opencut/collab-client";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useCollaborationState } from "../collaboration-provider";

export function SessionChat() {
	const { session, status, sessionLive, departure } = useCollaborationState();
	if (!session || status !== "connected" || departure) return null;
	return (
		<ChatPanel
			key={session.connectionId}
			session={session}
			sessionLive={sessionLive}
		/>
	);
}

function ChatPanel({
	session,
	sessionLive,
}: {
	session: CollabSession;
	sessionLive: boolean;
}) {
	const [open, setOpen] = useState(false);
	const [messages, setMessages] = useState<ChatMessage[]>(() =>
		session.chatMessages(),
	);
	const [unread, setUnread] = useState(0);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const openRef = useRef(open);
	useEffect(() => {
		const current = session.chatMessages();
		const seen = new Set(current.map((message) => message.id));
		return session.onChatMessages((next) => {
			let incoming = 0;
			for (const message of next) {
				if (!seen.has(message.id) && message.author !== session.identity)
					incoming++;
				seen.add(message.id);
			}
			setMessages(next);
			if (!openRef.current) setUnread((count) => count + incoming);
		});
	}, [session]);
	useEffect(() => {
		if (open && listRef.current)
			listRef.current.scrollTop = listRef.current.scrollHeight;
	}, [open, messages]);

	const send = async () => {
		const text = draft.trim();
		if (!text || busy || !sessionLive) return;
		setBusy(true);
		setError(null);
		try {
			await session.sendChatMessage(text);
			setDraft("");
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Could not send message",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				openRef.current = next;
				setOpen(next);
				if (next) setUnread(0);
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="ghost" size="sm">
					<MessageCircle className="size-3.5" /> Chat{" "}
					{unread > 0 && (
						<span aria-label={`${unread} unread messages`}>{unread}</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className="flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-3 p-3"
			>
				<p className="text-sm font-medium">Team chat</p>
				<ScrollArea
					ref={listRef}
					className="max-h-64"
					role="log"
					aria-label="Team messages"
					aria-live="polite"
				>
					{messages.length === 0 && (
						<p className="text-xs text-muted-foreground">
							Send a message to your collaborators.
						</p>
					)}
					<div className="flex flex-col gap-3">
						{messages.map((message) => (
							<div key={message.id}>
								<p className="text-xs text-muted-foreground">
									<span className="font-medium text-foreground">
										{message.author === session.identity
											? "You"
											: message.authorName}
									</span>{" "}
									·{" "}
									{message.sentAt.toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
									})}
								</p>
								<p className="whitespace-pre-wrap break-words text-sm">
									{message.text}
								</p>
							</div>
						))}
					</div>
				</ScrollArea>
				{!sessionLive && (
					<p className="text-xs text-muted-foreground">
						Start a shared session to send messages.
					</p>
				)}
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				<Textarea
					aria-label="Message collaborators"
					placeholder="Message your team…"
					value={draft}
					maxLength={2000}
					disabled={busy || !sessionLive}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (
							event.key === "Enter" &&
							!event.shiftKey &&
							!event.nativeEvent.isComposing
						) {
							event.preventDefault();
							void send();
						}
					}}
				/>
				<Button
					size="sm"
					disabled={busy || !sessionLive || !draft.trim()}
					onClick={() => void send()}
				>
					{busy ? "Sending…" : "Send"}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
