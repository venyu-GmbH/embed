/**
 * Parent-Side PostMessage Bridge
 *
 * Manages the postMessage communication between the parent page (where the
 * embed script runs) and the Venyu iframe. Implements the parent side of
 * the venyu embed protocol v1.
 *
 * Protocol handshake (parent perspective):
 * 1. Iframe loads and sends `venyu:ready` with a cryptographic nonce
 * 2. Parent captures the nonce, sends `venyu:init` echoing the nonce + config
 * 3. Iframe validates the nonce echo, marks handshake complete
 * 4. All subsequent messages include the nonce for mutual validation
 *
 * Security model:
 * - All incoming messages are validated against the expected play app origin
 * - Message source is verified against the iframe's contentWindow
 * - Nonce binding prevents cross-iframe message spoofing
 * - Protocol version check ensures compatibility
 */

import type { MessagingState, VenyuEmbedCallbacks, VenyuEmbedTheme } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Must match PROTOCOL_VERSION in apps/play/src/lib/embed/validation.ts */
const PROTOCOL_VERSION = 1;

/** Prefix for all Venyu embed message types */
const MESSAGE_PREFIX = 'venyu:';

/** Default popup window dimensions for the auth flow */
const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 640;

// =============================================================================
// Message Types (mirrors validation.ts without Zod dependency)
// =============================================================================

/**
 * Base message shape for the embed protocol.
 * Every message (both directions) conforms to this structure.
 */
interface EmbedMessage {
	type: string;
	version: number;
	requestId: string;
	timestamp: number;
	nonce: string;
	payload: Record<string, unknown>;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generates a UUID v4 string for message request IDs.
 * Falls back to crypto.getRandomValues-based generation when
 * crypto.randomUUID is unavailable (older browsers).
 */
function generateRequestId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}

	// Fallback: manual UUID v4 generation using crypto.getRandomValues
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);

	// Set version (4) and variant (RFC 4122) bits.
	// Indices 6 and 8 are guaranteed to exist in a 16-byte array,
	// so the bitwise OR with 0 provides a safe default for the linter.
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');

	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20, 32),
	].join('-');
}

/**
 * Extracts the origin (protocol + host) from a URL string.
 * Used to derive the expected message origin from the playUrl config.
 *
 * @param url - Full URL (e.g. 'https://play.venyu.ch')
 * @returns Origin string (e.g. 'https://play.venyu.ch')
 */
function extractOrigin(url: string): string {
	try {
		return new URL(url).origin;
	} catch {
		// If URL parsing fails, return as-is (will cause origin mismatches
		// which is the safe default - messages will be rejected)
		return url;
	}
}

/**
 * Shape used for initial structural type narrowing of incoming postMessage data.
 * Every field is unknown because we validate each one individually before
 * promoting the value to the fully-typed EmbedMessage.
 */
interface RawMessageCandidate {
	type: unknown;
	version: unknown;
	requestId: unknown;
	timestamp: unknown;
	nonce: unknown;
	payload: unknown;
}

/**
 * Validates that an incoming message event conforms to the embed protocol.
 * Performs structural validation without Zod (this package has no dependencies).
 *
 * @param data - Raw event.data from a MessageEvent
 * @returns Validated message or null if invalid
 */
function validateIncomingMessage(data: unknown): EmbedMessage | null {
	if (typeof data !== 'object' || data === null) {
		return null;
	}

	const msg = data as RawMessageCandidate;

	// Type must be a string starting with the venyu prefix
	if (typeof msg.type !== 'string' || !msg.type.startsWith(MESSAGE_PREFIX)) {
		return null;
	}

	// Version must match our protocol version
	if (msg.version !== PROTOCOL_VERSION) {
		return null;
	}

	// Required string fields
	if (typeof msg.requestId !== 'string' || msg.requestId.length === 0) {
		return null;
	}
	if (typeof msg.nonce !== 'string' || msg.nonce.length === 0) {
		return null;
	}

	// Timestamp must be a positive integer
	if (typeof msg.timestamp !== 'number' || msg.timestamp <= 0) {
		return null;
	}

	// Payload must be an object
	if (typeof msg.payload !== 'object' || msg.payload === null) {
		return null;
	}

	return msg as unknown as EmbedMessage;
}

/**
 * Constructs a protocol-compliant message to send to the iframe.
 *
 * @param type - Message type (e.g. 'venyu:init')
 * @param payload - Typed payload object
 * @param nonce - Session nonce for validation
 * @returns Complete message object ready for postMessage
 */
function buildMessage(type: string, payload: Record<string, unknown>, nonce: string): EmbedMessage {
	return {
		type,
		version: PROTOCOL_VERSION,
		requestId: generateRequestId(),
		timestamp: Date.now(),
		nonce,
		payload,
	};
}

// =============================================================================
// Popup Positioning
// =============================================================================

/**
 * Calculates centered popup window position relative to the current screen.
 * Centers the popup over the parent window for the best UX.
 *
 * @returns Window features string for window.open
 */
function getPopupFeatures(): string {
	const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2));
	const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2));

	return [
		`width=${POPUP_WIDTH}`,
		`height=${POPUP_HEIGHT}`,
		`left=${left}`,
		`top=${top}`,
		'menubar=no',
		'toolbar=no',
		'location=yes',
		'status=no',
		'resizable=yes',
		'scrollbars=yes',
	].join(',');
}

// =============================================================================
// Messaging Bridge Configuration
// =============================================================================

export interface MessagingConfig {
	/** The iframe element hosting the embed widget */
	iframe: HTMLIFrameElement;
	/** Base URL of the play app (e.g. 'https://play.venyu.ch') */
	playUrl: string;
	/** Locale to send with venyu:init */
	locale: string;
	/** Theme overrides to send with venyu:init */
	theme: VenyuEmbedTheme;
	/** Event callbacks from the consumer */
	callbacks: VenyuEmbedCallbacks;
	/** Embed session ID for auth token binding */
	embedSessionId: string;
}

export interface MessagingBridge {
	/**
	 * Send a config update to the iframe (locale, theme).
	 * Only works after the handshake is complete.
	 */
	sendConfigUpdate: (update: { locale?: string; theme?: VenyuEmbedTheme }) => void;
	/** Tear down the bridge: remove listeners, close popups, mark destroyed */
	destroy: () => void;
	/** Promise that resolves when venyu:ready is received and handshake completes */
	ready: Promise<void>;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Creates the parent-side messaging bridge for communicating with the
 * Venyu embed iframe via postMessage.
 *
 * The bridge listens for messages from the iframe, validates them against
 * the protocol, and routes them to the appropriate callbacks. It also
 * handles the auth popup flow when the iframe requests authentication.
 *
 * @param config - Bridge configuration with iframe reference, URLs, and callbacks
 * @returns MessagingBridge with sendConfigUpdate, destroy, and ready promise
 */
export function createMessagingBridge(config: MessagingConfig): MessagingBridge {
	const { iframe, playUrl, locale, theme, callbacks, embedSessionId } = config;
	const expectedOrigin = extractOrigin(playUrl);

	const state: MessagingState = {
		nonce: null,
		iframe,
		popup: null,
		handshakeComplete: false,
		destroyed: false,
	};

	// Interval ID for polling popup.closed, so we can detect manual closure
	// and release the stale Window reference to avoid memory leaks.
	let popupPollIntervalId: ReturnType<typeof setInterval> | null = null;

	// The ready promise resolves once venyu:ready is received and venyu:init is sent.
	// The reject function is stored so we can reject on destroy or timeout.
	let resolveReady: () => void;
	let rejectReady: (reason: Error) => void;
	const readyPromise = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});

	// -------------------------------------------------------------------------
	// Send message to iframe
	// -------------------------------------------------------------------------

	/**
	 * Sends a typed message to the iframe's contentWindow.
	 * Silently returns if the bridge is destroyed or the iframe has no contentWindow.
	 */
	function sendToIframe(type: string, payload: Record<string, unknown>): void {
		if (state.destroyed) return;
		if (!state.nonce) return;

		const contentWindow = iframe.contentWindow;
		if (!contentWindow) return;

		const message = buildMessage(type, payload, state.nonce);
		contentWindow.postMessage(message, expectedOrigin);
	}

	// -------------------------------------------------------------------------
	// Auth Popup Flow
	// -------------------------------------------------------------------------

	/**
	 * Stops the popup close-detection polling interval and releases
	 * the popup Window reference so the GC can reclaim it.
	 */
	function clearPopupPoll(): void {
		if (popupPollIntervalId !== null) {
			clearInterval(popupPollIntervalId);
			popupPollIntervalId = null;
		}
	}

	/**
	 * Opens an auth popup window at the play app's auth popup route.
	 * The popup completes authentication and sends the result back to this
	 * window via postMessage. We relay that result to the iframe.
	 *
	 * A polling interval monitors popup.closed so that if the user manually
	 * closes the popup (without completing auth), the stale Window reference
	 * is cleaned up to avoid a memory leak.
	 */
	function openAuthPopup(): void {
		if (state.destroyed) return;

		// Close any existing popup and stop its poll before opening a new one
		clearPopupPoll();
		if (state.popup && !state.popup.closed) {
			state.popup.close();
		}

		// Construct the popup URL with session context for secure postMessage
		// delivery and auth token session binding.
		const popupUrl = new URL(`${playUrl}/embed/auth/popup`);
		popupUrl.searchParams.set('parentOrigin', window.location.origin);
		if (state.nonce) {
			popupUrl.searchParams.set('nonce', state.nonce);
		}
		popupUrl.searchParams.set('embedSessionId', embedSessionId);

		const popup = window.open(popupUrl.toString(), 'venyu-auth', getPopupFeatures());

		if (!popup) {
			// Popup was blocked by the browser. Notify the iframe so it can
			// fall back to top-level navigation.
			sendToIframe('venyu:auth:popup-result', {
				resultToken: '',
				error: 'popup_blocked',
			});
			callbacks.onError?.(new Error('Auth popup was blocked by the browser'));
			return;
		}

		state.popup = popup;

		// Poll for manual closure so the stale Window reference is released.
		// The interval self-clears once the popup is detected as closed.
		popupPollIntervalId = setInterval(() => {
			if (popup.closed) {
				clearPopupPoll();
				state.popup = null;
			}
		}, 500);
	}

	// -------------------------------------------------------------------------
	// Iframe resize handler
	// -------------------------------------------------------------------------

	/**
	 * Updates the iframe height based on the content size reported by the
	 * embedded widget. The iframe uses a ResizeObserver internally and
	 * sends venyu:resize messages whenever its content height changes.
	 */
	function handleResize(height: number): void {
		if (state.destroyed) return;
		if (typeof height !== 'number' || height < 0) return;

		iframe.style.height = `${Math.ceil(height)}px`;
	}

	// -------------------------------------------------------------------------
	// Message Listener
	// -------------------------------------------------------------------------

	/**
	 * Core message event handler. Validates every incoming message against
	 * the protocol before routing to the appropriate handler.
	 */
	function handleMessage(event: MessageEvent): void {
		if (state.destroyed) return;

		// 1. Origin validation - reject messages from unexpected origins
		if (event.origin !== expectedOrigin) {
			return;
		}

		// 2. Source validation - accept messages from our iframe or our popup
		const isFromIframe = event.source === iframe.contentWindow;
		const isFromPopup = state.popup !== null && !state.popup.closed && event.source === state.popup;

		if (!isFromIframe && !isFromPopup) {
			return;
		}

		// 3. Structural validation
		const message = validateIncomingMessage(event.data);
		if (!message) {
			return;
		}

		// 4. Handle popup auth results separately.
		//    The popup sends its result to window.opener (this window).
		//    We relay it to the iframe as venyu:auth:popup-result.
		//    Only accept the specific popup-result type with a valid nonce
		//    to prevent message spoofing from a compromised popup.
		if (isFromPopup) {
			if (message.type !== 'venyu:auth:popup-result') {
				return;
			}
			if (!state.nonce || message.nonce !== state.nonce) {
				return;
			}
			handlePopupMessage(message);
			return;
		}

		// 5. Handle the initial venyu:ready handshake
		if (message.type === 'venyu:ready') {
			handleReadyMessage(message);
			return;
		}

		// 6. Nonce validation for all post-handshake messages
		if (!state.handshakeComplete || message.nonce !== state.nonce) {
			return;
		}

		// 7. Route to the appropriate handler based on message type
		switch (message.type) {
			case 'venyu:resize': {
				const height = message.payload.height;
				if (typeof height === 'number') {
					handleResize(height);
				}
				break;
			}

			case 'venyu:booked': {
				const bookingId = message.payload.bookingId;
				const status = message.payload.status;
				if (typeof bookingId === 'string' && typeof status === 'string') {
					callbacks.onBooked?.({ bookingId, status });
				}
				break;
			}

			case 'venyu:auth:open-popup': {
				openAuthPopup();
				break;
			}

			case 'venyu:auth:fallback-required': {
				const reason = message.payload.reason;
				if (typeof reason === 'string') {
					callbacks.onAuthFallbackRequired?.({ reason });
				}
				break;
			}

			case 'venyu:navigate': {
				// Scroll the iframe into view when the embed navigates to a new page
				// (e.g. court selection → checkout). Without this, the user stays
				// scrolled to where they clicked the button and the new content
				// (Stripe payment form, confirmation, etc.) is hidden above the viewport.
				iframe.scrollIntoView({ behavior: 'smooth', block: 'start' });
				break;
			}

			default:
				// Unknown message types are silently ignored for forward compatibility.
				// New message types can be added in future protocol versions without
				// breaking existing embed script deployments.
				break;
		}
	}

	/**
	 * Handles the venyu:ready message from the iframe.
	 * This is the first message in the handshake. The iframe sends its nonce
	 * in this message, which we must echo back in venyu:init to prove identity.
	 */
	function handleReadyMessage(message: EmbedMessage): void {
		// Prevent duplicate handshakes. Once the nonce is captured and init
		// is sent, subsequent ready messages are ignored. The flag is checked
		// BEFORE any state mutation and set immediately to guard against two
		// rapid venyu:ready events both passing the check.
		if (state.handshakeComplete) {
			return;
		}
		state.handshakeComplete = true;

		// Capture the nonce from the iframe's ready message.
		// This nonce was generated by the iframe using crypto.getRandomValues
		// and must be echoed back in venyu:init for the iframe to trust us.
		state.nonce = message.nonce;

		// Send venyu:init with the nonce echoed in the payload (required by
		// the iframe's bridge validation) and also in the base message nonce field.
		const contentWindow = iframe.contentWindow;
		if (!contentWindow) {
			const error = new Error('Iframe contentWindow is not available');
			callbacks.onError?.(error);
			rejectReady(error);
			return;
		}

		const initMessage = buildMessage(
			'venyu:init',
			{
				nonce: state.nonce,
				locale: locale,
				theme: (theme as Record<string, unknown>) ?? {},
			},
			state.nonce,
		);

		contentWindow.postMessage(initMessage, expectedOrigin);

		// Notify the consumer that the widget is ready
		callbacks.onReady?.();
		resolveReady();
	}

	/**
	 * Handles messages from the auth popup window.
	 * Extracts the auth result and relays it to the iframe, then closes the popup.
	 */
	function handlePopupMessage(message: EmbedMessage): void {
		// The popup sends a message with auth result data.
		// We relay the relevant payload to the iframe as venyu:auth:popup-result.
		const resultToken = message.payload.resultToken;

		if (typeof resultToken === 'string' && resultToken.length > 0) {
			sendToIframe('venyu:auth:popup-result', { resultToken });
		}

		// Stop polling and close the popup after receiving the result
		clearPopupPoll();
		if (state.popup && !state.popup.closed) {
			state.popup.close();
		}
		state.popup = null;
	}

	// -------------------------------------------------------------------------
	// Setup
	// -------------------------------------------------------------------------

	window.addEventListener('message', handleMessage);

	// -------------------------------------------------------------------------
	// Public API
	// -------------------------------------------------------------------------

	function sendConfigUpdate(update: { locale?: string; theme?: VenyuEmbedTheme }): void {
		if (state.destroyed) return;
		if (!state.handshakeComplete) return;

		const payload: Record<string, unknown> = {};
		if (update.locale !== undefined) {
			payload.locale = update.locale;
		}
		if (update.theme !== undefined) {
			payload.theme = update.theme;
		}

		sendToIframe('venyu:config:update', payload);
	}

	function destroy(): void {
		if (state.destroyed) return;
		state.destroyed = true;

		// Remove the global message listener
		window.removeEventListener('message', handleMessage);

		// Stop popup close-detection polling
		clearPopupPoll();

		// Close any open auth popup
		if (state.popup && !state.popup.closed) {
			state.popup.close();
		}
		state.popup = null;

		// If the ready promise hasn't resolved yet, reject it
		rejectReady(new Error('Embed widget was destroyed before ready'));
	}

	return {
		sendConfigUpdate,
		destroy,
		ready: readyPromise,
	};
}
