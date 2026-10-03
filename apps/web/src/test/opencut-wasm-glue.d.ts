/**
 * The wasm-bindgen glue has no type declarations of its own; the package only
 * ships types for its entry point. Only the hook the preload needs is declared
 * here, so a typo in anything else still fails the build.
 */
declare module "opencut-wasm/opencut_wasm_bg.js" {
	export function __wbg_set_wasm(exports: WebAssembly.Exports): void;
}
