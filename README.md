# @venyu/embed

[![npm version](https://img.shields.io/npm/v/@venyu/embed.svg)](https://www.npmjs.com/package/@venyu/embed)
[![license](https://img.shields.io/github/license/venyu-GmbH/embed.svg)](https://github.com/venyu-GmbH/embed/blob/main/LICENSE)

Embeddable booking widget for Venyu sports venues. Framework-agnostic JavaScript SDK that works as both an ESM import and a `<script>` tag.

## Installation

```bash
# npm
npm install @venyu/embed

# pnpm
pnpm add @venyu/embed

# yarn
yarn add @venyu/embed
```

Or load directly via script tag:

```html
<script src="https://play.venyu.ch/embed.js"></script>
```

## Quick Start

### Script Tag (IIFE)

```html
<div id="venyu-booking"></div>
<script src="https://play.venyu.ch/embed.js"></script>
<script>
  VenyuEmbed.init({
    container: '#venyu-booking',
    publicKey: 'pk_embed_abc123',
    orgSlug: 'tennis-club-zurich',
    facilitySlug: 'main-courts',
  }, {
    onBooked: function(data) {
      console.log('Booking completed:', data.bookingId);
    }
  });
</script>
```

### ESM Import

```ts
import { init } from '@venyu/embed';

const widget = await init({
  container: '#venyu-booking',
  publicKey: 'pk_embed_abc123',
  orgSlug: 'tennis-club-zurich',
  facilitySlug: 'main-courts',
});

// Update config at runtime
widget.setConfig({ locale: 'en' });

// Cleanup
widget.destroy();
```

## Configuration

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `container` | `string \| HTMLElement` | Yes | — | CSS selector or DOM element to mount the widget |
| `publicKey` | `string` | Yes | — | Organization's public embed key |
| `orgSlug` | `string` | Yes | — | Organization slug |
| `facilitySlug` | `string` | Yes | — | Facility slug |
| `courtSlug` | `string` | No | — | Show a specific court's booking view |
| `mode` | `'full' \| 'calendar'` | No | `'full'` | `'full'` shows facility header + courts + calendar; `'calendar'` shows only the booking calendar |
| `locale` | `string` | No | `'de'` | Locale (`'de'`, `'en'`, `'fr'`, `'it'`) |
| `theme` | `VenyuEmbedTheme` | No | `{}` | Theme overrides (see below) |
| `apiUrl` | `string` | No | `'https://api.venyu.ch'` | API base URL |
| `playUrl` | `string` | No | `'https://play.venyu.ch'` | Play app base URL |

## Callbacks

Pass callbacks as the second argument to `init()`:

```ts
const widget = await init(config, {
  onReady: () => console.log('Widget loaded'),
  onBooked: (data) => console.log('Booked:', data.bookingId),
  onAuthFallbackRequired: (data) => console.log('Auth fallback:', data.reason),
  onError: (error) => console.error('Widget error:', error),
});
```

| Callback | Payload | Description |
|----------|---------|-------------|
| `onReady` | — | Iframe loaded and handshake complete |
| `onBooked` | `{ bookingId, status }` | Booking successfully completed |
| `onAuthFallbackRequired` | `{ reason }` | Auth needs top-level navigation |
| `onError` | `Error` | Any initialization or runtime error |

## Instance Methods

| Method | Description |
|--------|-------------|
| `setConfig({ locale?, theme? })` | Update locale and/or theme at runtime |
| `destroy()` | Remove widget from DOM and clean up listeners |

## Theme Customization

```ts
init({
  // ...required config
  theme: {
    primaryColor: '#1a73e8',
    backgroundColor: '#ffffff',
    textColor: '#1f2937',
    borderRadius: '8px',
  },
});
```

| Property | Type | Description |
|----------|------|-------------|
| `primaryColor` | `string` | Primary brand color (hex) |
| `backgroundColor` | `string` | Widget background color (hex) |
| `textColor` | `string` | Primary text color (hex) |
| `borderRadius` | `string` | Border radius for rounded elements (CSS value) |

## TypeScript

Full type definitions are included. Import types directly:

```ts
import type { VenyuEmbedConfig, VenyuEmbedCallbacks, VenyuEmbedInstance, VenyuEmbedTheme } from '@venyu/embed';
```

## License

[MIT](./LICENSE)
