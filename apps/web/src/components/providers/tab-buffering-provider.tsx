"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useTabBufferingStore, tabBuffering } from "@/hooks/use-tab-buffering";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const FRAME_INTERVAL_MS = 75; // Smooth ~13 fps for browser tab icon and title

interface IconBackup {
	element: HTMLLinkElement;
	originalHref: string;
}

export function TabBufferingProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const isLoading = useTabBufferingStore((s) => s.isLoading);
	const activeMessage = useTabBufferingStore((s) => s.activeMessage);
	const pathname = usePathname();

	const originalTitleRef = useRef<string>("");
	const iconBackupsRef = useRef<IconBackup[]>([]);
	const dynamicFaviconRef = useRef<HTMLLinkElement | null>(null);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const frameIndexRef = useRef<number>(0);
	const angleRef = useRef<number>(0);

	// Clear temporary navigation-level tasks whenever pathname transitions complete
	useEffect(() => {
		tabBuffering.stop("navigation");
		tabBuffering.stop("opening-project");
	}, [pathname]);

	// Intercept internal link clicks to show buffering immediately in the tab
	useEffect(() => {
		const handleDocumentClick = (event: MouseEvent) => {
			const target = (event.target as HTMLElement | null)?.closest("a");
			if (!target || !target.href) return;

			// Skip modifier clicks (opening in new tab/window)
			if (
				event.ctrlKey ||
				event.metaKey ||
				event.shiftKey ||
				event.altKey ||
				target.target === "_blank"
			) {
				return;
			}

			try {
				const targetUrl = new URL(target.href, window.location.href);
				if (
					targetUrl.origin === window.location.origin &&
					targetUrl.pathname !== window.location.pathname
				) {
					if (targetUrl.pathname.startsWith("/editor/")) {
						tabBuffering.start("opening-project", "Opening project...");
					} else {
						tabBuffering.start("navigation", "Loading...");
					}
				}
			} catch {
				// Ignore malformed URLs
			}
		};

		window.addEventListener("click", handleDocumentClick, { capture: true });
		return () => {
			window.removeEventListener("click", handleDocumentClick, {
				capture: true,
			});
		};
	}, []);

	// Animate browser tab favicon and title when loading
	useEffect(() => {
		if (typeof window === "undefined" || typeof document === "undefined") {
			return;
		}

		if (!isLoading) {
			// Restore original document title
			if (originalTitleRef.current) {
				// Strip any previous spinner symbol if present
				document.title = originalTitleRef.current.replace(
					/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/,
					"",
				);
				originalTitleRef.current = "";
			}

			// Restore all original favicon links
			if (iconBackupsRef.current.length > 0) {
				for (const backup of iconBackupsRef.current) {
					if (document.head.contains(backup.element)) {
						backup.element.href = backup.originalHref;
					}
				}
				iconBackupsRef.current = [];
			}

			// Remove dynamic favicon element
			if (
				dynamicFaviconRef.current &&
				document.head.contains(dynamicFaviconRef.current)
			) {
				dynamicFaviconRef.current.remove();
				dynamicFaviconRef.current = null;
			}

			return;
		}

		// 1. Capture original title
		if (!originalTitleRef.current) {
			const cleanTitle = document.title.replace(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/, "");
			originalTitleRef.current = cleanTitle || "CoClip";
		}

		// 2. Capture and prepare favicon links
		if (iconBackupsRef.current.length === 0) {
			const existingIcons = Array.from(
				document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']"),
			);
			iconBackupsRef.current = existingIcons.map((el) => ({
				element: el,
				originalHref: el.getAttribute("href") || el.href,
			}));

			// Create a high-priority 64x64 dynamic icon tag
			let dynamicFavicon = document.getElementById(
				"coclip-buffering-favicon",
			) as HTMLLinkElement | null;
			if (!dynamicFavicon) {
				dynamicFavicon = document.createElement("link");
				dynamicFavicon.id = "coclip-buffering-favicon";
				dynamicFavicon.rel = "icon";
				dynamicFavicon.type = "image/png";
				dynamicFavicon.sizes = "64x64";
				document.head.appendChild(dynamicFavicon);
			}
			dynamicFaviconRef.current = dynamicFavicon;
		}

		// 3. Prepare drawing canvas
		if (!canvasRef.current) {
			const canvas = document.createElement("canvas");
			canvas.width = 64;
			canvas.height = 64;
			canvasRef.current = canvas;
		}

		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");

		const intervalId = window.setInterval(() => {
			frameIndexRef.current =
				(frameIndexRef.current + 1) % SPINNER_FRAMES.length;
			angleRef.current = (angleRef.current + (Math.PI * 2) / 18) % (Math.PI * 2);

			// Update browser tab title
			const spinnerChar = SPINNER_FRAMES[frameIndexRef.current];
			const messageText = activeMessage || "Loading...";
			let baseTitle = originalTitleRef.current.replace(
				/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s*/,
				"",
			);
			if (!baseTitle.includes("CoClip")) {
				baseTitle = baseTitle ? `${baseTitle} | CoClip` : "CoClip";
			}
			document.title = `${spinnerChar} ${messageText} | CoClip`;

			// Draw animated buffering spinner on favicon
			if (ctx) {
				ctx.clearRect(0, 0, 64, 64);

				const center = 32;
				const radius = 22;

				// Circular track (subtle translucent purple)
				ctx.beginPath();
				ctx.arc(center, center, radius, 0, Math.PI * 2);
				ctx.strokeStyle = "rgba(168, 85, 247, 0.22)";
				ctx.lineWidth = 5.5;
				ctx.stroke();

				// Spinning purple buffering arc
				const currentAngle = angleRef.current;
				const arcSpan = Math.PI * 1.35;
				ctx.beginPath();
				ctx.arc(center, center, radius, currentAngle, currentAngle + arcSpan);

				// Gradient across the arc
				const startX = center + Math.cos(currentAngle) * radius;
				const startY = center + Math.sin(currentAngle) * radius;
				const endX = center + Math.cos(currentAngle + arcSpan) * radius;
				const endY = center + Math.sin(currentAngle + arcSpan) * radius;

				const gradient = ctx.createLinearGradient(startX, startY, endX, endY);
				gradient.addColorStop(0, "rgba(168, 85, 247, 0.15)");
				gradient.addColorStop(0.45, "#9333ea");
				gradient.addColorStop(1, "#c084fc");

				ctx.strokeStyle = gradient;
				ctx.lineWidth = 6;
				ctx.lineCap = "round";
				ctx.stroke();

				// Glowing / pulsing center dot
				const pulseRadius = 4 + Math.sin(currentAngle * 2.5) * 1.2;
				ctx.beginPath();
				ctx.arc(center, center, Math.max(2, pulseRadius), 0, Math.PI * 2);
				ctx.fillStyle = "#a855f7";
				ctx.fill();

				const dataUrl = canvas.toDataURL("image/png");

				// Update the dynamic favicon and all existing icon tags
				if (dynamicFaviconRef.current) {
					dynamicFaviconRef.current.href = dataUrl;
				}
				for (const backup of iconBackupsRef.current) {
					if (document.head.contains(backup.element)) {
						backup.element.href = dataUrl;
					}
				}
			}
		}, FRAME_INTERVAL_MS);

		return () => {
			clearInterval(intervalId);
		};
	}, [isLoading, activeMessage]);

	return <>{children}</>;
}
