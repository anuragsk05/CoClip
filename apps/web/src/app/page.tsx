import { Hero } from "@/components/landing/hero";
import { CollaborationShowcase } from "@/components/landing/collaboration-showcase";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { HowItWorks } from "@/components/landing/how-it-works";
import { CtaSection } from "@/components/landing/cta-section";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import type { Metadata } from "next";
import { SITE_URL } from "@/site/brand";

export const metadata: Metadata = {
	title: "CoClip — Real-Time Collaborative Video Editor",
	description:
		"The browser-native video editor built for real-time collaboration. Multi-track timelines, multiplayer presence, deterministic state sync, and AI co-editors.",
	alternates: {
		canonical: SITE_URL,
	},
};

export default async function Home() {
	return (
		<div className="flex flex-col min-h-screen">
			<Header />
			<main className="flex-1">
				<Hero />
				<CollaborationShowcase />
				<FeaturesGrid />
				<HowItWorks />
				<CtaSection />
			</main>
			<Footer />
		</div>
	);
}
