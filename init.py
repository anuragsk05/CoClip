from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
UPSTREAM = "https://github.com/OpenCut-app/opencut-classic.git"
BRANCH = "main"


def run(*args: str, cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("$", " ".join(args))
    return subprocess.run(args, cwd=cwd, check=check, text=True)


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"created {path.relative_to(ROOT)}")


def ensure_git() -> None:
    if shutil.which("git") is None:
        raise SystemExit("git is required but was not found on PATH.")


def import_opencut() -> None:
    git_dir = ROOT / ".git"
    if git_dir.exists():
        print("Existing Git repository detected; skipping upstream import.")
        return

    existing = [p for p in ROOT.iterdir() if p.name not in {"init.py", ".DS_Store"}]
    if existing:
        names = ", ".join(p.name for p in existing[:8])
        answer = input(
            f"This folder already contains files ({names}). Import OpenCut Classic here anyway? [y/N] "
        ).strip().lower()
        if answer not in {"y", "yes"}:
            raise SystemExit("Aborted without changing the folder.")

    with tempfile.TemporaryDirectory(prefix="opencut-classic-") as temp:
        temp_path = Path(temp) / "repo"
        run("git", "clone", "--depth", "1", "--branch", BRANCH, UPSTREAM, str(temp_path), cwd=ROOT)

        for item in temp_path.iterdir():
            if item.name == ".git":
                continue
            destination = ROOT / item.name
            if destination.exists():
                if destination.is_dir():
                    shutil.rmtree(destination)
                else:
                    destination.unlink()
            shutil.move(str(item), str(destination))

        shutil.move(str(temp_path / ".git"), str(ROOT / ".git"))

    run("git", "remote", "rename", "origin", "upstream")
    run("git", "checkout", "-B", "mhacks-collab")


def scaffold_collaboration() -> None:
    write(
        ROOT / "collaboration" / "README.md",
        """# OpenCut Multiplayer Collaboration Layer\n\nThis folder contains the SpacetimeDB-backed collaboration layer for the MHacks project.\n\n## Architecture\n\n- OpenCut remains responsible for timeline UI, preview, playback, and existing editing behavior.\n- SpacetimeDB becomes the canonical shared project state for collaborative entities.\n- Media bytes remain local or in object storage; SpacetimeDB stores references and edit metadata only.\n- Human clients and AI agents use the same reducer surface.\n\n## Initial shared entities\n\n- projects\n- tracks\n- clips\n- effects\n- presence\n- edit_history\n- metadata\n\n## Initial reducer surface\n\n- create_project\n- add_track\n- reorder_track\n- add_clip\n- move_clip\n- trim_clip\n- split_clip\n- delete_clip\n- set_volume\n- add_effect\n- update_presence\n- set_playhead\n- set_selection\n\n## Integration rule\n\nDo not rewrite OpenCut's editor internals until the canonical timeline mutation boundary is identified. The first milestone is to intercept a single clip move and mirror it through SpacetimeDB between two browser sessions.\n""",
    )

    write(
        ROOT / "collaboration" / "architecture.md",
        """# Architecture\n\n```text\n               Media Storage\n          (S3 / R2 / local assets)\n                    │\n                    ↓\n             Asset references\n                    │\n┌───────────── SpacetimeDB ──────────────┐\n│                                        │\n│  Projects      Clips       Tracks      │\n│  Effects       Presence    Edit State  │\n│  Users         History     Metadata    │\n│                                        │\n│              Reducers                  │\n│  move_clip()     trim_clip()           │\n│  split_clip()    delete_clip()         │\n│  set_volume()    add_effect()          │\n│  etc.                                  │\n└────────────────────────────────────────┘\n          ↑          ↑          ↑\n          │          │          │\n      Editor A   Editor B   AI Agent\n```\n\n## Boundary\n\nOpenCut UI actions should be translated into collaboration commands. Remote commands should be subscribed to and reconciled back into OpenCut's local editor state.\n\nThe collaboration layer should own synchronization semantics, presence, conflict policy, and history. It should not own media decoding, rendering, or export.\n""",
    )

    write(
        ROOT / "collaboration" / "spacetimedb" / "README.md",
        """# SpacetimeDB module\n\nThis directory is reserved for the SpacetimeDB server module.\n\nNext step: initialize the module with the current SpacetimeDB CLI, then implement tables and reducers for Project, Track, Clip, Effect, Presence, and EditHistory.\n""",
    )

    write(
        ROOT / "collaboration" / "client" / "README.md",
        """# Client adapter\n\nThis directory is reserved for the OpenCut ↔ SpacetimeDB adapter.\n\nResponsibilities:\n\n1. Connect/authenticate to SpacetimeDB.\n2. Subscribe to the active project's shared state.\n3. Convert local OpenCut timeline mutations into reducers.\n4. Apply remote state updates back into OpenCut.\n5. Prevent feedback loops when replaying remote changes locally.\n6. Publish ephemeral presence separately from durable edit state.\n""",
    )

    write(
        ROOT / "collaboration" / "agent" / "README.md",
        """# AI agent adapter\n\nThe agent must use the same editing primitives as human clients.\n\nDo not create a privileged AI-only mutation API. Agent tools should map directly to reducers such as move_clip, trim_clip, split_clip, delete_clip, set_volume, and add_effect.\n""",
    )

    project_spec = {
        "name": "opencut-multiplayer",
        "source": "OpenCut Classic",
        "upstream": UPSTREAM,
        "canonicalState": "SpacetimeDB",
        "mediaStorage": ["local", "S3", "R2"],
        "clients": ["OpenCut editor", "AI agent"],
        "milestone1": "Mirror a clip move between two browser sessions",
    }
    write(
        ROOT / "collaboration" / "project-spec.json",
        json.dumps(project_spec, indent=2) + "\n",
    )


def update_gitignore() -> None:
    gitignore = ROOT / ".gitignore"
    current = gitignore.read_text(encoding="utf-8") if gitignore.exists() else ""
    entries = ["", "# MHacks collaboration", ".spacetime/", "collaboration/.env", ""]
    marker = "# MHacks collaboration"
    if marker not in current:
        gitignore.write_text(current.rstrip() + "\n" + "\n".join(entries), encoding="utf-8")
        print("updated .gitignore")


def main() -> None:
    ensure_git()
    print(f"Initializing OpenCut multiplayer project in: {ROOT}")
    import_opencut()
    scaffold_collaboration()
    update_gitignore()
    print("\nBootstrap complete.")
    print("Next commands:")
    print("  bun install")
    print("  cp apps/web/.env.example apps/web/.env.local")
    print("  bun dev:web")
    print("\nThen we can identify OpenCut's timeline mutation boundary and wire the first SpacetimeDB reducer.")


if __name__ == "__main__":
    main()
