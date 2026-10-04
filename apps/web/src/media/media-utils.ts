import type { MediaAsset, MediaType } from "@/media/types";

export const SUPPORTS_AUDIO: readonly MediaType[] = ["audio", "video"];

export function mediaSupportsAudio({
	media,
}: {
	media: MediaAsset | null | undefined;
}): boolean {
	if (!media) return false;
	return SUPPORTS_AUDIO.includes(media.type);
}

const MIME_BY_EXTENSION: Record<string, { type: MediaType; mime: string }> = {
	mp4: { type: "video", mime: "video/mp4" },
	m4v: { type: "video", mime: "video/mp4" },
	mov: { type: "video", mime: "video/quicktime" },
	webm: { type: "video", mime: "video/webm" },
	mkv: { type: "video", mime: "video/x-matroska" },
	mp3: { type: "audio", mime: "audio/mpeg" },
	wav: { type: "audio", mime: "audio/wav" },
	m4a: { type: "audio", mime: "audio/mp4" },
	aac: { type: "audio", mime: "audio/aac" },
	ogg: { type: "audio", mime: "audio/ogg" },
	flac: { type: "audio", mime: "audio/flac" },
	png: { type: "image", mime: "image/png" },
	jpg: { type: "image", mime: "image/jpeg" },
	jpeg: { type: "image", mime: "image/jpeg" },
	gif: { type: "image", mime: "image/gif" },
	webp: { type: "image", mime: "image/webp" },
	svg: { type: "image", mime: "image/svg+xml" },
};

export const getMediaTypeFromFile = ({
	file,
}: {
	file: File;
}): MediaType | null => {
	const fromMime = mediaTypeFromMime(file.type);
	if (fromMime) {
		return fromMime;
	}
	return mimeFromName(file.name)?.type ?? null;
};

/**
 * A MIME type the preview can decode.
 *
 * Shared files often arrive with an empty type. The filename extension is
 * enough to tell a video from an audio file.
 */
export function playableMimeType({
	name,
	mimeType,
}: {
	name: string;
	mimeType: string;
}): string {
	if (mediaTypeFromMime(mimeType)) {
		return mimeType;
	}
	return mimeFromName(name)?.mime ?? (mimeType || "application/octet-stream");
}

function mediaTypeFromMime(mimeType: string): MediaType | null {
	if (mimeType.startsWith("image/")) {
		return "image";
	}
	if (mimeType.startsWith("video/")) {
		return "video";
	}
	if (mimeType.startsWith("audio/")) {
		return "audio";
	}
	return null;
}

function mimeFromName(name: string): { type: MediaType; mime: string } | null {
	const base = name.split(/[/\\]/).pop() ?? name;
	const dot = base.lastIndexOf(".");
	if (dot <= 0) {
		return null;
	}
	return MIME_BY_EXTENSION[base.slice(dot + 1).toLowerCase()] ?? null;
}
