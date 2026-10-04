/**
 * Collaboration configuration.
 *
 * Collaboration is opt-in: without a configured host the editor runs exactly
 * as it did before, with no connection attempted.
 */

import { readShareToken } from "./share-access";

export interface CollaborationConfig {
	uri: string;
	database: string;
	profile: { name: string; color: string };
}

const DEFAULT_DATABASE = "opencut-collab";

export function isCollaborationEnabled(): boolean {
	return Boolean(process.env.NEXT_PUBLIC_COLLAB_URI);
}

export function collaborationConfig(): CollaborationConfig {
	const uri = process.env.NEXT_PUBLIC_COLLAB_URI;
	if (!uri) {
		throw new Error(
			"collaboration is not configured; set NEXT_PUBLIC_COLLAB_URI",
		);
	}

	const pageHostname =
		typeof window === "undefined" ? "" : window.location.hostname;
	const profile = localProfile();
	const chosen = readCollabProfile();

	return {
		uri: resolveCollaborationUri(uri, pageHostname),
		database: process.env.NEXT_PUBLIC_COLLAB_DATABASE ?? DEFAULT_DATABASE,
		profile: {
			name: chosen?.chosen
				? chosen.name
				: (process.env.NEXT_PUBLIC_COLLAB_NAME ?? profile.name),
			color: process.env.NEXT_PUBLIC_COLLAB_COLOR ?? profile.color,
		},
	};
}

/**
 * A link opened as `http://<lan-ip>:3001` must reach SpacetimeDB on that same
 * machine. The configured URI is often `ws://localhost:3000`, which would point
 * a guest back at their own computer.
 */
export function resolveCollaborationUri(
	configured: string,
	pageHostname: string,
): string {
	let url: URL;
	try {
		url = new URL(configured);
	} catch {
		return configured;
	}

	const configuredIsLoopback = isLoopback(url.hostname);
	const pageIsLoopback = pageHostname === "" || isLoopback(pageHostname);
	if (configuredIsLoopback && !pageIsLoopback) {
		url.hostname = pageHostname;
	}
	return url.toString().replace(/\/$/, "");
}

const PROFILE_KEY = "opencut.collab.profile";
const PROFILE_COLORS = [
	"#22c55e",
	"#38bdf8",
	"#e879f9",
	"#facc15",
	"#fb7185",
	"#a78bfa",
];

export interface CollabProfile {
	name: string;
	color: string;
	chosen: boolean;
}

/**
 * True when this browser is about to enter a shared project and still needs a
 * display name. A share link always asks, so a guest confirms who they are.
 */
export function needsJoinName(): boolean {
	if (!isCollaborationEnabled()) {
		return false;
	}
	if (process.env.NEXT_PUBLIC_COLLAB_NAME) {
		return false;
	}
	if (typeof window === "undefined") {
		return false;
	}
	if (readShareToken()) {
		return true;
	}
	return !hasChosenDisplayName();
}

export function hasChosenDisplayName(): boolean {
	return readCollabProfile()?.chosen === true;
}

export function readCollabProfile(): CollabProfile | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const stored = window.localStorage.getItem(PROFILE_KEY);
		if (!stored) {
			return null;
		}
		const parsed = JSON.parse(stored) as {
			name?: string;
			color?: string;
			chosen?: boolean;
		};
		if (!parsed.name || !parsed.color) {
			return null;
		}
		return {
			name: parsed.name,
			color: parsed.color,
			chosen: parsed.chosen === true,
		};
	} catch {
		return null;
	}
}

export function chooseDisplayName(name: string): CollabProfile {
	const trimmed = name.trim().slice(0, 40);
	if (!trimmed) {
		throw new Error("name is required");
	}
	const existing = readCollabProfile();
	const profile: CollabProfile = {
		name: trimmed,
		color: existing?.color ?? randomColor(),
		chosen: true,
	};
	window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
	return profile;
}

function localProfile(): { name: string; color: string } {
	const fallback = { name: "Editor", color: "#f97316" };
	return readCollabProfile() ?? fallback;
}

function randomColor(): string {
	return PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)]!;
}

function isLoopback(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1";
}
