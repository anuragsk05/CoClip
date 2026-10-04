import { describe, expect, test } from "bun:test";

import { participantInitials } from "../participant-initials";

describe("participantInitials", () => {
	test("uses one letter for a single name", () => {
		expect(participantInitials("Kai")).toBe("K");
		expect(participantInitials("sparsh")).toBe("S");
	});

	test("uses the first two words when the name is longer", () => {
		expect(participantInitials("Ada Lovelace")).toBe("AL");
		expect(participantInitials("Mary Ann Evans")).toBe("MA");
	});

	test("uses a placeholder when the name is empty", () => {
		expect(participantInitials("   ")).toBe("?");
	});
});
