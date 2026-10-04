/**
 * Moves video and audio bytes through the shared session.
 *
 * The importing editor slices the file and writes each slice with
 * `putAssetChunk`. Every other editor subscribes to those rows, rebuilds the
 * file, and stores it locally so the preview can play it.
 */

import { toast } from "sonner";

import {
	assembleMediaChunks,
	MEDIA_CHUNK_BYTES,
	type CollabSession,
} from "@opencut/collab-client";

import type { EditorCore } from "@/core";
import { getMediaTypeFromFile, playableMimeType } from "@/media/media-utils";
import { processMediaAssets } from "@/media/processing";
import type { MediaAsset } from "@/media/types";
import { storageService } from "@/services/storage/service";

const MAX_SHARED_BYTES = 512 * 1024 * 1024;

export async function uploadSharedMedia(
	session: CollabSession,
	assets: MediaAsset[],
): Promise<void> {
	for (const asset of assets) {
		if (asset.type !== "video" && asset.type !== "audio") {
			continue;
		}
		if (asset.file.size === 0 || asset.file.size > MAX_SHARED_BYTES) {
			if (asset.file.size > MAX_SHARED_BYTES) {
				toast.error(`${asset.name} is larger than 512 MB`);
			}
			continue;
		}
		if (chunksMatchFile(session, asset)) {
			continue;
		}

		toast.message(`Sharing ${asset.name}`);
		const count = Math.ceil(asset.file.size / MEDIA_CHUNK_BYTES);
		for (let index = 0; index < count; index += 1) {
			const start = index * MEDIA_CHUNK_BYTES;
			const end = Math.min(asset.file.size, start + MEDIA_CHUNK_BYTES);
			const already = session
				.assetChunks(asset.id)
				.find((chunk) => chunk.index === index && chunk.count === count);
			if (already && already.bytes.byteLength === end - start) {
				continue;
			}
			const bytes = new Uint8Array(await asset.file.slice(start, end).arrayBuffer());
			await session.putAssetChunk({
				assetId: asset.id,
				chunkIndex: index,
				chunkCount: count,
				bytes,
			});
		}
		toast.success(`Shared ${asset.name}`);
	}
}

/**
 * Saves shared video and audio into this browser once every chunk has arrived.
 */
export function watchSharedMedia({
	editor,
	session,
	projectId,
}: {
	editor: EditorCore;
	session: CollabSession;
	projectId: string;
}): () => void {
	const saving = new Set<string>();

	const receive = () => {
		for (const asset of session.snapshot().assets) {
			if (asset.storage !== "spacetime" || saving.has(asset.id)) {
				continue;
			}
			const local = editor.media.getAssets().find((item) => item.id === asset.id);
			if (hasPlayableCopy(local, asset.byteSize)) {
				continue;
			}
			const bytes = assembleMediaChunks(session.assetChunks(asset.id));
			if (!bytes) {
				continue;
			}
			saving.add(asset.id);
			void saveReceivedFile({
				editor,
				projectId,
				assetId: asset.id,
				name: asset.name,
				mimeType: asset.mimeType,
				bytes,
			}).finally(() => {
				saving.delete(asset.id);
			});
		}
	};

	const stopChunks = session.onAssetChunks(receive);
	const stopSnapshot = session.onSnapshot(() => receive());
	receive();
	return () => {
		stopChunks();
		stopSnapshot();
	};
}

async function saveReceivedFile({
	editor,
	projectId,
	assetId,
	name,
	mimeType,
	bytes,
}: {
	editor: EditorCore;
	projectId: string;
	assetId: string;
	name: string;
	mimeType: string;
	bytes: Uint8Array<ArrayBuffer>;
}): Promise<void> {
	const file = new File([bytes], name, {
		type: playableMimeType({ name, mimeType }),
	});
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) {
		return;
	}
	const media: MediaAsset = { ...processed, id: assetId };
	const others = editor.media.getAssets().filter((item) => item.id !== assetId);
	editor.media.setAssets({ assets: [...others, media] });
	await storageService.saveMediaAsset({ projectId, mediaAsset: media });
	toast.success(`${name} is ready to play`);
}

function hasPlayableCopy(
	local: MediaAsset | undefined,
	byteSize: number | null,
): boolean {
	if (!local?.url || !local.file || local.file.size === 0) {
		return false;
	}
	if (byteSize != null && local.file.size !== byteSize) {
		return false;
	}
	return getMediaTypeFromFile({ file: local.file }) != null;
}

function chunksMatchFile(session: CollabSession, asset: MediaAsset): boolean {
	const chunks = session.assetChunks(asset.id);
	const count = Math.ceil(asset.file.size / MEDIA_CHUNK_BYTES);
	if (chunks.length === 0 || chunks.some((chunk) => chunk.count !== count)) {
		return false;
	}
	const assembled = assembleMediaChunks(chunks);
	return assembled != null && assembled.byteLength === asset.file.size;
}
