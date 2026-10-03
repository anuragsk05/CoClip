/**
 * The agent's editing surface.
 *
 * Every tool maps to exactly one reducer, through the same
 * {@link EditorCommand} a human editor sends. There is deliberately no
 * agent-only mutation path: if a tool here can do something, a person can do it
 * too, and the reducers validate both identically.
 *
 * Tools speak seconds and clip ids. Ticks, enum tags, and row shapes belong to
 * the adapter and stop at this boundary.
 */

import type { EditorCommand, RetainSide } from "@opencut/collab-client";
import { ticksFromSeconds } from "@opencut/collab-client";

/** A JSON Schema fragment, as model providers expect for tool parameters. */
export interface ToolSchema {
	type: "object";
	properties: Record<string, unknown>;
	required: string[];
	additionalProperties: false;
}

export interface Tool {
	name: string;
	description: string;
	parameters: ToolSchema;
	/**
	 * Builds the command for these arguments.
	 *
	 * Throws on arguments that are malformed rather than merely invalid. A model
	 * passing the wrong type is a caller bug; a model asking to split outside a
	 * clip is an edit the reducer will reject, and that rejection is the answer.
	 */
	toCommand(args: Record<string, unknown>): EditorCommand;
}

function schema({
	properties,
	required,
}: {
	properties: Record<string, unknown>;
	required: string[];
}): ToolSchema {
	return { type: "object", properties, required, additionalProperties: false };
}

const clipId = {
	type: "string",
	description: "Id of the clip, as shown in the project listing.",
};
const effectId = { type: "string", description: "Id of the effect." };
const trackId = { type: "string", description: "Id of the track." };
const seconds = { type: "number", description: "A time in seconds." };

function requireString(
	args: Record<string, unknown>,
	key: string,
): string {
	const value = args[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`\`${key}\` must be a non-empty string`);
	}
	return value;
}

function requireNumber(
	args: Record<string, unknown>,
	key: string,
): number {
	const value = args[key];
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`\`${key}\` must be a finite number`);
	}
	return value;
}

function requireBoolean(
	args: Record<string, unknown>,
	key: string,
): boolean {
	const value = args[key];
	if (typeof value !== "boolean") {
		throw new Error(`\`${key}\` must be a boolean`);
	}
	return value;
}

function optionalString(
	args: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = args[key];
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`\`${key}\` must be a string when provided`);
	}
	return value;
}

function requireParams(
	args: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const value = args[key];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`\`${key}\` must be an object`);
	}
	return value as Record<string, unknown>;
}

const RETAIN_SIDES: RetainSide[] = ["both", "left", "right"];

export const TOOLS: Tool[] = [
	{
		name: "move_clip",
		description:
			"Move a clip to a new start time, optionally onto a different track. " +
			"The clip keeps its duration and its trim.",
		parameters: schema({
			properties: {
				clipId,
				startTime: {
					...seconds,
					description: "New start time on the timeline, in seconds.",
				},
				trackId: {
					type: "string",
					description:
						"Track to move the clip onto. Omit to keep it on its current track.",
				},
			},
			required: ["clipId", "startTime"],
		}),
		toCommand(args) {
			const id = requireString(args, "clipId");
			return {
				kind: "moveClip",
				clipId: id,
				// The caller resolves the current track when none is given; see
				// `CollabAgent.call`.
				targetTrackId: optionalString(args, "trackId") ?? "",
				startTime: ticksFromSeconds(requireNumber(args, "startTime")),
			};
		},
	},
	{
		name: "trim_clip",
		description:
			"Trim a clip by setting how much is cut from the head and tail of its " +
			"source media. Use this to shorten or lengthen a clip in place.",
		parameters: schema({
			properties: {
				clipId,
				trimStart: {
					...seconds,
					description: "Seconds cut from the start of the source media.",
				},
				trimEnd: {
					...seconds,
					description: "Seconds cut from the end of the source media.",
				},
				startTime: {
					...seconds,
					description:
						"New timeline start, if trimming the head should move the clip.",
				},
				duration: {
					...seconds,
					description: "New on-timeline duration, in seconds.",
				},
			},
			required: ["clipId", "trimStart", "trimEnd"],
		}),
		toCommand(args) {
			const command: EditorCommand = {
				kind: "trimClip",
				clipId: requireString(args, "clipId"),
				trimStart: ticksFromSeconds(requireNumber(args, "trimStart")),
				trimEnd: ticksFromSeconds(requireNumber(args, "trimEnd")),
			};
			if (args.startTime !== undefined) {
				command.startTime = ticksFromSeconds(requireNumber(args, "startTime"));
			}
			if (args.duration !== undefined) {
				command.duration = ticksFromSeconds(requireNumber(args, "duration"));
			}
			return command;
		},
	},
	{
		name: "split_clip",
		description:
			"Split a clip at a point on the timeline. `retain` chooses what " +
			"survives: `both` keeps each half, `left` keeps only what precedes " +
			"the split, `right` only what follows it.",
		parameters: schema({
			properties: {
				clipId,
				splitTime: {
					...seconds,
					description:
						"Timeline position to split at, in seconds. Must fall inside the clip.",
				},
				retain: {
					type: "string",
					enum: RETAIN_SIDES,
					description: "Which side of the split to keep. Defaults to `both`.",
				},
				rightClipId: {
					type: "string",
					description:
						"Id for the new right-hand clip. Required when a right half is kept.",
				},
			},
			required: ["clipId", "splitTime"],
		}),
		toCommand(args) {
			const retain = (optionalString(args, "retain") ?? "both") as RetainSide;
			if (!RETAIN_SIDES.includes(retain)) {
				throw new Error(`\`retain\` must be one of ${RETAIN_SIDES.join(", ")}`);
			}
			const command: EditorCommand = {
				kind: "splitClip",
				clipId: requireString(args, "clipId"),
				splitTime: ticksFromSeconds(requireNumber(args, "splitTime")),
				retain,
			};
			const rightClipId = optionalString(args, "rightClipId");
			if (rightClipId !== undefined) {
				command.rightClipId = rightClipId;
			}
			return command;
		},
	},
	{
		name: "delete_clip",
		description: "Remove a clip and its effects from the timeline.",
		parameters: schema({
			properties: { clipId },
			required: ["clipId"],
		}),
		toCommand(args) {
			return { kind: "deleteClip", clipId: requireString(args, "clipId") };
		},
	},
	{
		name: "set_volume",
		description:
			"Set a clip's volume in decibels. 0 is unchanged, negative is quieter.",
		parameters: schema({
			properties: {
				clipId,
				volumeDb: { type: "number", description: "Volume in decibels." },
			},
			required: ["clipId", "volumeDb"],
		}),
		toCommand(args) {
			return {
				kind: "setVolume",
				clipId: requireString(args, "clipId"),
				volumeDb: requireNumber(args, "volumeDb"),
			};
		},
	},
	{
		name: "set_clip_muted",
		description: "Mute or unmute a clip.",
		parameters: schema({
			properties: { clipId, muted: { type: "boolean" } },
			required: ["clipId", "muted"],
		}),
		toCommand(args) {
			return {
				kind: "setClipMuted",
				clipId: requireString(args, "clipId"),
				muted: requireBoolean(args, "muted"),
			};
		},
	},
	{
		name: "set_clip_hidden",
		description: "Hide or show a clip without deleting it.",
		parameters: schema({
			properties: { clipId, hidden: { type: "boolean" } },
			required: ["clipId", "hidden"],
		}),
		toCommand(args) {
			return {
				kind: "setClipHidden",
				clipId: requireString(args, "clipId"),
				hidden: requireBoolean(args, "hidden"),
			};
		},
	},
	{
		name: "add_effect",
		description:
			"Append an effect to a clip's effect chain. Parameters are specific to " +
			"the effect type.",
		parameters: schema({
			properties: {
				clipId,
				effectId: {
					type: "string",
					description: "Id for the new effect. Must be unique.",
				},
				effectType: {
					type: "string",
					description: "Effect type, for example `blur` or `brightness`.",
				},
				params: {
					type: "object",
					description: "Effect parameters.",
					additionalProperties: true,
				},
			},
			required: ["clipId", "effectId", "effectType"],
		}),
		toCommand(args) {
			return {
				kind: "addEffect",
				clipId: requireString(args, "clipId"),
				effectId: requireString(args, "effectId"),
				effectType: requireString(args, "effectType"),
				params: args.params === undefined ? {} : requireParams(args, "params"),
			};
		},
	},
	{
		name: "remove_effect",
		description: "Remove an effect from its clip's chain.",
		parameters: schema({
			properties: { effectId },
			required: ["effectId"],
		}),
		toCommand(args) {
			return { kind: "removeEffect", effectId: requireString(args, "effectId") };
		},
	},
	{
		name: "toggle_effect",
		description: "Enable or disable an effect without removing it.",
		parameters: schema({
			properties: { effectId, enabled: { type: "boolean" } },
			required: ["effectId", "enabled"],
		}),
		toCommand(args) {
			return {
				kind: "toggleEffect",
				effectId: requireString(args, "effectId"),
				enabled: requireBoolean(args, "enabled"),
			};
		},
	},
	{
		name: "update_effect_params",
		description: "Replace an effect's parameters.",
		parameters: schema({
			properties: {
				effectId,
				params: { type: "object", additionalProperties: true },
			},
			required: ["effectId", "params"],
		}),
		toCommand(args) {
			return {
				kind: "updateEffectParams",
				effectId: requireString(args, "effectId"),
				params: requireParams(args, "params"),
			};
		},
	},
	{
		name: "set_track_muted",
		description: "Mute or unmute an entire track.",
		parameters: schema({
			properties: { trackId, muted: { type: "boolean" } },
			required: ["trackId", "muted"],
		}),
		toCommand(args) {
			return {
				kind: "setTrackMuted",
				trackId: requireString(args, "trackId"),
				muted: requireBoolean(args, "muted"),
			};
		},
	},
	{
		name: "set_track_hidden",
		description: "Hide or show an entire track.",
		parameters: schema({
			properties: { trackId, hidden: { type: "boolean" } },
			required: ["trackId", "hidden"],
		}),
		toCommand(args) {
			return {
				kind: "setTrackHidden",
				trackId: requireString(args, "trackId"),
				hidden: requireBoolean(args, "hidden"),
			};
		},
	},
	{
		name: "rename_project",
		description: "Rename the project.",
		parameters: schema({
			properties: { name: { type: "string" } },
			required: ["name"],
		}),
		toCommand(args) {
			return { kind: "renameProject", name: requireString(args, "name") };
		},
	},
];

export const TOOLS_BY_NAME: ReadonlyMap<string, Tool> = new Map(
	TOOLS.map((tool) => [tool.name, tool]),
);
