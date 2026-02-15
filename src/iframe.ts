/**
 * Iframe Creation and Lifecycle Management
 *
 * Creates, configures, and manages the lifecycle of the iframe element
 * that hosts the Venyu booking widget. The iframe loads the play app's
 * embed routes with appropriate sandbox attributes and URL parameters.
 *
 * Security attributes:
 * - `sandbox` restricts iframe capabilities to only what is needed
 * - `allow="payment"` enables the Stripe Payment Request API
 * - Origin is passed as a URL parameter for postMessage validation
 *
 * The iframe URL structure:
 *   {playUrl}/embed/o/{orgSlug}/{facilitySlug}[/{courtSlug}]
 *     ?parentOrigin={encodedOrigin}
 *     &embedToken={token}
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Sandbox permissions granted to the iframe.
 *
 * - allow-scripts: Required for the React app to run
 * - allow-same-origin: Required for cookies/storage (auth sessions)
 * - allow-forms: Required for form submission (booking, payment)
 * - allow-popups: Required for auth popup flow
 * - allow-popups-to-escape-sandbox: Allows popups to have full capabilities
 *   (needed for OAuth flows in the auth popup)
 */
const SANDBOX_PERMISSIONS = [
	'allow-scripts',
	'allow-same-origin',
	'allow-forms',
	'allow-popups',
	'allow-popups-to-escape-sandbox',
].join(' ');

/** Minimum height for the iframe to prevent a collapsed initial state */
const MIN_HEIGHT_PX = 400;

// =============================================================================
// Configuration
// =============================================================================

export interface IframeConfig {
	/** Base URL of the play app (e.g. 'https://play.venyu.ch') */
	playUrl: string;
	/** Organization slug for URL routing */
	orgSlug: string;
	/** Facility slug for URL routing */
	facilitySlug: string;
	/** Optional court slug to navigate directly to a specific court */
	courtSlug?: string;
	/** Display mode: 'full' or 'calendar' (default: 'full') */
	mode?: 'full' | 'calendar';
	/** Signed embed session token from the API */
	embedToken: string;
	/** Embed session ID for auth token binding */
	embedSessionId: string;
}

export interface IframeResult {
	/** The created iframe element (already configured, ready to append to DOM) */
	iframe: HTMLIFrameElement;
	/** Removes the iframe from the DOM and cleans up */
	destroy: () => void;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Creates and configures an iframe element for the Venyu embed widget.
 *
 * The iframe is created with:
 * - Correct src URL based on org/facility/court slugs
 * - Sandbox restrictions for security
 * - Payment API permission for Stripe
 * - Accessible title attribute
 * - Responsive styling (100% width, no border, minimum height)
 *
 * The iframe is NOT appended to the DOM by this function - the caller
 * is responsible for inserting it into the container element.
 *
 * @param config - Configuration with URLs, slugs, and embed token
 * @returns IframeResult with the element and a destroy function
 */
export function createIframe(config: IframeConfig): IframeResult {
	const { playUrl, orgSlug, facilitySlug, courtSlug, mode, embedToken, embedSessionId } = config;

	// -------------------------------------------------------------------------
	// Build the iframe src URL
	// -------------------------------------------------------------------------

	// Base path: /embed/o/{orgSlug}/{facilitySlug}
	// With court: /embed/o/{orgSlug}/{facilitySlug}/{courtSlug}
	let path = `/embed/o/${encodeURIComponent(orgSlug)}/${encodeURIComponent(facilitySlug)}`;
	if (courtSlug) {
		path += `/${encodeURIComponent(courtSlug)}`;
	}

	// Construct URL with search parameters
	const url = new URL(path, playUrl);
	url.searchParams.set('parentOrigin', window.location.origin);
	url.searchParams.set('embedToken', embedToken);
	url.searchParams.set('embedSessionId', embedSessionId);
	if (mode && mode !== 'full') {
		url.searchParams.set('mode', mode);
	}

	// -------------------------------------------------------------------------
	// Create and configure the iframe element
	// -------------------------------------------------------------------------

	const iframe = document.createElement('iframe');

	// Source URL pointing to the play app's embed routes
	iframe.src = url.toString();

	// Security: sandbox restricts iframe to only needed capabilities
	iframe.setAttribute('sandbox', SANDBOX_PERMISSIONS);

	// Permissions: enable the Payment Request API for Stripe integration
	iframe.setAttribute('allow', 'payment');

	// Accessibility: descriptive title for screen readers
	iframe.title = 'Venyu Booking';

	// Styling: responsive width, no border, minimum height for initial load.
	// Height will be dynamically updated via venyu:resize messages from the iframe.
	iframe.style.width = '100%';
	iframe.style.border = 'none';
	iframe.style.minHeight = `${MIN_HEIGHT_PX}px`;
	iframe.style.display = 'block';

	// Prevent the iframe from contributing to the parent's scroll height
	// in unexpected ways during content transitions
	iframe.style.colorScheme = 'normal';

	// -------------------------------------------------------------------------
	// Destroy function
	// -------------------------------------------------------------------------

	function destroy(): void {
		// Remove from DOM if still attached
		if (iframe.parentNode) {
			iframe.parentNode.removeChild(iframe);
		}

		// Clear the src to stop any ongoing network requests or scripts.
		// Setting to about:blank is the standard way to unload iframe content.
		iframe.src = 'about:blank';
	}

	return { iframe, destroy };
}
