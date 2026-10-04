/**
 * The media pool, separate from timeline edits.
 *
 * One editor uploads a video or audio file once. Everyone else saves that file
 * locally when the bytes are complete, then plays that copy. A delete removes
 * it from the pool. Chunk traffic and ordinary edits do not import the file
 * again.
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
import { videoCache } from "@/services/video-cache/service";
import { waveformCache } from "@/services/waveform-cache/service";
import { buildWaveformSourceKey } from "@/media/waveform-summary";

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
	}
}

/**
 * Saves shared video and audio into this browser once every chunk has arrived.
 */
export function watchSharedMedia({
	editor,
	session,
	projectId,
	replaceAssets,
}: {
	editor: EditorCore;
	session: CollabSession;
	projectId: string;
	replaceAssets: (assets: MediaAsset[]) => void;
}): {
	stop: () => void;
	suppress: (ids: string[]) => void;
	unsuppress: (ids: string[]) => void;
} {
	const saving = new Set<string>();
	const fromServer = new Set<string>();
	const suppressed = new Set<string>();
	const failed = new Set<string>();
	let scheduled = false;

	const receive = () => {
		const remoteIds = new Set<string>();

		for (const asset of session.snapshot().assets) {
			if (asset.storage !== "spacetime") {
				continue;
			}
			remoteIds.add(asset.id);
			if (saving.has(asset.id) || suppressed.has(asset.id) || failed.has(asset.id)) {
				continue;
			}
			const local = editor.media.getAssets().find((item) => item.id === asset.id);
			if (hasPlayableCopy(local, asset.byteSize)) {
				fromServer.add(asset.id);
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
				replaceAssets,
				accept: (id) => !suppressed.has(id),
			})
				.then((saved) => {
					if (saved) {
						fromServer.add(asset.id);
						return;
					}
					failed.add(asset.id);
				})
				.finally(() => {
					saving.delete(asset.id);
				});
		}

		for (const id of [...suppressed]) {
			if (!remoteIds.has(id)) {
				suppressed.delete(id);
			}
		}

		const current = editor.media.getAssets();
		const stale = current.filter(
			(item) => fromServer.has(item.id) && !remoteIds.has(item.id),
		);
		if (stale.length === 0) {
			return;
		}
		const staleIds = new Set(stale.map((item) => item.id));
		for (const item of stale) {
			fromServer.delete(item.id);
			releaseAsset(item);
			void storageService.deleteMediaAsset({ projectId, id: item.id });
		}
		replaceAssets(current.filter((item) => !staleIds.has(item.id)));
	};

	const schedule = (resetFailures = false) => {
		if (resetFailures) {
			failed.clear();
		}
		if (scheduled) {
			return;
		}
		scheduled = true;
		queueMicrotask(() => {
			scheduled = false;
			receive();
		});
	};

	const stopChunks = session.onAssetChunks(() => schedule(true));
	const stopSnapshot = session.onSnapshot(() => schedule(false));
	schedule();
	return {
		stop: () => {
			stopChunks();
			stopSnapshot();
		},
		suppress: (ids) => {
			for (const id of ids) {
				suppressed.add(id);
				fromServer.delete(id);
			}
		},
		unsuppress: (ids) => {
			for (const id of ids) {
				suppressed.delete(id);
			}
		},
	};
}

async function saveReceivedFile({
	editor,
	projectId,
	assetId,
	name,
	mimeType,
	bytes,
	replaceAssets,
	accept,
}: {
	editor: EditorCore;
	projectId: string;
	assetId: string;
	name: string;
	mimeType: string;
	bytes: Uint8Array<ArrayBuffer>;
	replaceAssets: (assets: MediaAsset[]) => void;
	accept: (assetId: string) => boolean;
}): Promise<boolean> {
	const file = new File([bytes], name, {
		type: playableMimeType({ name, mimeType }),
	});
	const [processed] = await processMediaAssets({ files: [file] });
	if (!processed) {
		return false;
	}
	if (!accept(assetId)) {
		if (processed.url) {
			URL.revokeObjectURL(processed.url);
		}
		return false;
	}
	const media: MediaAsset = { ...processed, id: assetId };
	const current = editor.media.getAssets();
	const previous = current.find((item) => item.id === assetId);
	if (previous) {
		releaseAsset(previous);
	}
	replaceAssets([...current.filter((item) => item.id !== assetId), media]);
	await storageService.saveMediaAsset({ projectId, mediaAsset: media });
	return true;
}

function releaseAsset(asset: MediaAsset): void {
	if (asset.url) {
		URL.revokeObjectURL(asset.url);
	}
	if (asset.thumbnailUrl) {
		URL.revokeObjectURL(asset.thumbnailUrl);
	}
	videoCache.clearVideo({ mediaId: asset.id });
	waveformCache.clearSource({
		sourceKey: buildWaveformSourceKey({ kind: "media", id: asset.id }),
	});
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
