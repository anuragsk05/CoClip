# CoClip

> **The real-time collaborative video editor in your browser.**  
> Multi-track timelines, multiplayer presence, deterministic state synchronization, and an autonomous AI co-editor.

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js)](https://nextjs.org/)
[![Rust](https://img.shields.io/badge/Rust-Core-orange?style=flat&logo=rust)](https://www.rust-lang.org/)
[![SpacetimeDB](https://img.shields.io/badge/SpacetimeDB-Multiplayer-purple?style=flat)](https://spacetimedb.com/)
[![WebGPU](https://img.shields.io/badge/WebGPU-Accelerated-blue?style=flat)](https://www.w3.org/TR/webgpu/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## Overview

**CoClip** brings the seamless, multiplayer collaboration of modern design tools to video editing. Edit timelines concurrently with your team, track collaborator playheads and selections in real time, leverage an AI assistant that can cut and balance tracks directly on your timeline, and export studio-grade videos—all with local hardware acceleration and zero cloud-upload wait times.

---

## ✨ Features

- **👥 Real-Time Timeline Multiplayer**: Multiple creators can work simultaneously on the same timeline without lockouts or merge conflicts. Edit video and audio while a teammate color grades or mixes soundtrack stems.
- **⚡ Deterministic State Synchronization**: Powered by [SpacetimeDB](https://spacetimedb.com) and WebAssembly reducers for conflict-free, sub-millisecond timeline replication.
- **👁️ Live Presence & Follow Director**: Track active collaborator cursors, selections, and playhead positions live across the timeline. Jump into sync to review cuts together in real time.
- **🤖 Autonomous AI Timeline Co-Editor**: Summon an AI editor directly into your shared room to trim pauses, suggest split points, add markers, or level audio stems through the same shared reducer pipeline.
- **🔒 In-Browser Speed & Local Privacy**: Heavy source footage stays on your machine. Hardware-accelerated decoding via WebCodecs and rendering via WebGPU/WASM means zero waiting for massive gigabyte uploads.
- **🎛️ Studio-Grade Creative Suite**: Multi-track video and audio tracks, high-fidelity audio waveforms, keyframe animations, chroma key, blend modes, freeform masks, and instant 4K export.

---

## 🏗️ Architecture & Project Structure

CoClip follows a modular architecture where core logic is platform-agnostic and frontends serve as specialized UI shells.

```
CoClip/
├── apps/
│   ├── web/               # Next.js web application (React 19, Tailwind CSS, Turbopack)
│   └── desktop/           # Native desktop app built with GPUI in Rust (in progress)
├── collaboration/
│   ├── spacetimedb/       # Rust module: database schema, tables, and transactional reducers
│   ├── client/            # Type-safe TypeScript client adapter for SpacetimeDB
│   └── agent/             # AI timeline collaborator powered by Gemini
├── rust/
│   ├── crates/            # Platform-agnostic core (compositor, timeline, time, effects, masks)
│   └── wasm/              # WebAssembly bridge linking the Rust engine to the web frontend
└── docs/                  # Subsystem guides, keyframes, effects, and architecture docs
```

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.2+)
- [Docker](https://docs.docker.com/get-docker/) & [Docker Compose](https://docs.docker.com/compose/) (for local database & cache)
- [Rust](https://rustup.rs/) (optional, required for WASM, Desktop, or SpacetimeDB development)

---

### Quick Start (Web App)

1. **Clone the repository:**

   ```bash
   git clone https://github.com/anuragsk05/CoClip.git
   cd CoClip
   ```

2. **Configure environment variables:**

   ```bash
   # Unix/Linux/macOS
   cp apps/web/.env.example apps/web/.env.local

   # Windows PowerShell
   Copy-Item apps/web/.env.example apps/web/.env.local
   ```

3. **Start local services (Postgres & Redis):**

   ```bash
   docker compose up -d db redis serverless-redis-http
   ```

4. **Install dependencies and run the development server:**

   ```bash
   bun install
   bun dev:web
   ```

5. **Open the application:**

   Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

### Real-Time Collaboration Setup (SpacetimeDB)

To enable real-time multiplayer rooms and the AI collaborator:

1. **Install the SpacetimeDB CLI:**

   ```bash
   curl -sSf https://install.spacetimedb.com | sh
   ```

2. **Start the local SpacetimeDB instance:**

   ```bash
   spacetime start
   ```

3. **Publish the collaboration module:**

   ```bash
   cd collaboration
   spacetime publish --project-path ./spacetimedb coclip-collab
   cd ..
   ```

4. **Connect the web app in `apps/web/.env.local`:**

   ```env
   NEXT_PUBLIC_COLLAB_URI=ws://localhost:3000
   NEXT_PUBLIC_COLLAB_DATABASE=coclip-collab
   GEMINI_API_KEY=your-gemini-api-key
   ```

5. Start `bun dev:web` and open the same project across multiple browser tabs or devices to collaborate live!

---

### Local WASM Development

If you are modifying the platform-agnostic Rust engine in `rust/`:

1. **Install tools:**

   ```bash
   cargo install wasm-pack cargo-watch
   ```

2. **Build and link the WASM module:**

   ```bash
   bun run build:wasm
   cd rust/wasm/pkg && bun link && cd ../../..
   cd apps/web && bun link opencut-wasm && cd ../..
   ```

3. **Watch for changes during development:**

   ```bash
   bun dev:wasm
   ```

---

### Self-Hosting with Docker

To run the entire stack via Docker:

```bash
docker compose up -d
```

The production web build will be available at [http://localhost:3100](http://localhost:3100).

---

## 🤝 Contributing

Contributions are welcome! Please feel free to open issues or submit pull requests at [github.com/anuragsk05/CoClip](https://github.com/anuragsk05/CoClip).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

![Star History Chart](https://api.star-history.com/svg?repos=anuragsk05/CoClip&type=Date)
