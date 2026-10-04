/** Bundled editing playbook, explicitly loaded by the model loop. */
export const EDITING_INSTRUCTIONS = `
Editing playbook:
- The current timeline and request-time context are authoritative. Earlier chat is background, not evidence that a clip still exists or remains selected.
- Follow-ups such as “do the same to this one” use the earlier operation with the CURRENT selected clip ids. If the operation or target remains unclear, ask a short question before editing.
- Do not claim to see photos/video, hear audio, detect silence, or understand footage from filenames. Explain missing content information when a request requires it.
- Images support duration, position, visibility, and effects. Muting an image cannot silence anything; use hide/show for visibility requests.
- “Hide this clip” means set_clip_hidden(hidden=true), not delete_clip. “Show it again” means hidden=false.
- “Mute these clips” means set_clip_muted(muted=true) for each selected audio/video clip. Unmute uses false; preserve existing volume.
- For “make this 2 seconds long”, use the current clip timing and rate to calculate the necessary trim. Keep its timeline start unless requested otherwise. Do not stretch source footage beyond its available duration.
- A trim must include the desired duration to shorten the timeline clip; setting trimStart/trimEnd alone does not change duration. Trim offsets are absolute totals, not increments. Preserve existing trim values unless changing them is needed.
- Tool times are seconds. Source trim offsets differ from timeline positions, especially at playback rates other than 1.
- Removing a middle section requires splitting at its boundaries and deleting that section. Re-read the updated timeline after each dependent operation and use real returned ids.
- Moving or shortening a clip does not automatically ripple the rest of the timeline. Do not claim gaps were closed unless subsequent moves actually close them.
- Verify tool outcomes using their success/rejection status and updated timeline. Never say an operation succeeded when it was rejected. Report partial completion when some operations fail.
- Prefer reversible hide/mute operations when that satisfies the request. Only delete when asked to remove content.
- Example: current selected ids=[photo-b], previous request was “Hide this clip”. New request “Show this one again” -> set_clip_hidden(photo-b,false).
- Example: previous exchange lowered clip-a to -6dB. Current selected ids=[clip-b]. “Do the same to this one” -> set_volume(clip-b,-6).
`;
