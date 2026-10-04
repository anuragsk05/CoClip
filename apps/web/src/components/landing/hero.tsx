"use client";

import { Button } from "../ui/button";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import { Handlebars } from "./handlebars";
import Link from "next/link";

export function Hero() {
	return (
		<div className="relative flex min-h-[calc(100svh-4.5rem)] flex-col items-center justify-between px-4 text-center overflow-hidden">
			{/* Ambient purple studio glow */}
			<div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[640px] h-[380px] bg-primary/25 blur-[140px] rounded-full pointer-events-none -z-40" />
			<Image
				className="absolute top-0 left-0 -z-50 size-full object-cover opacity-75 dark:opacity-60 invert dark:invert-0"
				src="/landing-page-dark.png"
				height={1903.5}
				width={1269}
				alt="CoClip video editor studio interface"
				priority
			/>
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center items-center">
				<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary backdrop-blur-md shadow-sm">
					<span className="flex size-2 rounded-full bg-primary animate-pulse" />
					<span>CoClip Studio • Modern Creative Suite</span>
				</div>

				<div className="inline-block text-4xl font-extrabold tracking-tight md:text-[4.25rem] leading-[1.1]">
					<h1 className="bg-linear-to-b from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
						The modern creative
					</h1>
					<Handlebars>Video editor</Handlebars>
				</div>

				<p className="text-muted-foreground mx-auto mt-7 max-w-xl text-base font-normal tracking-normal sm:text-lg leading-relaxed">
					Fast, intuitive, and professional video editing in your browser.
					Multi-track timeline, instant rendering, and hardware-accelerated exports.
				</p>

				<div className="mt-9 flex flex-wrap justify-center gap-4">
					<Link href="/projects">
						<Button
							size="lg"
							className="h-12 px-7 text-base font-semibold bg-linear-to-r from-primary via-purple-600 to-indigo-600 hover:opacity-95 text-white shadow-xl shadow-primary/25 border-none transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
						>
							Launch Studio Free
							<ArrowRight className="ml-1 size-4.5" />
						</Button>
					</Link>
				</div>
			</div>
		</div>
	);
}
