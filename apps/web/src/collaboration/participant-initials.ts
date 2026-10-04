/**
 * Letters shown on a participant's icon.
 *
 * One name is a single initial. Two or more names use the first two words.
 */
export function participantInitials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0]!.slice(0, 1).toUpperCase();
	}
	return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}
