/**
 * Connecting and authenticating to SpacetimeDB.
 */

import { DbConnection } from "./module_bindings";

/**
 * Where to keep the auth token between sessions.
 *
 * Reusing the token is what makes a returning editor the same `Identity`, and
 * therefore the same person. The host address is only where the socket connects.
 * It is never a stand-in for who someone is, so two people on one network stay
 * two people. One browser holds one token, so two tabs there are one person.
 */
export interface TokenStore {
	get(): string | undefined;
	set(token: string): void;
}

export interface ConnectOptions {
	/** SpacetimeDB host, e.g. `ws://localhost:3000`. */
	uri: string;
	/** Published module name, e.g. `opencut-collab`. */
	database: string;
	tokenStore?: TokenStore;
	onDisconnect?: (error?: Error) => void;
}

const TOKEN_KEY = "opencut.collab.token";

function tokenKey(uri: string): string {
	return `${TOKEN_KEY}:${uri}`;
}

function isLoopbackUri(uri: string): boolean {
	try {
		const hostname = new URL(uri).hostname;
		return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
	} catch {
		return false;
	}
}

/**
 * The saved login is per database host.
 *
 * A token from the local server is not a Maincloud login. Reusing it would
 * make this browser fail to connect, or show up as the wrong person.
 */
export function browserTokenStore(uri = ""): TokenStore {
	const key = uri ? tokenKey(uri) : TOKEN_KEY;
	return {
		get: () => {
			try {
				const scoped = globalThis.localStorage?.getItem(key);
				if (scoped) {
					return scoped;
				}
				if (!uri || isLoopbackUri(uri)) {
					return globalThis.localStorage?.getItem(TOKEN_KEY) ?? undefined;
				}
				return undefined;
			} catch {
				return undefined;
			}
		},
		set: (token) => {
			try {
				globalThis.localStorage?.setItem(key, token);
				if (!uri || isLoopbackUri(uri)) {
					globalThis.localStorage?.setItem(TOKEN_KEY, token);
				}
			} catch {
				// A blocked storage API is not a reason to refuse to collaborate;
				// the session simply starts as a new identity next time.
			}
		},
	};
}

export function memoryTokenStore(): TokenStore {
	let token: string | undefined;
	return {
		get: () => token,
		set: (next) => {
			token = next;
		},
	};
}

export function connect(options: ConnectOptions): Promise<DbConnection> {
	const tokenStore = options.tokenStore ?? browserTokenStore(options.uri);

	return new Promise((resolve, reject) => {
		let settled = false;

		DbConnection.builder()
			.withUri(options.uri)
			.withDatabaseName(options.database)
			.withToken(tokenStore.get())
			.onConnect((connection, _identity, token) => {
				tokenStore.set(token);
				settled = true;
				resolve(connection);
			})
			.onConnectError((_ctx, error) => {
				settled = true;
				reject(error);
			})
			.onDisconnect((_ctx, error) => {
				// A disconnect before `onConnect` is a failed connection attempt, so
				// it has to reject the promise rather than fire the disconnect hook.
				if (!settled) {
					settled = true;
					reject(error ?? new Error("disconnected before connecting"));
					return;
				}
				options.onDisconnect?.(error);
			})
			.build();
	});
}
