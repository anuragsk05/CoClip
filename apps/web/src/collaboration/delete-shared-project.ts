/**
 * Removes a project from the shared database when this browser is its host.
 *
 * A project that was never shared, or a guest's local copy, leaves the shared
 * session alone. Any other failure stops the local delete so the files are
 * not left behind in the session.
 */

import { CollabSession } from "@opencut/collab-client";

import { collaborationConfig, isCollaborationEnabled } from "./config";

export async function deleteSharedProject(projectId: string): Promise<void> {
	if (!isCollaborationEnabled()) {
		return;
	}

	const config = collaborationConfig();
	try {
		await CollabSession.deleteSharedProject({
			uri: config.uri,
			database: config.database,
			projectId,
			profile: config.profile,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			message.includes("unknown project") ||
			message.includes("only the host")
		) {
			return;
		}
		throw error instanceof Error ? error : new Error(message);
	}
}
