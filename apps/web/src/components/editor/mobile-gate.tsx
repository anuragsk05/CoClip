"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "../ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "mobile-acknowledged";

interface MobileGateProps {
	children: React.ReactNode;
}

export function MobileGate({ children }: MobileGateProps) {
	const router = useRouter();
	const [show, setShow] = useState<boolean | null>(null);

	useEffect(() => {
		const isMobile = window.innerWidth < 1024;
		const acknowledged = localStorage.getItem(STORAGE_KEY) === "true";
		setShow(isMobile && !acknowledged);
	}, []);

	if (show === null) return null;
	if (!show) return <>{children}</>;

	const handleContinue = () => {
		localStorage.setItem(STORAGE_KEY, "true");
		setShow(false);
	};

	const handleGoBack = () => {
		router.back();
	};

	return (
		<div className="bg-background relative flex h-screen w-screen flex-col overflow-hidden">
			<Button
				variant="text"
				className="absolute top-6 left-6 flex items-center gap-1 text-muted-foreground"
				onClick={handleGoBack}
			>
				<HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
				<span className=" text-sm">Go back</span>
			</Button>

			<div className="flex flex-1 flex-col justify-center gap-5 px-7">
				<div className="flex flex-col gap-3">
					<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 text-primary mb-2">
						<span className="text-xl">🖥️</span>
					</div>
					<h1 className="text-foreground text-3xl font-bold tracking-tight">
						Desktop Studio Recommended
					</h1>
					<p className="text-muted-foreground text-sm leading-relaxed max-w-md">
						CoClip Studio offers an extensive multi-track timeline designed for
						high-precision editing and keyboard workflows. For the best experience,
						we recommend accessing the studio from a desktop browser.
					</p>
				</div>
				<div className="flex items-center gap-3">
					<Button variant="primary" onClick={handleContinue} className="shadow-md shadow-primary/20">
						Continue to Studio
					</Button>
					<Button variant="ghost" asChild>
						<Link href="/" className="flex items-center gap-1">
							Return Home
							<HugeiconsIcon icon={ArrowRight01Icon} size={14} />
						</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
