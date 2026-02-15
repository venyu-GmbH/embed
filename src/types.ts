/**
 * Venyu Embed Widget - Public Type Definitions
 *
 * These types define the configuration, callbacks, and instance interface
 * for the embeddable booking widget. They are the primary public API surface
 * consumed by third-party integrators.
 */

// =============================================================================
// Configuration
// =============================================================================

/**
 * Configuration for initializing the Venyu embed widget.
 *
 * Required fields: container, publicKey, orgSlug, facilitySlug.
 * Optional fields allow customization of locale, theme, and environment URLs.
 */
export interface VenyuEmbedConfig {
	/** The container element or CSS selector to mount the widget in */
	container: string | HTMLElement;
	/** Organization's public embed key (e.g. 'pk_embed_abc123') */
	publicKey: string;
	/** Organization slug used in URL routing */
	orgSlug: string;
	/** Facility slug (required) - identifies the venue facility */
	facilitySlug: string;
	/** Optional court slug to show a specific court's booking view */
	courtSlug?: string;
	/** Display mode: 'full' shows facility header + courts + calendar, 'calendar' shows only the booking calendar (default: 'full') */
	mode?: 'full' | 'calendar';
	/** Locale: 'de' | 'en' | 'fr' | 'it' (default: 'de') */
	locale?: string;
	/** Theme overrides applied to the embedded widget */
	theme?: VenyuEmbedTheme;
	/** API base URL (default: 'https://api.venyu.ch') */
	apiUrl?: string;
	/** Play app base URL (default: 'https://play.venyu.ch') */
	playUrl?: string;
}

/**
 * Theme customization options for the embedded widget.
 * All color values must be valid CSS hex colors (e.g. '#1a2b3c').
 */
export interface VenyuEmbedTheme {
	/** Primary brand color (hex) */
	primaryColor?: string;
	/** Widget background color (hex) */
	backgroundColor?: string;
	/** Primary text color (hex) */
	textColor?: string;
	/** Border radius for rounded elements (CSS value, e.g. '8px') */
	borderRadius?: string;
}

// =============================================================================
// Callbacks
// =============================================================================

/**
 * Event callbacks for the embed widget lifecycle.
 * All callbacks are optional. Errors are always reported via onError
 * in addition to any type-specific callback.
 */
export interface VenyuEmbedCallbacks {
	/** Called when the iframe has loaded and the postMessage handshake is complete */
	onReady?: () => void;
	/** Called when a booking is successfully completed inside the widget */
	onBooked?: (data: { bookingId: string; status: string }) => void;
	/** Called when authentication cannot work in the iframe and needs top-level navigation */
	onAuthFallbackRequired?: (data: { reason: string }) => void;
	/** Called on any error during initialization or runtime */
	onError?: (error: Error) => void;
}

// =============================================================================
// Instance
// =============================================================================

/**
 * Handle returned by `init()` to control the embedded widget after creation.
 * The instance becomes invalid after `destroy()` is called.
 */
export interface VenyuEmbedInstance {
	/**
	 * Update runtime configuration (locale and/or theme).
	 * Sends a `venyu:config:update` message to the iframe.
	 */
	setConfig(partial: Partial<Pick<VenyuEmbedConfig, 'locale' | 'theme'>>): void;
	/** Remove the widget from the DOM and clean up all listeners */
	destroy(): void;
}

// =============================================================================
// Internal Types (not exported from public API, used across modules)
// =============================================================================

/**
 * The response shape from the embed session init API endpoint.
 * Mirrors `InitEmbedSessionOutput` from `@venyu/api-client`.
 */
export interface EmbedSessionResponse {
	embedToken: string;
	embedSessionId: string;
	expiresAt: string;
	organizationId: string;
	organizationSlug: string;
	allowedFacilityIds: string[] | null;
}

/**
 * Internal state tracked by the messaging module.
 * Not exposed to consumers.
 */
export interface MessagingState {
	/** Nonce received from the iframe's venyu:ready message */
	nonce: string | null;
	/** Reference to the iframe element for source validation */
	iframe: HTMLIFrameElement;
	/** Reference to an open auth popup window (null when no popup is open) */
	popup: Window | null;
	/** Whether the handshake has completed (venyu:ready received + venyu:init sent) */
	handshakeComplete: boolean;
	/** Whether the bridge has been destroyed */
	destroyed: boolean;
}
