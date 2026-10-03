/**
 * Collaboration configuration.
 *
 * Collaboration is opt-in: without a configured host the editor runs exactly
 * as it did before, with no connection attempted.
 */

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

	return {
		uri: resolveCollaborationUri(uri, pageHostname),
		database: process.env.NEXT_PUBLIC_COLLAB_DATABASE ?? DEFAULT_DATABASE,
		profile: {
			name: process.env.NEXT_PUBLIC_COLLAB_NAME ?? profile.name,
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
const PROFILE_NAMES = ["Ada", "Kai", "Nova", "Rio", "Sam", "Jules"];
const PROFILE_COLORS = [
	"#22c55e",
	"#38bdf8",
	"#e879f9",
	"#facc15",
	"#fb7185",
	"#a78bfa",
];

function localProfile(): { name: string; color: string } {
	const fallback = { name: "Editor", color: "#f97316" };
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const stored = window.localStorage.getItem(PROFILE_KEY);
		if (stored) {
			const parsed = JSON.parse(stored) as { name?: string; color?: string };
			if (parsed.name && parsed.color) {
				return { name: parsed.name, color: parsed.color };
			}
		}
	} catch {
		return fallback;
	}

	const profile = {
		name: PROFILE_NAMES[Math.floor(Math.random() * PROFILE_NAMES.length)]!,
		color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)]!,
	};
	try {
		window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
	} catch {
		return profile;
	}
	return profile;
}

function isLoopback(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1";
}
