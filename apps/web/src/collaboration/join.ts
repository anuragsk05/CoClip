/**
 * Opens a project that lives in SpacetimeDB but not in this browser.
 *
 * The local copy keeps the shared project id and scene ids. Generating new
 * ones would make this editor publish a second, empty timeline.
 */

import { CollabSession } from "@opencut/collab-client";
import type { ProjectSnapshot } from "@opencut/collab-client";

import type { EditorCore } from "@/core";
import { DEFAULT_BACKGROUND_COLOR } from "@/background/color";
import { DEFAULT_CANVAS_SIZE } from "@/canvas/sizes";
import { DEFAULT_FPS } from "@/fps/defaults";
import type { TBackground, TProject, TProjectSettings } from "@/project/types";
import { CURRENT_PROJECT_VERSION } from "@/services/storage/migrations";
import { getProjectDurationFromScenes } from "@/timeline/scenes";
import type { TScene } from "@/timeline";

import { collaborationConfig, isCollaborationEnabled } from "./config";
import { rebuildScene } from "./rebuild";

export async function joinSharedProject({
	projectId,
	editor,
}: {
	projectId: string;
	editor: EditorCore;
}): Promise<boolean> {
	if (!isCollaborationEnabled()) {
		return false;
	}

	const config = collaborationConfig();
	let session: CollabSession | null = null;
	try {
		session = await CollabSession.open({
			uri: config.uri,
			database: config.database,
			projectId,
			profile: config.profile,
		});
		if (!session.isProjectLoaded) {
			return false;
		}
		await editor.project.adoptSharedProject({
			project: projectFromSnapshot(session.snapshot()),
		});
		return true;
	} catch (error) {
		console.error("Failed to join shared project:", error);
		return false;
	} finally {
		session?.close();
	}
}

export function projectFromSnapshot(snapshot: ProjectSnapshot): TProject {
	const now = new Date();
	const scenes = scenesFromSnapshot(snapshot).map(
		(scene): TScene => ({
			id: scene.id,
			name: scene.name,
			isMain: scene.isMain,
			tracks: rebuildScene({ snapshot, sceneId: scene.id }),
			bookmarks: [],
			createdAt: now,
			updatedAt: now,
		}),
	);
	const current = scenes.find((scene) => scene.isMain) ?? scenes[0];
	if (!current) {
		throw new Error("shared project has no scene");
	}

	return {
		metadata: {
			id: snapshot.projectId,
			name: snapshot.name || "Shared project",
			duration: getProjectDurationFromScenes({ scenes }),
			createdAt: now,
			updatedAt: now,
		},
		scenes,
		currentSceneId: current.id,
		settings: settingsFromSnapshot(snapshot),
		version: CURRENT_PROJECT_VERSION,
	};
}

function scenesFromSnapshot(
	snapshot: ProjectSnapshot,
): ProjectSnapshot["scenes"] {
	if (snapshot.scenes.length > 0) {
		return snapshot.scenes;
	}
	return [
		{
			id: `${snapshot.projectId}-scene`,
			name: "Main scene",
			isMain: true,
			position: 0,
		},
	];
}

function settingsFromSnapshot(snapshot: ProjectSnapshot): TProjectSettings {
	const metadata = snapshot.metadata;
	if (!metadata) {
		return {
			fps: DEFAULT_FPS,
			canvasSize: DEFAULT_CANVAS_SIZE,
			canvasSizeMode: "preset",
			lastCustomCanvasSize: null,
			originalCanvasSize: null,
			background: { type: "color", color: DEFAULT_BACKGROUND_COLOR },
		};
	}

	const mode = metadata.extra.canvasSizeMode;
	return {
		fps: {
			numerator: metadata.fpsNumerator,
			denominator: metadata.fpsDenominator,
		},
		canvasSize: {
			width: metadata.canvasWidth,
			height: metadata.canvasHeight,
		},
		canvasSizeMode: mode === "custom" ? "custom" : "preset",
		lastCustomCanvasSize: null,
		originalCanvasSize: null,
		background: backgroundFromShared(metadata.background),
	};
}

function backgroundFromShared(value: string): TBackground {
	if (value.startsWith("blur:")) {
		const intensity = Number(value.slice("blur:".length));
		return {
			type: "blur",
			blurIntensity: Number.isFinite(intensity) ? intensity : 0,
		};
	}
	return { type: "color", color: value || DEFAULT_BACKGROUND_COLOR };
}
