import type { UiAppId } from '../ui/appPaths.mts'
import { STATOBLAST_SCREENSHOTS } from './ui-screenshot-specs/statoblast.mts'
import { TRADING_SCREENSHOTS } from './ui-screenshot-specs/trading.mts'
import { ZOLTAR_SCREENSHOTS } from './ui-screenshot-specs/zoltar.mts'

/**
 * Screenshots of the walletless UI simulations that documentation pages embed.
 *
 * Each app's list lives in `tooling/docs/ui-screenshot-specs/<app>.mts`. Every entry is captured by
 * `bun run docs:screenshots` into `docs/assets/screenshots/<app>/<id>.png`.
 * Steps address controls by their visible label, so a renamed label makes the capture fail and points at
 * the documentation text that quotes it. `expectText` lists the labels the embedding page quotes.
 */

export type UiScreenshotStep =
	/** Click the visible, enabled control whose label or accessible name equals `click`; `nth` picks among duplicates, and -1 picks the last. */
	| { readonly click: string; readonly nth?: number }
	/** Replace the value of the input labelled `fill`. */
	| { readonly fill: string; readonly value: string }
	/** Wait until the page text contains the value. */
	| { readonly waitForText: string }
	/** Wait until the page text no longer contains the value, for example a loading indicator. */
	| { readonly waitForNoText: string }
	/** Wait until the control labelled `waitForEnabled` can be clicked. */
	| { readonly waitForEnabled: string }
	/** Go back one entry in the browser history, as the reader's Back button does. */
	| { readonly back: true }

export type UiScreenshotCrop = {
	/** CSS selector of the element to capture; the smallest match that contains `containing` wins. */
	readonly selector: string
	readonly containing?: string
	/** Extra CSS pixels around the element. Defaults to 16. */
	readonly padding?: number
}

export type UiScreenshotSpec = {
	readonly id: string
	readonly app: UiAppId
	readonly scenario: string
	/** Hash route, for example `#/portfolio`. Defaults to the app's landing route. */
	readonly route?: string
	readonly viewport?: { readonly width: number; readonly height: number }
	readonly steps?: readonly UiScreenshotStep[]
	/** Text that must be visible before capture. */
	readonly expectText?: readonly string[]
	/** Capture one element instead of the viewport; everything beside it is hidden first. */
	readonly crop?: UiScreenshotCrop
	/** Documentation pages (relative to `docs/`) that embed this screenshot. */
	readonly usedBy: readonly string[]
}

export type UiScreenshotApp = {
	readonly title: string
	/** Source roots whose content decides whether the app's screenshots are current. */
	readonly sourceRoots: readonly string[]
}

export const UI_SCREENSHOT_APPS: Partial<Record<UiAppId, UiScreenshotApp>> = {
	trading: {
		title: 'Augur Trading',
		// The app itself plus the shared styles, components, copy, and formatters it renders; shared protocol logic rarely changes what a screenshot shows.
		sourceRoots: [
			'ui/trading/ts',
			'ui/trading/css',
			'ui/trading/index.html',
			'ui/coreShared/css',
			'ui/coreShared/ts/app/components',
			'ui/coreShared/ts/components',
			'ui/coreShared/ts/copy',
			'ui/coreShared/ts/lib/formatters.ts',
			'ui/zoltarShared/css',
			'ui/statoblastShared/css',
			'ui/statoblastShared/ts/features/open-oracle/components',
		],
	},
	statoblast: {
		title: 'Augur Statoblast',
		sourceRoots: [
			'ui/statoblast/ts',
			'ui/statoblast/index.html',
			'ui/coreShared/css',
			'ui/coreShared/ts/app/components',
			'ui/coreShared/ts/components',
			'ui/coreShared/ts/copy',
			'ui/coreShared/ts/lib/formatters.ts',
			'ui/zoltarShared/css',
			'ui/zoltarShared/ts/copy',
			'ui/zoltarShared/ts/features',
			'ui/statoblastShared/css',
			'ui/statoblastShared/ts/copy',
			'ui/statoblastShared/ts/features',
		],
	},
	zoltar: {
		title: 'Zoltar',
		sourceRoots: ['ui/zoltar/ts', 'ui/zoltar/index.html', 'ui/coreShared/css', 'ui/coreShared/ts/app/components', 'ui/coreShared/ts/components', 'ui/coreShared/ts/copy', 'ui/coreShared/ts/lib/formatters.ts', 'ui/zoltarShared/css', 'ui/zoltarShared/ts/copy', 'ui/zoltarShared/ts/features'],
	},
}

export const UI_SCREENSHOTS: readonly UiScreenshotSpec[] = [...TRADING_SCREENSHOTS, ...STATOBLAST_SCREENSHOTS, ...ZOLTAR_SCREENSHOTS]
