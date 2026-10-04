/** Only conversational text is retained; past tool calls are never replayed. */
export interface ConversationTurn {
	role: "user" | "agent";
	text: string;
}
export const MAX_CONVERSATION_TURNS = 10;
export const MAX_TURN_CHARS = 4000;

export function parseConversation(value: unknown): ConversationTurn[] | string {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > MAX_CONVERSATION_TURNS)
		return "history must contain at most 10 messages";
	const turns: ConversationTurn[] = [];
	for (const turn of value) {
		if (
			typeof turn !== "object" ||
			turn === null ||
			!("role" in turn) ||
			!("text" in turn) ||
			(turn.role !== "user" && turn.role !== "agent") ||
			typeof turn.text !== "string" ||
			!turn.text.trim() ||
			turn.text.length > MAX_TURN_CHARS
		)
			return "history messages require a user/agent role and 1–4000 characters of text";
		if ((turns.length % 2 === 0 ? "user" : "agent") !== turn.role)
			return "history must alternate user and agent messages";
		turns.push({ role: turn.role, text: turn.text });
	}
	if (turns.length % 2 !== 0)
		return "history must contain completed user/agent exchanges";
	return turns;
}
