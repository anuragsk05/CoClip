/**
 * Makes `opencut-wasm` importable under the test runner.
 *
 * The package is a `wasm-pack --target bundler` build: its entry point imports
 * the `.wasm` file as if it were an ES module and expects the bundler to wire
 * the circular import between the module and its JavaScript glue. A test runner
 * resolves that import as a plain WebAssembly namespace, so `__wbindgen_start`
 * never appears and the import throws before any test runs.
 *
 * Instantiating the module here does the wiring the bundler would have done,
 * then replaces the package entry with the glue, which already re-exports the
 * full API.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { mock } from "bun:test";

import * as glue from "opencut-wasm/opencut_wasm_bg.js";

const require = createRequire(import.meta.url);

const bytes = readFileSync(require.resolve("opencut-wasm/opencut_wasm_bg.wasm"));
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
	// The import name is the glue's path as written inside the wasm binary.
	"./opencut_wasm_bg.js": glue as unknown as WebAssembly.ModuleImports,
});

const exports = instance.exports as {
	__wbindgen_start?: () => void;
};

glue.__wbg_set_wasm(exports);
exports.__wbindgen_start?.();

mock.module("opencut-wasm", () => glue);
