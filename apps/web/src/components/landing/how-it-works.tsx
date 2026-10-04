import { Share2, Users, Download, ArrowRight } from "lucide-react";
import Link from "next/link";

const STEPS = [
	{
		number: "01",
		icon: Share2,
		title: "Create & Share Studio Room",
		description:
			"Start a project in your browser with a single click. Share your unique room link with directors, editors, or sound designers to collaborate instantly.",
		badge: "Instant Link",
	},
	{
		number: "02",
		icon: Users,
		title: "Edit Concurrently in Real Time",
		description:
			"Cut, trim, layer video tracks, arrange audio waveforms, and add effects together. Watch each other's live selections, trims, and playhead movements.",
		badge: "Multiplayer Canvas",
	},
	{
		number: "03",
		icon: Download,
		title: "Hardware-Accelerated 4K Export",
		description:
			"Render your finished video directly using local GPU acceleration via WebCodecs. Fast, uncompressed, with zero server render queues or watermarks.",
		badge: "GPU Powered",
	},
];

export function HowItWorks() {
	return (
		<section id="how-it-works" className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
			{/* Ambient background glow */}
			<div className="absolute top-1/2 left-1/4 -translate-x-1/2 w-[550px] h-[350px] bg-primary/15 blur-[140px] rounded-full pointer-events-none -z-10" />

			{/* Section Header */}
			<div className="mb-16 text-center">
				<div className="mb-3 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary backdrop-blur-md">
					<span>Seamless Workflow</span>
				</div>
				<h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
					How <span className="bg-linear-to-r from-primary via-purple-400 to-indigo-400 bg-clip-text text-transparent">CoClip Works</span>
				</h2>
				<p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
					From raw media to collaborative master cut in three effortless steps.
				</p>
			</div>

			{/* Step Cards */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
				{STEPS.map((step, idx) => {
					const Icon = step.icon;
					return (
						<div
							key={idx}
							className="relative rounded-2xl border border-border/80 bg-card/60 p-7 backdrop-blur-sm transition-all duration-300 hover:border-primary/50 hover:bg-card/90 hover:shadow-xl hover:shadow-primary/15 flex flex-col justify-between"
						>
							<div>
								{/* Step Number & Badge */}
								<div className="flex items-center justify-between mb-6">
									<span className="text-3xl font-black font-mono text-primary/30 tracking-tight">
										{step.number}
									</span>
									<span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
										{step.badge}
									</span>
								</div>

								{/* Icon */}
								<div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/30 shadow-sm shadow-primary/10">
									<Icon className="size-6" />
								</div>

								{/* Title & Description */}
								<h3 className="text-xl font-bold text-foreground tracking-tight">
									{step.title}
								</h3>
								<p className="text-muted-foreground mt-3 text-sm leading-relaxed">
									{step.description}
								</p>
							</div>

							<div className="mt-8 pt-4 border-t border-border/50 flex items-center gap-2 text-xs font-medium text-primary">
								<span>Step {idx + 1} of 3</span>
							</div>
						</div>
					);
				})}
			</div>

			{/* Center CTA button */}
			<div className="mt-14 text-center">
				<Link
					href="/projects"
					className="inline-flex items-center gap-2 h-12 px-8 rounded-xl font-semibold text-sm bg-linear-to-r from-primary via-purple-600 to-indigo-600 text-white shadow-xl shadow-primary/25 hover:opacity-95 transition-all hover:scale-[1.02] active:scale-[0.98]"
				>
					<span>Start Creating Together</span>
					<ArrowRight className="size-4" />
				</Link>
			</div>
		</section>
	);
}
