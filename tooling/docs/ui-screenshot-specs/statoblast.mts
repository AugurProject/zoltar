import type { UiScreenshotSpec } from '../ui-screenshot-specs.mts'

export const STATOBLAST_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'security-pool-capital',
		app: 'statoblast',
		scenario: 'securitypoolx2',
		route: '#/watchlist',
		viewport: { width: 800, height: 900 },
		steps: [{ waitForText: 'Saved security pools' }, { click: 'Open', nth: -1 }, { waitForText: 'PRICE CURRENT' }],
		expectText: ['Your position', 'Your REP deposited', 'Your commitment', 'Health target'],
		crop: { selector: 'section', containing: 'Your REP deposited', scrollIntoView: true },
		usedBy: ['tutorials/statoblast-first-pool.html'],
	},
	{
		id: 'security-pool-purchase',
		app: 'statoblast',
		scenario: 'securitypoolx2',
		route: '#/watchlist',
		viewport: { width: 800, height: 1000 },
		steps: [{ waitForText: 'Saved questions' }, { click: 'Open' }, { waitForEnabled: 'Mint complete sets' }, { click: 'Mint complete sets' }],
		expectText: ['Mint complete sets', 'Collateral amount'],
		crop: { selector: '[role="dialog"]', containing: 'Mint complete sets', scrollIntoView: true },
		usedBy: ['tutorials/statoblast-first-pool.html'],
	},
]
