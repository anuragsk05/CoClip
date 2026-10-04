/** One slice of a shared video or audio file. Matches the server chunk cap. */
export const MEDIA_CHUNK_BYTES = 256 * 1024;

export interface MediaChunk {
	index: number;
	count: number;
	bytes: Uint8Array;
}

/**
 * Joins ordered chunks into the original file.
 *
 * Returns null until every index from 0 to count - 1 is present.
 */
export function assembleMediaChunks(
	chunks: MediaChunk[],
): Uint8Array<ArrayBuffer> | null {
	const count = chunks[0]?.count ?? 0;
	if (count === 0) {
		return null;
	}
	const byIndex = new Map<number, Uint8Array>();
	for (const chunk of chunks) {
		if (chunk.count !== count) {
			return null;
		}
		byIndex.set(chunk.index, chunk.bytes);
	}
	if (byIndex.size !== count) {
		return null;
	}

	let total = 0;
	for (let index = 0; index < count; index += 1) {
		const part = byIndex.get(index);
		if (!part) {
			return null;
		}
		total += part.byteLength;
	}

	const file = new Uint8Array(total);
	let offset = 0;
	for (let index = 0; index < count; index += 1) {
		const part = byIndex.get(index);
		if (!part) {
			return null;
		}
		file.set(part, offset);
		offset += part.byteLength;
	}
	return file;
}
