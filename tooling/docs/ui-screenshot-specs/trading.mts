import type { UiScreenshotCrop, UiScreenshotSpec, UiScreenshotStep } from '../ui-screenshot-specs.mts'

// This seeded pool address is deterministic in the deployed and trading-funded fixtures.
const seededPool = '0x5e4EDB416494DbB62DD8C76E849aDee8e3c44d49'
const openSeededPool: readonly UiScreenshotStep[] = [{ fill: 'Search markets', value: seededPool }, { click: 'Open security pool' }, { waitForText: 'Question end' }]
const openFirstMarket: readonly UiScreenshotStep[] = openSeededPool
const openSeededPoolForCreation: readonly UiScreenshotStep[] = [{ fill: 'Search security pools', value: seededPool }, { click: 'Open security pool' }, { waitForText: 'Question end' }]
const initializeAtSeventyPercent: readonly UiScreenshotStep[] = [...openSeededPoolForCreation, { waitForText: 'Conditional Yes price' }, { fill: 'Amount', value: '0.01' }, { fill: 'Conditional Yes price', value: '70' }, { waitForText: 'You receive ≈' }, { waitForEnabled: 'Create market and add liquidity' }]
const travelOneYear: readonly UiScreenshotStep[] = [{ click: 'Show details' }, { click: 'QA controls, prices, and time travel' }, { click: '+1 year' }, { waitForEnabled: '+1 year' }, { click: 'Hide details' }]
// The trade panel scrolls inside the viewport, so panel shots use a taller window.
const tradePanel: UiScreenshotCrop = { selector: '.market-ticket__panel' }
const tallViewport = { width: 1440, height: 1600 }
// Page shots crop to one card or panel in a narrow window so the image stays legible when scaled to a phone-width column.
const pageViewport = { width: 800, height: 900 }

export const TRADING_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'markets',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openSeededPool, { click: '← All markets' }, { waitForText: 'Conditional price' }],
		expectText: ['Markets', 'Conditional price', 'TRADING OPEN'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Conditional price' },
		usedBy: ['tutorials/trading-first-trade.html'],
	},
	{
		id: 'buy-ticket',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { fill: 'You pay', value: '0.001' }, { waitForEnabled: 'Buy Yes' }],
		expectText: ['Trade', 'Buy', 'Sell', 'You pay', 'You receive ≈', 'Average price', 'Profit if the question resolves Yes', 'Minimum received', 'Trade details', 'Buy Yes'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['tutorials/trading-first-trade.html'],
	},
	{
		id: 'sell-ticket',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { click: 'Sell' }, { waitForText: 'Shares to sell' }, { fill: 'Shares to sell', value: '0.001' }, { waitForEnabled: 'Sell Yes' }],
		expectText: ['Shares to sell', 'Max', 'Average price', 'Invalid used', 'Minimum received', 'Sell Yes'],
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
		steps: [...initializeAtSeventyPercent, { click: 'Create market and add liquidity' }, { waitForText: 'TRADING OPEN' }, { click: 'Portfolio' }, { waitForText: 'LP' }],
		expectText: ['Portfolio', 'Invalid', 'LP'],
		viewport: pageViewport,
		crop: { selector: '.portfolio-positions', padding: 0 },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'create-market',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: [...openSeededPoolForCreation, { click: 'Create', nth: -1 }, { waitForText: 'Will this resolve?' }],
		expectText: ['Create market', 'Favorites', 'Details'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Create market' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'security-pool-details',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: [...openSeededPoolForCreation, { click: 'Create', nth: -1 }, { click: 'Details' }, { waitForText: 'Minting capacity' }],
		expectText: ['Security pool facts', 'Security pool state', 'Minting capacity', 'Create market'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Security pool facts', padding: 6 },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'initialize-pool',
		app: 'trading',
		scenario: 'deployed',
		route: '#/create-market',
		steps: initializeAtSeventyPercent,
		expectText: ['MARKET NOT CREATED', 'Create market', 'Amount', 'Conditional Yes price', 'You provide', 'You receive ≈', 'Create market and add liquidity'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Conditional Yes price' },
		usedBy: ['tutorials/trading-first-market.html'],
	},
	{
		id: 'remove-liquidity',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...openFirstMarket, { click: 'Liquidity' }, { click: 'Remove' }, { waitForText: 'Amount' }, { fill: 'Amount', value: '0.001' }, { waitForEnabled: 'Remove liquidity' }],
		expectText: ['Remove', 'Amount', 'You receive ≈', 'Remove liquidity'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['how-to/trading-remove-liquidity.html'],
	},
	{
		id: 'settlement',
		app: 'trading',
		scenario: 'trading-funded',
		steps: [...travelOneYear, ...openFirstMarket, { waitForText: 'Complete-set value to redeem' }, { fill: 'Complete-set value to redeem', value: '0.001' }, { waitForEnabled: 'Redeem complete sets' }],
		expectText: ['Settlement', 'Redeem sets', 'Migrate', 'Complete-set value to redeem', 'Redeem complete sets'],
		viewport: tallViewport,
		crop: tradePanel,
		usedBy: ['how-to/trading-handle-resolution.html'],
	},
	{
		id: 'deploy-contracts',
		app: 'trading',
		scenario: 'baseline',
		route: '#/deploy',
		expectText: ['Trading contracts', 'Deployment progress', 'SECURITY POOL FACTORY IS NOT DEPLOYED', 'Deploy trading factory'],
		viewport: pageViewport,
		crop: { selector: '.section-block', containing: 'Trading contracts', padding: 6 },
		usedBy: ['how-to/trading-deploy-contracts.html'],
	},
]
