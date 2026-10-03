/**
 * Pulls Bun's ambient declarations in for the test files.
 *
 * TypeScript treats `bun:test` as a URI and skips module resolution for it
 * entirely, so the only way to type it is to load Bun's ambient declarations.
 * Automatic `@types` inclusion does not reach them, hence the explicit
 * reference.
 */
/// <reference types="bun" />
