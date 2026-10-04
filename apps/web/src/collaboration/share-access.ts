/**
 * Live share URLs.
 *
 * The project id lets someone open the editor. The `share` token decides
 * whether they may edit. Changing `view` to `write` in the URL does nothing —
 * the token is looked up on the server.
 */

export const SHARE_QUERY = "share";

export type ShareAccess = "view" | "write";

export function readShareToken(
	search: string = typeof window === "undefined" ? "" : window.location.search,
): string | null {
	const query = search.startsWith("?") || search.length === 0 ? search : `?${search}`;
	const token = new URLSearchParams(query).get(SHARE_QUERY)?.trim() ?? "";
	return token.length > 0 ? token : null;
}

export function buildSharePath(projectId: string, token: string): string {
	return `/editor/${projectId}?${SHARE_QUERY}=${encodeURIComponent(token)}`;
}

export function buildShareUrl(
	origin: string,
	projectId: string,
	token: string,
): string {
	return `${origin.replace(/\/$/, "")}${buildSharePath(projectId, token)}`;
}
