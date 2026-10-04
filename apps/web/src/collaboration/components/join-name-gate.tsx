"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { chooseDisplayName, readCollabProfile } from "../config";

export function JoinNameGate({ onJoin }: { onJoin: () => void }) {
	const [name, setName] = useState(() => {
		const stored = readCollabProfile();
		return stored?.chosen ? stored.name : "";
	});

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		if (!name.trim()) {
			return;
		}
		chooseDisplayName(name);
		onJoin();
	};

	return (
		<div className="bg-background flex h-screen w-screen items-center justify-center">
			<form
				onSubmit={submit}
				className="flex w-full max-w-sm flex-col gap-4 px-6"
			>
				<div className="flex flex-col gap-1">
					<h1 className="text-lg font-medium">Join this session</h1>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Your name is what other people see on your cursor.
					</p>
				</div>
				<Input
					autoFocus
					value={name}
					placeholder="Your name"
					maxLength={40}
					onChange={(event) => setName(event.target.value)}
					aria-label="Your name"
				/>
				<Button type="submit" disabled={name.trim().length === 0}>
					Join
				</Button>
			</form>
		</div>
	);
}
