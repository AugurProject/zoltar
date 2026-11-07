import type { UiScreenshotSpec } from '../ui-screenshot-specs.mts'

export const STATOBLAST_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'portfolio-capital',
		app: 'statoblast',
		scenario: 'portfolio',
		route: '#/portfolios',
		viewport: { width: 800, height: 900 },
		steps: [{ waitForText: 'PRICE CURRENT' }],
		expectText: ['Your total principal', 'Your commitment', 'Saved health target'],
		crop: { selector: 'section', containing: 'Your total principal', scrollIntoView: true },
		usedBy: ['tutorials/statoblast-first-pool.html'],
	},
	{
		id: 'portfolio-purchase',
		app: 'statoblast',
		scenario: 'portfolio',
		route: '#/portfolios',
		viewport: { width: 800, height: 1000 },
		steps: [{ waitForText: 'PRICE CURRENT' }],
		expectText: ['Find by question ID', 'Collateral ETH', 'Maximum purchase fee ETH', 'Minimum complete sets'],
		crop: { selector: 'section', containing: 'Find by question ID', scrollIntoView: true },
		usedBy: ['tutorials/statoblast-first-pool.html'],
	},
]
