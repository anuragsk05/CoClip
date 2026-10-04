"use client";

import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { SOCIAL_LINKS } from "@/site/social";
import { useLocalStorage } from "@/services/storage/use-local-storage";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "../ui/dialog";

export function Onboarding() {
	const [step, setStep] = useState(0);
	const [hasSeenOnboarding, setHasSeenOnboarding] = useLocalStorage({
		key: "hasSeenOnboarding",
		defaultValue: false,
	});

	const isOpen = !hasSeenOnboarding;

	const handleNext = () => {
		setStep(step + 1);
	};

	const handleClose = () => {
		setHasSeenOnboarding({ value: true });
	};

	const getStepTitle = () => {
		switch (step) {
			case 0:
				return "Welcome to CoClip Studio";
			case 1:
				return "Powerful Creative Tools";
			case 2:
				return "Ready to Create";
			default:
				return "CoClip Studio";
		}
	};

	const renderStepContent = () => {
		switch (step) {
			case 0:
				return (
					<div className="space-y-6 py-2">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
							<span className="text-xl">✨</span>
						</div>
						<div className="space-y-2">
							<Title title="Welcome to CoClip Studio" />
							<Description description="A high-performance creative video editor designed right in your browser. Fast, fluid, and built for modern creator workflows." />
						</div>
						<div className="flex items-center justify-between pt-2">
							<div className="flex gap-1.5">
								<span className="size-2 rounded-full bg-primary" />
								<span className="size-2 rounded-full bg-muted" />
								<span className="size-2 rounded-full bg-muted" />
							</div>
							<NextButton onClick={handleNext}>Explore Studio</NextButton>
						</div>
					</div>
				);
			case 1:
				return (
					<div className="space-y-6 py-2">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
							<span className="text-xl">⚡</span>
						</div>
						<div className="space-y-2">
							<Title title="Powerful Creative Suite" />
							<Description description="Layer multiple video and audio tracks, customize typography, apply filters, and compose effects seamlessly with instant playback." />
						</div>
						<div className="flex items-center justify-between pt-2">
							<div className="flex gap-1.5">
								<span className="size-2 rounded-full bg-muted" />
								<span className="size-2 rounded-full bg-primary" />
								<span className="size-2 rounded-full bg-muted" />
							</div>
							<NextButton onClick={handleNext}>Continue</NextButton>
						</div>
					</div>
				);
			case 2:
				return (
					<div className="space-y-6 py-2">
						<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary">
							<span className="text-xl">🎬</span>
						</div>
						<div className="space-y-2">
							<Title title="Ready to Create" />
							<Description description="Drag and drop your media files into the assets drawer or directly onto the timeline to begin your project." />
						</div>
						<div className="flex items-center justify-between pt-2">
							<div className="flex gap-1.5">
								<span className="size-2 rounded-full bg-muted" />
								<span className="size-2 rounded-full bg-muted" />
								<span className="size-2 rounded-full bg-primary" />
							</div>
							<NextButton onClick={handleClose}>Start Editing</NextButton>
						</div>
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-[440px] border-border/80 bg-background/95 backdrop-blur-xl shadow-2xl shadow-primary/10">
				<DialogTitle>
					<span className="sr-only">{getStepTitle()}</span>
				</DialogTitle>
				<DialogBody>{renderStepContent()}</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

function Title({ title }: { title: string }) {
	return <h2 className="text-lg font-bold md:text-xl">{title}</h2>;
}

function Description({ description }: { description: string }) {
	return (
		<div className="text-muted-foreground">
			<ReactMarkdown
				components={{
					p: ({ children }) => <p className="mb-0">{children}</p>,
					a: ({ href, children }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-foreground hover:text-foreground/80 underline"
						>
							{children}
						</a>
					),
				}}
			>
				{description}
			</ReactMarkdown>
		</div>
	);
}

function NextButton({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<Button onClick={onClick} variant="primary" className="rounded-lg shadow-md shadow-primary/20 hover:shadow-primary/30">
			{children}
			<ArrowRightIcon className="size-4" />
		</Button>
	);
}
