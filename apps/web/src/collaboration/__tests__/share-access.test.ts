import { describe, expect, test } from "bun:test";

import {
	SHARE_QUERY,
	buildSharePath,
	buildShareUrl,
	readShareToken,
} from "../share-access";

describe("share access links", () => {
	test("puts the invite token on the editor URL", () => {
		expect(buildSharePath("project-1", "abc-123")).toBe(
			`/editor/project-1?${SHARE_QUERY}=abc-123`,
		);
		expect(
			buildShareUrl("http://localhost:3001/", "project-1", "abc-123"),
		).toBe("http://localhost:3001/editor/project-1?share=abc-123");
	});

	test("reads the invite token from the query string", () => {
		expect(readShareToken("?share=view-token")).toBe("view-token");
		expect(readShareToken("share=view-token")).toBe("view-token");
		expect(readShareToken("")).toBeNull();
		expect(readShareToken("?other=1")).toBeNull();
	});
});
