"use client";

import { Button } from "../ui/button";
import { ArrowRight, Radio, Zap, Users, Film } from "lucide-react";
import Image from "next/image";
import { Handlebars } from "./handlebars";
import Link from "next/link";

export function Hero() {
	return (
		<div className="relative flex min-h-[calc(100svh-4.5rem)] flex-col items-center justify-center px-4 pt-12 pb-20 text-center overflow-hidden">
			{/* Ambient purple studio glow */}
			<div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[720px] h-[440px] bg-primary/25 blur-[150px] rounded-full pointer-events-none -z-40" />
			<div className="absolute top-2/3 right-1/4 w-[400px] h-[300px] bg-purple-700/15 blur-[130px] rounded-full pointer-events-none -z-40" />

			<Image
				className="absolute top-0 left-0 -z-50 size-full object-cover opacity-65 dark:opacity-45 invert dark:invert-0 pointer-events-none"
				src="/landing-page-dark.png"
				height={1903.5}
				width={1269}
				alt="CoClip real-time collaborative video editor studio"
				priority
			/>

			<div className="mx-auto flex w-full max-w-4xl flex-col justify-center items-center">
				{/* Top Live Badge */}
				<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/35 bg-primary/15 px-4 py-1.5 text-xs font-semibold text-primary backdrop-blur-md shadow-md shadow-primary/10">
					<span className="flex size-2 rounded-full bg-primary animate-pulse" />
					<span>CoClip • Real-Time Collaborative Video Editor</span>
				</div>

				{/* Main Headline */}
				<div className="inline-block text-4xl font-extrabold tracking-tight sm:text-5xl md:text-[4.75rem] leading-[1.08]">
					<h1 className="bg-linear-to-b from-foreground via-foreground to-foreground/80 bg-clip-text text-transparent">
						Create videos together.
					</h1>
					<Handlebars>In real time.</Handlebars>
				</div>

				{/* Subheadline */}
				<p className="text-muted-foreground mx-auto mt-7 max-w-2xl text-base sm:text-lg font-normal tracking-normal leading-relaxed">
					The browser-native video editor built for seamless multiplayer creation.
					Sync multi-track timelines instantly, follow team playheads in real time,
					and collaborate with AI co-editors—zero rendering lags or file upload waits.
				</p>

				{/* Primary Call to Action Buttons */}
				<div className="mt-9 flex flex-wrap justify-center items-center gap-4">
					<Link href="/projects">
						<Button
							size="lg"
							className="h-12 px-7 text-base font-semibold bg-linear-to-r from-primary via-purple-600 to-indigo-600 hover:opacity-95 text-white shadow-xl shadow-primary/30 border-none transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
						>
							Launch Studio Free
							<ArrowRight className="ml-1 size-4.5" />
						</Button>
					</Link>
					<a href="#collaboration">
						<Button
							size="lg"
							variant="outline"
							className="h-12 px-6 text-base font-semibold border-border/80 bg-background/80 hover:bg-muted/80 backdrop-blur-sm transition-all hover:border-primary/50"
						>
							<Radio className="mr-1.5 size-4 text-primary animate-pulse" />
							See Live Multiplayer
						</Button>
					</a>
				</div>

				{/* Feature Pill Highlights */}
				<div className="mt-12 flex flex-wrap justify-center items-center gap-3 sm:gap-6 text-xs text-muted-foreground font-medium">
					<div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3.5 py-1.5 backdrop-blur-sm">
						<Zap className="size-3.5 text-primary" />
						<span>SpacetimeDB Sync</span>
					</div>
					<div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3.5 py-1.5 backdrop-blur-sm">
						<Users className="size-3.5 text-primary" />
						<span>Simultaneous Multi-Track Editing</span>
					</div>
					<div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3.5 py-1.5 backdrop-blur-sm">
						<Film className="size-3.5 text-primary" />
						<span>Hardware-Accelerated 4K</span>
					</div>
				</div>
			</div>
		</div>
	);
}
