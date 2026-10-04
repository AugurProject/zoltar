import type { UiScreenshotSpec, UiScreenshotStep } from '../ui-screenshot-specs.mts'

// One journey from an empty deployment: create a question and pool, back it with REP, set an underwriting commitment
// through an OpenOracle report, and mint complete sets. Each screenshot replays the journey up to its own step.
const tutorial = ['tutorials/statoblast-first-pool.html']
const pageViewport = { width: 800, height: 900 }
// Modals scroll inside the viewport, so modal shots use a taller window.
const modalViewport = { width: 800, height: 1400 }
const fillPoolForm: readonly UiScreenshotStep[] = [{ click: 'Create pool' }, { waitForText: 'Create question and pool' }, { fill: 'Title', value: 'Will it rain in Lisbon on 1 June 2027?' }, { fill: 'End time', value: '2027-06-02T00:00' }, { waitForEnabled: 'Create question and pool' }]
const createPool: readonly UiScreenshotStep[] = [...fillPoolForm, { click: 'Create question and pool' }, { waitForText: 'Pool created' }]
const openPool: readonly UiScreenshotStep[] = [...createPool, { click: 'Open pool' }, { waitForText: 'REP deposit amount (optional)' }]
const approveRep: readonly UiScreenshotStep[] = [...openPool, { fill: 'REP deposit amount (optional)', value: '1000' }, { click: 'Review vault operations' }, { click: 'Approve 1k REP' }, { waitForEnabled: 'Submit vault operations' }]
const depositRep: readonly UiScreenshotStep[] = [...approveRep, { click: 'Submit vault operations' }, { waitForText: 'REP deposit confirmed' }, { waitForEnabled: 'Clear draft' }]
const fillCommitment: readonly UiScreenshotStep[] = [...depositRep, { fill: 'Initial report price', value: '3' }, { fill: 'Commitment limit', value: '10' }, { click: 'Review vault operations' }, { waitForEnabled: 'Approve ≈ 1.62 WETH' }]
const stageCommitment: readonly UiScreenshotStep[] = [...fillCommitment, { click: 'Approve ≈ 1.62 WETH' }, { waitForText: 'WETH approved' }, { click: 'Approve ≈ 4.85 REP' }, { waitForText: 'REP approved' }, { click: 'Submit vault operations' }, { waitForText: 'View staged operations' }]
// The report settles after eight minutes; ten keeps the staged operation inside its validity window.
const openReport: readonly UiScreenshotStep[] = [...stageCommitment, { click: 'Show details' }, { click: 'QA controls, prices, and time travel' }, { click: '+10 min' }, { waitForEnabled: '+10 min' }, { click: 'Hide details' }, { click: 'View report' }, { waitForEnabled: 'Settle report' }]
const settleAndReturn: readonly UiScreenshotStep[] = [...openReport, { click: 'Settle report' }, { waitForText: 'Report #1 settled' }, { waitForText: 'CONFIRMED' }, { back: true }, { waitForText: 'Vault operations executed' }, { waitForText: '10.00 ETH' }]

const fillMint: readonly UiScreenshotStep[] = [...settleAndReturn, { click: 'Open shares' }, { click: 'Mint complete sets', nth: -1 }, { waitForText: 'Wallet ETH' }, { fill: 'ETH to mint with', value: '1' }, { waitForEnabled: 'Mint complete sets' }]

export const STATOBLAST_SCREENSHOTS: readonly UiScreenshotSpec[] = [
	{
		id: 'create-pool',
		app: 'statoblast',
		scenario: 'deployed',
		steps: fillPoolForm,
		expectText: ['Create pool', 'Create a new question', 'Title', 'End time', 'Security multiplier', 'Initial report priority fee', 'Create question and pool'],
		viewport: pageViewport,
		crop: { selector: '.question-create-form', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'pool-created',
		app: 'statoblast',
		scenario: 'deployed',
		steps: createPool,
		expectText: ['Pool created', 'Pool address', 'Open pool'],
		viewport: pageViewport,
		crop: { selector: '.entity-card', containing: 'Pool created' },
		usedBy: tutorial,
	},
	{
		id: 'deposit-rep',
		app: 'statoblast',
		scenario: 'deployed',
		steps: approveRep,
		expectText: ['Submit vault operations', 'REP approved'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'Submit vault operations', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'set-commitment',
		app: 'statoblast',
		scenario: 'deployed',
		steps: fillCommitment,
		expectText: ['Submit vault operations'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'Submit vault operations', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'settle-report',
		app: 'statoblast',
		scenario: 'deployed',
		steps: openReport,
		expectText: ['Report #1', 'Settle report'],
		viewport: pageViewport,
		crop: { selector: '.open-oracle-report-stack', padding: 6 },
		usedBy: tutorial,
	},
	{
		id: 'vault-commitment',
		app: 'statoblast',
		scenario: 'deployed',
		steps: settleAndReturn,
		expectText: ['My vault', 'Commitment limit', '10.00 ETH', 'Vault REP backing'],
		viewport: pageViewport,
		crop: { selector: '.vault-workspace .entity-card', containing: 'My vault' },
		usedBy: tutorial,
	},
	{
		id: 'mint-complete-sets',
		app: 'statoblast',
		scenario: 'deployed',
		steps: fillMint,
		expectText: ['Wallet ETH', 'Available to mint', 'ETH to mint with', 'Mint complete sets'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'Wallet ETH', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'pool-after-mint',
		app: 'statoblast',
		scenario: 'deployed',
		steps: [...fillMint, { click: 'Mint complete sets', nth: -1 }, { waitForNoText: 'Wallet ETH' }, { waitForText: '1.00 ETH' }],
		expectText: ['Open interest / commitment', '1.00 ETH', '10.00 ETH', 'Redeemable complete sets'],
		viewport: pageViewport,
		crop: { selector: 'section', containing: 'Pool stage' },
		usedBy: tutorial,
	},
]
