import { describe, expect, test } from "bun:test";

import { getMediaTypeFromFile, playableMimeType } from "./media-utils";

describe("shared media types", () => {
	test("an mp4 with no browser mime is still a video", () => {
		const file = new File([new Uint8Array([1, 2, 3])], "Lion King_1.mp4");
		expect(file.type).toBe("");
		expect(getMediaTypeFromFile({ file })).toBe("video");
		expect(
			playableMimeType({ name: file.name, mimeType: file.type }),
		).toBe("video/mp4");
	});

	test("keeps a real audio mime", () => {
		expect(
			playableMimeType({ name: "room-tone.wav", mimeType: "audio/wav" }),
		).toBe("audio/wav");
	});
});
