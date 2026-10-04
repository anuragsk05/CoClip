"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { EditorCore } from "@/core";
import { useEditor } from "@/editor/use-editor";
import { useKeybindingsListener } from "@/actions/use-keybindings";
import { useKeybindingsStore } from "@/actions/keybindings-store";
import { useTimelineStore } from "@/timeline/timeline-store";
import { JoinNameGate } from "@/collaboration/components/join-name-gate";
import { CollaborationProvider } from "@/collaboration/collaboration-provider";
import { isCollaborationEnabled, needsJoinName } from "@/collaboration/config";
import { joinSharedProject } from "@/collaboration/join";
import { useEditorActions } from "@/actions/use-editor-actions";
import { loadFontAtlas } from "@/fonts/google-fonts";
import {
	initializeGpuRenderer,
	isGpuAvailable,
} from "@/services/renderer/gpu-renderer";
import { useRegisterTabLoading } from "@/hooks/use-tab-buffering";

interface EditorProviderProps {
	projectId: string;
	children: React.ReactNode;
}

export function EditorProvider({ projectId, children }: EditorProviderProps) {
	const activeProject = useEditor((e) => e.project.getActiveOrNull());
	const router = useRouter();
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [nameGate, setNameGate] = useState<"pending" | "ask" | "ready">(
		"pending",
	);
	const { setLoadingProject } = useKeybindingsStore();

	useRegisterTabLoading(isLoading, "editor-loading-project", "Loading project...");
	useRegisterTabLoading(
		!activeProject && !isLoading && !error,
		"editor-exiting",
		"Exiting project...",
	);

	useEffect(() => {
		if (activeProject?.metadata.name) {
			document.title = `${activeProject.metadata.name} — CoClip`;
		}
	}, [activeProject?.metadata.name]);

	useEffect(() => {
		setLoadingProject(isLoading);
	}, [isLoading, setLoadingProject]);

	useEffect(() => {
		setNameGate(needsJoinName() ? "ask" : "ready");
	}, [projectId]);

	useEffect(() => {
		if (nameGate !== "ready") {
			return;
		}

		let cancelled = false;
		const editor = EditorCore.getInstance();

		const loadProject = async () => {
			try {
				setIsLoading(true);
				await initializeGpuRenderer();
				editor.renderer.setDegraded(!isGpuAvailable());
				await editor.project.loadProject({ id: projectId });

				if (cancelled) return;

				setIsLoading(false);
				loadFontAtlas();
			} catch (err) {
				if (cancelled) return;

				const isNotFound =
					err instanceof Error &&
					(err.message.includes("not found") ||
						err.message.includes("does not exist"));

				if (isNotFound && isCollaborationEnabled()) {
					try {
						const joined = await joinSharedProject({ projectId, editor });
						if (cancelled) return;
						if (joined) {
							setIsLoading(false);
							loadFontAtlas();
							return;
						}
					} catch (joinError) {
						if (cancelled) return;
						setError(
							joinError instanceof Error
								? joinError.message
								: "The host has not started a CoClip session",
						);
						setIsLoading(false);
						return;
					}
				}

				if (isNotFound) {
					try {
						const newProjectId = await editor.project.createNewProject({
							name: "Untitled Project",
						});
						router.replace(`/editor/${newProjectId}`);
					} catch (_createErr) {
						setError("Failed to create project");
						setIsLoading(false);
					}
				} else {
					const wasmPanic = (window as Window & { __wasmPanic?: string })
						.__wasmPanic;
					if (wasmPanic) {
						delete (window as Window & { __wasmPanic?: string }).__wasmPanic;
						setError(wasmPanic);
					} else {
						setError(
							err instanceof Error ? err.message : "Failed to load project",
						);
					}
					setIsLoading(false);
				}
			}
		};

		loadProject();

		return () => {
			cancelled = true;
		};
	}, [projectId, router, nameGate]);

	if (nameGate === "ask") {
		return <JoinNameGate onJoin={() => setNameGate("ready")} />;
	}

	if (error) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<p className="text-destructive text-sm">{error}</p>
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Loading project...</p>
				</div>
			</div>
		);
	}

	if (!activeProject) {
		return (
			<div className="bg-background flex h-screen w-screen items-center justify-center">
				<div className="flex flex-col items-center gap-4">
					<Loader2 className="text-muted-foreground size-8 animate-spin" />
					<p className="text-muted-foreground text-sm">Exiting project...</p>
				</div>
			</div>
		);
	}

	return (
		// Mounted below the loading gate so the session only opens once the
		// project is in memory and there is local state for it to reconcile with.
		<CollaborationProvider projectId={projectId}>
			<EditorRuntimeBindings />
			{children}
		</CollaborationProvider>
	);
}

function EditorRuntimeBindings() {
	const editor = useEditor();
	const rippleEditingEnabled = useTimelineStore(
		(state) => state.rippleEditingEnabled,
	);

	useEffect(() => {
		editor.command.isRippleEnabled = rippleEditingEnabled;
	}, [editor, rippleEditingEnabled]);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!editor.save.getIsDirty()) return;
			event.preventDefault();
			(event as unknown as { returnValue: string }).returnValue = "";
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [editor]);

	useEditorActions();
	useKeybindingsListener();
	return null;
}
