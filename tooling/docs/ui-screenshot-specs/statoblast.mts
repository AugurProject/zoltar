import type { UiScreenshotSpec, UiScreenshotStep } from '../ui-screenshot-specs.mts'

// One journey from an empty deployment: create a question and pool, back it with REP, set an underwriting commitment
// through an OpenOracle report, and mint complete sets. Each screenshot replays the journey up to its own step.
const tutorial = ['tutorials/statoblast-first-pool.html']
const pageViewport = { width: 800, height: 900 }
// Modals scroll inside the viewport, so modal shots use a taller window.
const modalViewport = { width: 800, height: 1400 }
const fillPoolForm: readonly UiScreenshotStep[] = [{ click: 'Create pool' }, { waitForText: 'Create question and pool' }, { fill: 'Title', value: 'Will it rain in Lisbon on 1 June 2027?' }, { fill: 'End time', value: '2027-06-02T00:00' }, { waitForEnabled: 'Create question and pool' }]
const createPool: readonly UiScreenshotStep[] = [...fillPoolForm, { click: 'Create question and pool' }, { waitForText: 'Pool created' }]
const openPool: readonly UiScreenshotStep[] = [...createPool, { click: 'Open pool' }, { waitForText: 'Vault actions' }]
const approveRep: readonly UiScreenshotStep[] = [...openPool, { click: 'Deposit REP' }, { fill: 'REP backing', value: '1000' }, { click: 'Approve 1k REP' }, { waitForNoText: 'Approve 1k REP' }, { waitForNoText: 'Approving REP' }, { waitForNoText: 'Loading' }]
const depositRep: readonly UiScreenshotStep[] = [...approveRep, { click: 'Deposit REP', nth: -1 }, { waitForText: 'Vault REP backing' }]
const fillCommitment: readonly UiScreenshotStep[] = [...depositRep, { click: 'Set commitment limit' }, { fill: 'Open Oracle REP per ETH starting price', value: '3' }, { fill: 'Commitment limit', value: '10' }, { waitForText: 'Resulting commitment' }]
const stageCommitment: readonly UiScreenshotStep[] = [...fillCommitment, { click: 'Set commitment limit', nth: -1 }, { waitForText: 'View in staged operations' }]
// The report settles after eight minutes; ten keeps the staged operation inside its validity window.
const openReport: readonly UiScreenshotStep[] = [...stageCommitment, { click: 'Show details' }, { click: 'QA controls, prices, and time travel' }, { click: '+10 min' }, { waitForEnabled: '+10 min' }, { click: 'Hide details' }, { click: 'View report' }, { waitForText: 'Ready to settle' }]
const settleAndReturn: readonly UiScreenshotStep[] = [...openReport, { click: 'Settle report' }, { waitForText: 'Settled report' }, { back: true }, { waitForText: 'Commitment limit changed' }, { click: 'Pool address / refresh' }, { click: 'Refresh pool' }, { waitForText: '10.00 ETH' }]

const fillMint: readonly UiScreenshotStep[] = [...settleAndReturn, { click: 'Open shares' }, { click: 'Mint complete sets', nth: -1 }, { waitForText: 'Wallet ETH' }, { fill: 'Mint complete sets amount', value: '1' }, { waitForEnabled: 'Mint complete sets' }]

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
		expectText: ['REP backing', 'Required REP', 'Approved REP', 'Deposit REP'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'REP backing', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'set-commitment',
		app: 'statoblast',
		scenario: 'deployed',
		steps: fillCommitment,
		expectText: ['Open Oracle REP per ETH starting price', 'Fetch from Uniswap', 'Commitment limit', 'Resulting commitment', 'Queues for execution after oracle settlement.'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'Resulting commitment', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'settle-report',
		app: 'statoblast',
		scenario: 'deployed',
		steps: openReport,
		expectText: ['Ready to settle', 'Settle report'],
		viewport: pageViewport,
		crop: { selector: '.open-oracle-report-stack', padding: 6 },
		usedBy: tutorial,
	},
	{
		id: 'vault-commitment',
		app: 'statoblast',
		scenario: 'deployed',
		steps: settleAndReturn,
		expectText: ['My vault', 'Commitment limit', '10.00 ETH', 'Commitment limit changed', 'EXECUTED'],
		viewport: pageViewport,
		crop: { selector: '[role=tabpanel]', containing: 'Commitment limit changed' },
		usedBy: tutorial,
	},
	{
		id: 'mint-complete-sets',
		app: 'statoblast',
		scenario: 'deployed',
		steps: fillMint,
		expectText: ['Wallet ETH', 'Available to mint', 'Mint complete sets amount', 'Mint complete sets'],
		viewport: modalViewport,
		crop: { selector: '[role=dialog]', containing: 'Wallet ETH', padding: 0 },
		usedBy: tutorial,
	},
	{
		id: 'pool-after-mint',
		app: 'statoblast',
		scenario: 'deployed',
		steps: [...fillMint, { click: 'Mint complete sets', nth: -1 }, { waitForNoText: 'Wallet ETH' }, { waitForText: '1.00 ETH' }],
		expectText: ['Collateral in use / capacity', '1.00 ETH', '10.00 ETH', 'Redeemable complete sets'],
		viewport: pageViewport,
		crop: { selector: 'section', containing: 'Pool stage' },
		usedBy: tutorial,
	},
]
