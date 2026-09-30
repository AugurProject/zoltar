import type { UiAppId } from '../ui/appPaths.mts'

/**
 * Screenshots of the walletless UI simulations that documentation pages embed.
 *
 * Every entry is captured by `bun run docs:screenshots` into `docs/assets/screenshots/<app>/<id>.png`.
 * Steps address controls by their visible label, so a renamed label makes the capture fail and points at
 * the documentation text that quotes it. `expectText` lists the labels the embedding page quotes.
 */

export type UiScreenshotStep =
	/** Click the visible, enabled control whose label or accessible name equals `click`; `nth` picks among duplicates. */
	| { readonly click: string; readonly nth?: number }
	/** Replace the value of the input labelled `fill`. */
	| { readonly fill: string; readonly value: string }
	/** Wait until the page text contains the value. */
	| { readonly waitForText: string }
	/** Wait until the page text no longer contains the value, for example a loading indicator. */
	| { readonly waitForNoText: string }
	/** Wait until the control labelled `waitForEnabled` can be clicked. */
	| { readonly waitForEnabled: string }

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
}

const openFirstMarket: readonly UiScreenshotStep[] = [{ click: 'Will this resolve?' }, { waitForText: 'Question end' }]
const initializeAtSeventyPercent: readonly UiScreenshotStep[] = [{ click: 'Create market' }, { waitForText: 'Conditional YES price' }, { fill: 'ETH amount', value: '0.01' }, { fill: 'Conditional YES price', value: '70' }, { waitForText: 'Expected to receive' }, { waitForEnabled: 'Initialize pool' }]
const travelOneYear: readonly UiScreenshotStep[] = [{ click: 'Show details' }, { click: 'QA controls, prices, and time travel' }, { click: '+1 year' }, { waitForEnabled: '+1 year' }, { click: 'Hide details' }]
// The trade panel scrolls inside the viewport, so panel shots use a taller window.
const tradePanel: UiScreenshotCrop = { selector: '.market-ticket__panel' }
const tallViewport = { width: 1440, height: 1600 }
// Page shots crop to one card or panel in a narrow window so the image stays legible when scaled to a phone-width column.
const pageViewport = { width: 800, height: 900 }

export const UI_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'markets',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [{ waitForText: 'Conditional odds' }, { waitForNoText: 'Discovering…' }],
		expectText: ['Markets', 'Conditional odds', 'TRADING OPEN'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Conditional odds' },
		usedBy: ['tutorials/trading-first-trade.html'],
	},
	{
		id: 'buy-ticket',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { fill: 'You pay', value: '0.001' }, { waitForEnabled: 'Buy YES' }],
		expectText: ['Trade', 'Buy', 'Sell', 'You pay', 'You receive ≈', 'Minimum received', 'INVALID insurance', 'Buy YES'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['tutorials/trading-first-trade.html'],
	},
	{
		id: 'sell-ticket',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { click: 'Sell' }, { waitForText: 'Shares to sell' }, { fill: 'Shares to sell', value: '0.001' }, { waitForEnabled: 'Sell YES' }],
		expectText: ['Shares to sell', 'Max', 'INVALID used', 'Minimum received', 'Sell YES'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['tutorials/trading-first-trade.html', 'how-to/trading-exit-a-position.html'],
	},
	{
		id: 'trade-settings',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [{ click: 'Settings' }, { waitForText: 'Trade settings' }],
		expectText: ['Trade settings', 'Slippage tolerance', 'Transaction valid for'],
		crop: { selector: '[role=dialog]', containing: 'Trade settings', padding: 0 },
		usedBy: ['tutorials/trading-first-trade.html'],
	},
	{
		id: 'portfolio',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: [...initializeAtSeventyPercent, { click: 'Initialize pool' }, { waitForText: 'TRADING OPEN' }, { click: 'Portfolio' }, { waitForText: 'LP' }],
		expectText: ['Portfolio', 'INVALID', 'LP'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Position details' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'create-market',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: [{ waitForText: 'Will this resolve?' }],
		expectText: ['Create new market', 'Security pools', 'Create market', 'Details'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Create market' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'security-pool-details',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: [{ click: 'Details' }, { waitForText: 'Minting capacity' }],
		expectText: ['Pool facts', 'System state', 'Minting capacity', 'Deploy trading pool'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Pool facts' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'initialize-pool',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: initializeAtSeventyPercent,
		expectText: ['PAIR NOT CREATED', 'Initialize', 'ETH amount', 'Conditional YES price', 'You provide', 'Expected to receive', 'Initialize pool'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Conditional YES price' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'remove-liquidity',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { click: 'Liquidity' }, { click: 'Remove' }, { waitForText: 'LP tokens' }, { fill: 'LP tokens', value: '0.001' }, { waitForEnabled: 'Remove liquidity' }],
		expectText: ['Remove', 'LP tokens', 'Expected to receive', 'Remove liquidity'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['how-to/trading-remove-liquidity.html'],
	},
	{
		id: 'settlement',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...travelOneYear, ...openFirstMarket, { waitForText: 'Complete-set value to redeem' }, { fill: 'Complete-set value to redeem', value: '0.001' }, { waitForEnabled: 'Redeem complete sets' }],
		expectText: ['Settlement', 'Complete set', 'Fork migration', 'Complete-set value to redeem', 'Redeem complete sets'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['how-to/trading-handle-resolution.html'],
	},
	{
		id: 'deploy-contracts',
		app: 'trading',
		scenario: 'baseline',
		route: '#/deploy',
		expectText: ['Trading contracts', 'Deployment progress', 'SECURITY POOL FACTORY IS NOT DEPLOYED', 'Deploy Trading factory'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Trading contracts' },
		usedBy: ['how-to/trading-deploy-contracts.html'],
	},
]
