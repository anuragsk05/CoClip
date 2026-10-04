import { ArrowRight, CheckCircle2, Sparkles } from "lucide-react";
import Link from "next/link";
import { SOCIAL_LINKS } from "@/site/social";
import { FaGithub } from "react-icons/fa6";

export function CtaSection() {
	return (
		<section className="relative mx-auto w-full max-w-5xl px-4 py-24 sm:px-6">
			{/* Ambient studio glow */}
			<div className="absolute inset-0 bg-radial from-primary/25 via-purple-900/10 to-transparent blur-[120px] rounded-3xl pointer-events-none -z-10" />

			<div className="relative rounded-3xl border border-primary/30 bg-card/80 p-8 sm:p-14 text-center backdrop-blur-xl shadow-2xl shadow-primary/20 overflow-hidden">
				{/* Top badge */}
				<div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary backdrop-blur-md">
					<Sparkles className="size-3.5 text-primary" />
					<span>Free • No Signup Required • Real-Time</span>
				</div>

				{/* Title */}
				<h2 className="text-3xl font-black tracking-tight sm:text-4xl md:text-5xl text-foreground max-w-3xl mx-auto leading-[1.15]">
					Stop sending project files back and forth.{" "}
					<span className="bg-linear-to-r from-primary via-purple-400 to-indigo-400 bg-clip-text text-transparent">
						Create together in CoClip.
					</span>
				</h2>

				{/* Subtitle */}
				<p className="text-muted-foreground mx-auto mt-5 max-w-xl text-base sm:text-lg leading-relaxed">
					Launch the studio in seconds. Invite your team into a live room, edit multi-track footage simultaneously, and export 4K video instantly.
				</p>

				{/* CTA Buttons */}
				<div className="mt-9 flex flex-wrap justify-center gap-4">
					<Link
						href="/projects"
						className="inline-flex items-center gap-2 h-13 px-8 rounded-xl font-bold text-base bg-linear-to-r from-primary via-purple-600 to-indigo-600 text-white shadow-xl shadow-primary/30 hover:opacity-95 transition-all hover:scale-[1.03] active:scale-[0.98]"
					>
						<span>Launch CoClip Studio</span>
						<ArrowRight className="size-5" />
					</Link>
					<Link
						href={SOCIAL_LINKS.github}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 h-13 px-6 rounded-xl font-semibold text-base border border-border/80 bg-background/80 hover:bg-muted/80 text-foreground transition-all hover:border-primary/40"
					>
						<FaGithub className="size-5" />
						<span>View on GitHub</span>
					</Link>
				</div>

				{/* Value propositions */}
				<div className="mt-12 pt-8 border-t border-border/60 flex flex-wrap justify-center items-center gap-6 sm:gap-10 text-xs sm:text-sm text-muted-foreground">
					<div className="flex items-center gap-2">
						<CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
						<span>No account or card required</span>
					</div>
					<div className="flex items-center gap-2">
						<CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
						<span>Real-time SpacetimeDB sync</span>
					</div>
					<div className="flex items-center gap-2">
						<CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
						<span>Hardware-accelerated local export</span>
					</div>
				</div>
			</div>
		</section>
	);
}
