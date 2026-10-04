import { Users, Zap, Eye, Sparkles, Cpu, Film, ArrowUpRight } from "lucide-react";
import Link from "next/link";

interface Feature {
	icon: React.ElementType;
	title: string;
	description: string;
	tag: string;
}

const FEATURES: Feature[] = [
	{
		icon: Users,
		title: "Simultaneous Timeline Concurrency",
		description:
			"Multiple video editors work concurrently on the same multi-track timeline. Trim B-roll while your sound lead mixes the soundtrack—without merge conflicts or lockouts.",
		tag: "Multiplayer Engine",
	},
	{
		icon: Zap,
		title: "Deterministic SpacetimeDB State",
		description:
			"Transactions execute through deterministic WebAssembly reducers. Every cut and split is synchronized across peers with sub-millisecond roundtrips.",
		tag: "Zero Latency",
	},
	{
		icon: Eye,
		title: "Live Presence & Follow Mode",
		description:
			"Track team playheads, cursor selections, and active clip transforms in real time. Switch to 'Follow Director' mode to review cuts together in perfect sync.",
		tag: "Presence Sync",
	},
	{
		icon: Sparkles,
		title: "Autonomous AI Timeline Co-Editor",
		description:
			"Summon an OpenAI-powered editor directly into your shared room. Prompt it to remove pauses, suggest split points, add markers, or level stems alongside you.",
		tag: "AI Collaborator",
	},
	{
		icon: Cpu,
		title: "Zero Upload Lag • Pure Browser Speed",
		description:
			"Never wait for 20GB video uploads to cloud servers. CoClip decodes and renders locally using hardware-accelerated WebCodecs and GPU shaders.",
		tag: "In-Browser Performance",
	},
	{
		icon: Film,
		title: "Studio-Grade Multi-Track Suite",
		description:
			"Everything you need for serious video production: multi-track video & audio, waveforms, transitions, chroma key, blend modes, and instant 4K MP4 export.",
		tag: "Full Creative Suite",
	},
];

export function FeaturesGrid() {
	return (
		<section id="features" className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
			{/* Ambient background glow */}
			<div className="absolute top-1/3 right-10 w-[500px] h-[350px] bg-primary/15 blur-[130px] rounded-full pointer-events-none -z-10" />

			{/* Section Header */}
			<div className="mb-14 text-center">
				<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary backdrop-blur-md">
					<span>Engineered for Teams</span>
				</div>
				<h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
					Collaborative video editing, <span className="bg-linear-to-r from-primary via-purple-400 to-indigo-400 bg-clip-text text-transparent">reinvented.</span>
				</h2>
				<p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
					Everything you love about modern desktop editors, supercharged with real-time multiplayer sync and autonomous AI cooperation.
				</p>
			</div>

			{/* Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
				{FEATURES.map((feature, idx) => {
					const Icon = feature.icon;
					return (
						<div
							key={idx}
							className="group relative rounded-2xl border border-border/80 bg-card/60 p-6 backdrop-blur-sm transition-all duration-300 hover:border-primary/50 hover:bg-card/90 hover:shadow-xl hover:shadow-primary/10 flex flex-col justify-between"
						>
							<div>
								<div className="flex items-center justify-between mb-4">
									<div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 border border-primary/25 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-white">
										<Icon className="size-5.5" />
									</div>
									<span className="text-[11px] font-medium font-mono text-muted-foreground uppercase tracking-wider rounded-full border border-border px-2.5 py-0.5">
										{feature.tag}
									</span>
								</div>
								<h3 className="text-lg font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">
									{feature.title}
								</h3>
								<p className="text-muted-foreground mt-2 text-sm leading-relaxed">
									{feature.description}
								</p>
							</div>

							<div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between text-xs text-muted-foreground">
								<span className="font-medium text-foreground/80">Built into CoClip Studio</span>
								<ArrowUpRight className="size-4 text-primary opacity-0 -translate-x-1 translate-y-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 group-hover:translate-y-0" />
							</div>
						</div>
					);
				})}
			</div>

			{/* Bottom quick banner */}
			<div className="mt-12 rounded-2xl border border-primary/25 bg-linear-to-r from-primary/10 via-purple-600/10 to-indigo-600/10 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
				<div>
					<h3 className="text-lg sm:text-xl font-bold text-foreground">
						No account or credit card required to start
					</h3>
					<p className="text-muted-foreground text-sm mt-1">
						Open CoClip in any modern browser, launch a timeline, and share your room link.
					</p>
				</div>
				<Link
					href="/projects"
					className="shrink-0 inline-flex items-center justify-center h-11 px-6 rounded-xl font-semibold text-sm bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary/25 transition-all hover:scale-[1.02]"
				>
					Open Free Studio
				</Link>
			</div>
		</section>
	);
}
