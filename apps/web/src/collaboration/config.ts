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

	return {
		uri,
		database: process.env.NEXT_PUBLIC_COLLAB_DATABASE ?? DEFAULT_DATABASE,
		profile: {
			name: process.env.NEXT_PUBLIC_COLLAB_NAME ?? "Editor",
			color: process.env.NEXT_PUBLIC_COLLAB_COLOR ?? "#f97316",
		},
	};
}
