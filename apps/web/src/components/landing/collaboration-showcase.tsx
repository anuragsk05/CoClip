"use client";

import { useState, useEffect } from "react";
import { Play, Pause, Users, Sparkles, Volume2, Film, Scissors, CheckCircle2, Radio, Eye } from "lucide-react";
import { cn } from "@/utils/ui";

interface Collaborator {
	id: string;
	name: string;
	role: string;
	color: string;
	avatar: string;
	status: string;
}

const COLLABORATORS: Collaborator[] = [
	{
		id: "ada",
		name: "Ada",
		role: "Director",
		color: "border-purple-500 text-purple-400 bg-purple-500/10",
		avatar: "bg-purple-600",
		status: "Trimming Scene 3 at 00:04:12",
	},
	{
		id: "kai",
		name: "Kai",
		role: "Sound Lead",
		color: "border-sky-500 text-sky-400 bg-sky-500/10",
		avatar: "bg-sky-600",
		status: "Mastering audio stem (-3dB)",
	},
	{
		id: "nova",
		name: "Nova",
		role: "Colorist",
		color: "border-fuchsia-500 text-fuchsia-400 bg-fuchsia-500/10",
		avatar: "bg-fuchsia-600",
		status: "Applying cinematic LUT",
	},
	{
		id: "ai",
		name: "AI Copilot",
		role: "OpenAI",
		color: "border-amber-500 text-amber-400 bg-amber-500/10",
		avatar: "bg-gradient-to-tr from-amber-500 to-purple-600",
		status: "Removing silent gaps",
	},
];

const ACTIVITY_FEED = [
	{ user: "Ada", action: "split clip 'Intro_Sequence.mp4' at 00:03:14", time: "Just now", color: "text-purple-400" },
	{ user: "AI Copilot", action: "trimmed 1.4s of silence from Audio Track", time: "2s ago", color: "text-amber-400" },
	{ user: "Kai", action: "adjusted crossfade curve on 'Soundtrack.wav'", time: "6s ago", color: "text-sky-400" },
	{ user: "Nova", action: "repositioned 'LowerThird_Title.svg' to 00:06:00", time: "11s ago", color: "text-fuchsia-400" },
];

export function CollaborationShowcase() {
	const [isPlaying, setIsPlaying] = useState(true);
	const [activeCollaborator, setActiveCollaborator] = useState<string>("ada");
	const [playheadPos, setPlayheadPos] = useState(38); // percentage

	useEffect(() => {
		if (!isPlaying) return;
		const interval = setInterval(() => {
			setPlayheadPos((prev) => (prev >= 92 ? 15 : prev + 0.4));
		}, 80);
		return () => clearInterval(interval);
	}, [isPlaying]);

	return (
		<section id="collaboration" className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
			{/* Ambient background studio glow */}
			<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[450px] bg-primary/20 blur-[150px] rounded-full pointer-events-none -z-10" />

			{/* Section Header */}
			<div className="mb-12 text-center">
				<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary backdrop-blur-md">
					<Radio className="size-3.5 animate-pulse text-primary" />
					<span>Live Multiplayer Studio Engine</span>
				</div>
				<h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
					True concurrency. <span className="bg-linear-to-r from-primary via-purple-400 to-indigo-400 bg-clip-text text-transparent">Zero sync conflicts.</span>
				</h2>
				<p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
					Multiple editors work inside the exact same project simultaneously.
					Every trim, cut, split, and audio tweak synchronizes in milliseconds over SpacetimeDB.
				</p>
			</div>

			{/* Studio Window Mockup */}
			<div className="rounded-2xl border border-primary/25 bg-background/90 shadow-2xl shadow-primary/15 backdrop-blur-xl overflow-hidden">
				{/* Top Studio Control Bar */}
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-card/60 px-4 py-3 sm:px-6">
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-1.5">
							<span className="size-2.5 rounded-full bg-red-500/80" />
							<span className="size-2.5 rounded-full bg-yellow-500/80" />
							<span className="size-2.5 rounded-full bg-green-500/80" />
						</div>
						<div className="h-4 w-px bg-border" />
						<span className="text-xs font-semibold text-foreground/80 sm:text-sm">
							project: <span className="font-mono text-primary font-bold">reel-summer-launch</span>
						</span>
						<span className="hidden sm:inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
							<span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
							SpacetimeDB Connected
						</span>
					</div>

					{/* Active Presence Avatars */}
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground hidden md:inline">Live in room:</span>
						<div className="flex -space-x-1.5 overflow-hidden">
							{COLLABORATORS.map((c) => (
								<button
									key={c.id}
									type="button"
									onClick={() => setActiveCollaborator(c.id)}
									title={`${c.name} (${c.role})`}
									className={cn(
										"relative size-7 rounded-full text-[11px] font-bold text-white flex items-center justify-center border-2 border-background transition-transform hover:scale-110",
										c.avatar,
										activeCollaborator === c.id && "ring-2 ring-primary ring-offset-1 ring-offset-background"
									)}
								>
									{c.name.slice(0, 1)}
								</button>
							))}
						</div>
						<span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
							4 Editors Online
						</span>
					</div>
				</div>

				{/* Active Collaborator Status Bar */}
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-primary/5 px-4 py-2 text-xs">
					{COLLABORATORS.map((c) => (
						<button
							key={c.id}
							type="button"
							onClick={() => setActiveCollaborator(c.id)}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all",
								activeCollaborator === c.id
									? cn("font-semibold shadow-xs border", c.color)
									: "text-muted-foreground hover:text-foreground"
							)}
						>
							<span className={cn("size-2 rounded-full", c.avatar)} />
							<span>{c.name}</span>
							<span className="opacity-70 text-[10px]">({c.role})</span>
						</button>
					))}
					<div className="ml-auto hidden lg:flex items-center gap-1.5 text-muted-foreground text-[11px]">
						<Eye className="size-3 text-primary" />
						<span>Follow Director Mode: Active</span>
					</div>
				</div>

				{/* Main Stage: Player Preview & Multi-track Timeline */}
				<div className="p-4 sm:p-6 space-y-6">
					{/* Video Canvas & Waveform Monitor */}
					<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
						{/* Viewport Monitor */}
						<div className="md:col-span-2 relative aspect-video rounded-xl border border-border/80 bg-neutral-950 flex flex-col items-center justify-center overflow-hidden shadow-inner group">
							{/* Simulated Video Frame */}
							<div className="absolute inset-0 bg-gradient-to-tr from-purple-950/40 via-neutral-900 to-indigo-950/40 flex items-center justify-center">
								<div className="relative text-center p-6">
									<div className="size-16 mx-auto mb-3 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center text-primary backdrop-blur-md shadow-lg shadow-primary/20">
										<Film className="size-8" />
									</div>
									<div className="text-lg font-bold text-white tracking-wide">
										CoClip 4K Canvas
									</div>
									<div className="text-xs text-primary font-mono mt-1">
										1920 × 1080 • 60 FPS • Rec.709
									</div>
								</div>
							</div>

							{/* Active Editor Hover Tag */}
							<div className="absolute top-3 left-3 flex items-center gap-1.5 rounded-full bg-black/70 border border-purple-500/50 px-2.5 py-1 text-xs text-purple-300 backdrop-blur-md">
								<span className="size-1.5 rounded-full bg-purple-400 animate-pulse" />
								<span>Ada: Adjusting Clip Framing</span>
							</div>

							{/* AI Agent Overlay Indicator */}
							<div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-black/70 border border-amber-500/50 px-2.5 py-1 text-xs text-amber-300 backdrop-blur-md">
								<Sparkles className="size-3" />
								<span>OpenAI: Timeline Active</span>
							</div>

							{/* Video Controls bar */}
							<div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-3 flex items-center justify-between text-xs">
								<div className="flex items-center gap-2">
									<button
										type="button"
										onClick={() => setIsPlaying(!isPlaying)}
										className="size-8 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary/90 transition-colors shadow-md shadow-primary/25"
									>
										{isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
									</button>
									<span className="font-mono text-xs text-white/90">00:03:14:18</span>
									<span className="text-neutral-500">/</span>
									<span className="font-mono text-xs text-neutral-400">00:10:00:00</span>
								</div>
								<div className="flex items-center gap-3 text-neutral-400 text-[11px]">
									<span>GPU Hardware Accel</span>
									<span className="text-emerald-400">● 60 FPS</span>
								</div>
							</div>
						</div>

						{/* Live Activity & Sync Ticker */}
						<div className="rounded-xl border border-border/80 bg-card/40 p-4 flex flex-col justify-between">
							<div>
								<div className="flex items-center justify-between pb-3 border-b border-border/60">
									<span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
										<Users className="size-3.5 text-primary" />
										Real-Time Timeline Actions
									</span>
									<span className="text-[10px] text-muted-foreground">SpacetimeDB Sync</span>
								</div>
								<div className="mt-3 space-y-3">
									{ACTIVITY_FEED.map((item, idx) => (
										<div key={idx} className="text-xs leading-relaxed">
											<div className="flex items-center justify-between">
												<span className={cn("font-semibold", item.color)}>{item.user}</span>
												<span className="text-[10px] text-muted-foreground">{item.time}</span>
											</div>
											<div className="text-muted-foreground text-[11px] mt-0.5">{item.action}</div>
										</div>
									))}
								</div>
							</div>

							<div className="mt-4 pt-3 border-t border-border/60 bg-primary/5 -mx-4 -mb-4 p-3 rounded-b-xl flex items-center gap-2 text-xs text-primary font-medium">
								<CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
								<span>All 4 peers in sync (0 dropped frames)</span>
							</div>
						</div>
					</div>

					{/* Multi-Track Timeline Simulation */}
					<div className="rounded-xl border border-border/80 bg-neutral-950/70 p-4 space-y-3 relative select-none">
						{/* Timeline Ruler */}
						<div className="flex items-center justify-between text-[10px] font-mono text-neutral-500 px-20 border-b border-neutral-800 pb-1.5">
							<span>00:00:00</span>
							<span>00:02:00</span>
							<span>00:04:00</span>
							<span>00:06:00</span>
							<span>00:08:00</span>
							<span>00:10:00</span>
						</div>

						{/* Moving Playhead Bar */}
						<div
							className="absolute top-4 bottom-4 w-0.5 bg-primary z-20 pointer-events-none transition-all duration-75 shadow-[0_0_10px_rgba(168,85,247,0.8)]"
							style={{ left: `calc(${playheadPos}% + 4rem)` }}
						>
							<div className="absolute -top-2 -translate-x-1/2 size-3 bg-primary rotate-45 rounded-xs border border-white" />
							<div className="absolute top-2 -translate-x-1/2 rounded bg-primary px-1 text-[9px] font-mono text-white whitespace-nowrap shadow-md">
								Ada (Director)
							</div>
						</div>

						{/* Track 1: Video Primary */}
						<div className="flex items-center gap-2">
							<div className="w-20 shrink-0 text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
								<Film className="size-3.5 text-purple-400" />
								<span>V1 • Main</span>
							</div>
							<div className="flex-1 h-12 bg-neutral-900/90 rounded-lg p-1 flex gap-2 relative overflow-hidden border border-neutral-800">
								{/* Clip 1 */}
								<div className="w-1/4 h-full rounded bg-purple-950/60 border border-purple-500/80 px-2 flex items-center justify-between text-xs text-purple-200">
									<span className="truncate">Intro_Reel.mp4</span>
									<span className="text-[10px] opacity-75 font-mono">02:15</span>
								</div>
								{/* Clip 2 - Selected by Kai */}
								<div className="w-2/5 h-full rounded bg-sky-950/60 border-2 border-sky-400 px-2 flex items-center justify-between text-xs text-sky-200 ring-2 ring-sky-500/30">
									<span className="truncate">Main_Interview.mp4</span>
									<span className="text-[10px] bg-sky-500/30 px-1 rounded font-semibold text-sky-300">Kai selected</span>
								</div>
								{/* Clip 3 - Trimming by Ada */}
								<div className="flex-1 h-full rounded bg-purple-950/80 border-2 border-primary px-2 flex items-center justify-between text-xs text-purple-100 shadow-md shadow-primary/20">
									<span className="truncate font-medium">B-Roll_Sunset.mp4</span>
									<div className="flex items-center gap-1">
										<Scissors className="size-3 text-primary animate-pulse" />
										<span className="text-[10px] bg-primary/40 px-1 rounded font-bold text-white">Ada trimming</span>
									</div>
								</div>
							</div>
						</div>

						{/* Track 2: Overlays / Motion */}
						<div className="flex items-center gap-2">
							<div className="w-20 shrink-0 text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
								<Scissors className="size-3.5 text-fuchsia-400" />
								<span>V2 • Titles</span>
							</div>
							<div className="flex-1 h-11 bg-neutral-900/90 rounded-lg p-1 flex gap-2 relative overflow-hidden border border-neutral-800">
								<div className="w-1/6" />
								{/* Clip Title - Edited by Nova */}
								<div className="w-1/3 h-full rounded bg-fuchsia-950/70 border-2 border-fuchsia-400 px-2 flex items-center justify-between text-xs text-fuchsia-200 shadow-md shadow-fuchsia-500/20">
									<span className="truncate">LowerThird_Title.svg</span>
									<span className="text-[10px] bg-fuchsia-500/30 px-1 rounded font-semibold text-fuchsia-300">Nova moving</span>
								</div>
								<div className="w-1/4 h-full rounded bg-neutral-800/80 border border-neutral-700 px-2 flex items-center text-xs text-neutral-400">
									<span className="truncate">Chroma_Overlay.mov</span>
								</div>
							</div>
						</div>

						{/* Track 3: Audio Master */}
						<div className="flex items-center gap-2">
							<div className="w-20 shrink-0 text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
								<Volume2 className="size-3.5 text-amber-400" />
								<span>A1 • Audio</span>
							</div>
							<div className="flex-1 h-12 bg-neutral-900/90 rounded-lg p-1 flex gap-2 relative overflow-hidden border border-neutral-800">
								{/* Full Soundtrack Clip with Waveform and AI Copilot indicator */}
								<div className="w-full h-full rounded bg-amber-950/40 border-2 border-amber-400/80 px-3 flex items-center justify-between text-xs text-amber-200">
									<div className="flex items-center gap-2">
										<Sparkles className="size-3.5 text-amber-400 animate-bounce" />
										<span className="font-medium">Master_Soundtrack.wav</span>
										<span className="text-[10px] bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 rounded text-amber-300 font-mono">
											AI leveled: -3.0 dB
										</span>
									</div>
									{/* Waveform graphic bars */}
									<div className="hidden sm:flex items-center gap-0.5 opacity-60">
										{[4, 8, 14, 20, 12, 6, 18, 22, 16, 10, 14, 20, 8, 12, 18, 24, 16, 10, 14, 22, 18, 12, 6].map((h, i) => (
											<div key={i} className="w-1 bg-amber-400 rounded-full" style={{ height: `${h}px` }} />
										))}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
