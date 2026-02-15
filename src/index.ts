/**
 * Venyu Embed Widget - Public Entry Point
 *
 * Framework-agnostic JavaScript SDK for embedding the Venyu booking widget
 * on third-party websites. Works as both an ESM import and an IIFE script tag.
 *
 * Usage (IIFE / script tag):
 * ```html
 * <div id="venyu-booking"></div>
 * <script src="https://play.venyu.ch/embed.js"></script>
 * <script>
 *   VenyuEmbed.init({
 *     container: '#venyu-booking',
 *     publicKey: 'pk_embed_abc123',
 *     orgSlug: 'tennis-club-zurich',
 *     facilitySlug: 'main-courts',
 *     locale: 'de',
 *   }, {
 *     onBooked: function(data) {
 *       console.log('Booking completed:', data.bookingId);
 *     }
 *   });
 * </script>
 * ```
 *
 * Usage (ESM import):
 * ```ts
 * import { init } from '@venyu/embed';
 *
 * const widget = await init({
 *   container: '#venyu-booking',
 *   publicKey: 'pk_embed_abc123',
 *   orgSlug: 'tennis-club-zurich',
 *   facilitySlug: 'main-courts',
 * });
 *
 * // Later: update config
 * widget.setConfig({ locale: 'en' });
 *
 * // Cleanup
 * widget.destroy();
 * ```
 */

import { createIframe } from './iframe';
import { createMessagingBridge } from './messaging';
import type {
	EmbedSessionResponse,
	VenyuEmbedCallbacks,
	VenyuEmbedConfig,
	VenyuEmbedInstance,
} from './types';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_API_URL = 'https://api.venyu.ch';
const DEFAULT_PLAY_URL = 'https://play.venyu.ch';
const DEFAULT_LOCALE = 'de';

/**
 * Timeout for the embed session initialization API call (in milliseconds).
 * If the API does not respond within this window, the init promise rejects.
 */
const API_TIMEOUT_MS = 15_000;

/**
 * Timeout for the iframe to send its venyu:ready message (in milliseconds).
 * If the iframe fails to signal ready within this window, the init promise
 * rejects with a timeout error. This guards against broken iframe loads.
 */
const READY_TIMEOUT_MS = 30_000;

// =============================================================================
// Validation
// =============================================================================

/**
 * Validates the required configuration fields and returns a normalized config
 * with defaults applied. Throws descriptive errors for missing or invalid fields.
 */
function validateConfig(config: VenyuEmbedConfig): {
	container: HTMLElement;
	publicKey: string;
	orgSlug: string;
	facilitySlug: string;
	courtSlug: string | undefined;
	mode: 'full' | 'calendar';
	locale: string;
	theme: NonNullable<VenyuEmbedConfig['theme']>;
	apiUrl: string;
	playUrl: string;
} {
	// Resolve container: accept either a CSS selector or an HTMLElement
	let container: HTMLElement | null;
	if (typeof config.container === 'string') {
		container = document.querySelector<HTMLElement>(config.container);
		if (!container) {
			throw new Error(
				`[VenyuEmbed] Container element not found: "${config.container}". ` +
					'Ensure the element exists in the DOM before calling init().',
			);
		}
	} else if (config.container instanceof HTMLElement) {
		container = config.container;
	} else {
		throw new Error(
			'[VenyuEmbed] Invalid container: must be a CSS selector string or HTMLElement.',
		);
	}

	// Required string fields
	if (!config.publicKey || typeof config.publicKey !== 'string') {
		throw new Error('[VenyuEmbed] publicKey is required and must be a non-empty string.');
	}
	if (!config.orgSlug || typeof config.orgSlug !== 'string') {
		throw new Error('[VenyuEmbed] orgSlug is required and must be a non-empty string.');
	}
	if (!config.facilitySlug || typeof config.facilitySlug !== 'string') {
		throw new Error('[VenyuEmbed] facilitySlug is required and must be a non-empty string.');
	}

	// Optional court slug validation
	const courtSlug =
		config.courtSlug && typeof config.courtSlug === 'string' ? config.courtSlug : undefined;

	// Mode validation
	const mode = config.mode === 'full' || config.mode === 'calendar' ? config.mode : 'full';

	// Locale with default
	const locale =
		config.locale && typeof config.locale === 'string' ? config.locale : DEFAULT_LOCALE;

	// Theme with default (empty object = no overrides)
	const theme = config.theme ?? {};

	// URLs with defaults, strip trailing slashes for consistency
	const apiUrl = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '');
	const playUrl = (config.playUrl ?? DEFAULT_PLAY_URL).replace(/\/+$/, '');

	return {
		container,
		publicKey: config.publicKey,
		orgSlug: config.orgSlug,
		facilitySlug: config.facilitySlug,
		courtSlug,
		mode,
		locale,
		theme,
		apiUrl,
		playUrl,
	};
}

// =============================================================================
// API Client
// =============================================================================

/**
 * Calls the embed session initialization endpoint to validate the public key
 * and origin, returning a signed embed token for iframe authentication.
 *
 * @param apiUrl - Base API URL (e.g. 'https://api.venyu.ch')
 * @param publicKey - Organization's public embed key
 * @returns Session response with embedToken and organization details
 * @throws Error if the API call fails or returns an error response
 */
async function initEmbedSession(apiUrl: string, publicKey: string): Promise<EmbedSessionResponse> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

	try {
		const response = await fetch(`${apiUrl}/api/embed/session/init`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				publicKey,
				origin: window.location.origin,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			// Attempt to extract a meaningful error message from the response body.
			// Try multiple paths to handle both oRPC error format
			// (data.message) and standard REST formats (error.message, message).
			let errorMessage = `API error: ${response.status} ${response.statusText}`;
			try {
				const errorBody = (await response.json()) as {
					data?: { message?: string };
					error?: { message?: string };
					message?: string;
				};
				const extracted = errorBody.data?.message ?? errorBody.error?.message ?? errorBody.message;
				if (extracted) {
					errorMessage = extracted;
				}
			} catch {
				// Response body was not JSON or could not be parsed - use the default message
			}
			throw new Error(`[VenyuEmbed] ${errorMessage}`);
		}

		const data = (await response.json()) as EmbedSessionResponse;

		// Validate the response has the required embedToken field.
		// Check type explicitly and guard against empty strings since a
		// falsy-only check could mask unexpected zero-length tokens.
		if (!data.embedToken || typeof data.embedToken !== 'string' || data.embedToken.length === 0) {
			throw new Error('[VenyuEmbed] Invalid API response: missing or empty embedToken.');
		}

		return data;
	} catch (error) {
		if (error instanceof DOMException && error.name === 'AbortError') {
			throw new Error(
				'[VenyuEmbed] Session initialization timed out. ' +
					'Check your network connection and API URL.',
			);
		}
		// Re-throw VenyuEmbed errors as-is, wrap unknown errors
		if (error instanceof Error && error.message.startsWith('[VenyuEmbed]')) {
			throw error;
		}
		throw new Error(
			`[VenyuEmbed] Failed to initialize embed session: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	} finally {
		clearTimeout(timeoutId);
	}
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initializes the Venyu embed widget inside the specified container.
 *
 * This function:
 * 1. Validates the provided configuration
 * 2. Calls the API to obtain a signed embed token
 * 3. Creates an iframe pointing to the play app's embed routes
 * 4. Sets up the postMessage bridge for parent-iframe communication
 * 5. Waits for the iframe to signal readiness (venyu:ready handshake)
 * 6. Returns an instance handle for runtime configuration and cleanup
 *
 * The returned promise rejects if any step fails (invalid config, API error,
 * iframe load failure, or handshake timeout).
 *
 * @param config - Widget configuration (container, keys, slugs, options)
 * @param callbacks - Optional event callbacks (onReady, onBooked, onError, etc.)
 * @returns Promise resolving to a VenyuEmbedInstance for runtime control
 * @throws Error if configuration is invalid, API fails, or iframe times out
 */
export async function init(
	config: VenyuEmbedConfig,
	callbacks?: VenyuEmbedCallbacks,
): Promise<VenyuEmbedInstance> {
	const safeCallbacks: VenyuEmbedCallbacks = callbacks ?? {};
	let destroyed = false;

	// -------------------------------------------------------------------------
	// Step 1: Validate configuration
	// -------------------------------------------------------------------------

	let validated: ReturnType<typeof validateConfig>;
	try {
		validated = validateConfig(config);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		safeCallbacks.onError?.(err);
		throw err;
	}

	const {
		container,
		publicKey,
		orgSlug,
		facilitySlug,
		courtSlug,
		mode,
		locale,
		theme,
		apiUrl,
		playUrl,
	} = validated;

	// -------------------------------------------------------------------------
	// Step 2: Initialize embed session via API
	// -------------------------------------------------------------------------

	let session: EmbedSessionResponse;
	try {
		session = await initEmbedSession(apiUrl, publicKey);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		safeCallbacks.onError?.(err);
		throw err;
	}

	// Guard against destroy() being called while the API request was in flight
	if (destroyed) {
		throw new Error('[VenyuEmbed] Widget was destroyed during initialization.');
	}

	// -------------------------------------------------------------------------
	// Step 3: Create the iframe
	// -------------------------------------------------------------------------

	const { iframe, destroy: destroyIframe } = createIframe({
		playUrl,
		orgSlug,
		facilitySlug,
		courtSlug,
		mode: mode !== 'full' ? mode : undefined,
		embedToken: session.embedToken,
		embedSessionId: session.embedSessionId,
	});

	// Append the iframe to the container
	container.appendChild(iframe);

	// -------------------------------------------------------------------------
	// Step 4: Set up the messaging bridge
	// -------------------------------------------------------------------------

	const bridge = createMessagingBridge({
		iframe,
		playUrl,
		locale,
		theme,
		callbacks: safeCallbacks,
		embedSessionId: session.embedSessionId,
	});

	// -------------------------------------------------------------------------
	// Step 5: Wait for the iframe to be ready (with timeout)
	// -------------------------------------------------------------------------

	// Track the ready timeout so it can be cleared to prevent memory leaks
	let readyTimeoutId: ReturnType<typeof setTimeout> | undefined;

	try {
		await Promise.race([
			bridge.ready,
			new Promise<never>((_, reject) => {
				readyTimeoutId = setTimeout(
					() =>
						reject(
							new Error(
								'[VenyuEmbed] Iframe did not become ready within ' +
									`${READY_TIMEOUT_MS / 1000} seconds. ` +
									'Check that the play app URL is correct and accessible.',
							),
						),
					READY_TIMEOUT_MS,
				);
			}),
		]);
	} catch (error) {
		// Clean up on failure: remove iframe and bridge
		bridge.destroy();
		destroyIframe();

		const err = error instanceof Error ? error : new Error(String(error));
		safeCallbacks.onError?.(err);
		throw err;
	} finally {
		// Always clear the timeout to prevent it from firing after resolution
		// and leaking the timer reference.
		clearTimeout(readyTimeoutId);
	}

	// Guard against destroy() being called during the ready wait
	if (destroyed) {
		bridge.destroy();
		destroyIframe();
		throw new Error('[VenyuEmbed] Widget was destroyed during initialization.');
	}

	// -------------------------------------------------------------------------
	// Step 6: Return the instance handle
	// -------------------------------------------------------------------------

	const instance: VenyuEmbedInstance = {
		setConfig(partial) {
			if (destroyed) {
				throw new Error('[VenyuEmbed] Cannot call setConfig() on a destroyed widget.');
			}
			bridge.sendConfigUpdate({
				locale: partial.locale,
				theme: partial.theme,
			});
		},

		destroy() {
			if (destroyed) return;
			destroyed = true;

			bridge.destroy();
			destroyIframe();
		},
	};

	return instance;
}

// =============================================================================
// Type Exports
// =============================================================================

export type {
	VenyuEmbedCallbacks,
	VenyuEmbedConfig,
	VenyuEmbedInstance,
	VenyuEmbedTheme,
} from './types';
