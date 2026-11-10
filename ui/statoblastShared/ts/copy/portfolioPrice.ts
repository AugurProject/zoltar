import { readUnavailable } from './portfolio.js'

/** A fork branch reports before activation; an open portfolio account reports for its own universe. */
export type PortfolioPriceScope = 'branch' | 'universe'
type ScopeCopy = {
	title: string
	description: string
	missingTarget: string
	waitForStart: string
	loading: string
	prepared: string
	prepareFirst: string
	closed: string
	requiredRep: string
	walletRep: string
	insufficientRep: string
	request: string
	requesting: string
	requestWarning: string
	reportLoading: string
	releasedRep: string
	formatApprovalReview: (feed: string, amount: string, token: 'weth' | 'rep') => string
	formatRequestReview: (weth: string, rep: string, bounty: string) => string
}
export const scopes: Record<PortfolioPriceScope, ScopeCopy> = {
	branch: {
		title: 'Branch price report',
		description: 'Fund a challenged REP price for this branch. Reports accepted before branch activation do not start provider fees.',
		missingTarget: 'Select a fork branch first.',
		waitForStart: 'Prepare the branch before funding its price report.',
		loading: 'Checking branch price requirements…',
		prepared: 'The branch price feed is already prepared.',
		prepareFirst: 'Prepare the branch price feed first.',
		closed: 'The branch price reporting window is closed.',
		requiredRep: 'Branch REP funding',
		walletRep: 'Wallet branch REP',
		insufficientRep: 'Insufficient branch REP to fund the report.',
		request: 'Request branch price',
		requesting: 'Requesting branch price…',
		requestWarning: 'Your WETH and branch REP fund a two-sided oracle quote. Disputes can trade against that quote; the returned token amounts can change. Disputes may delay settlement beyond the reporting window. Pool collateral does not fund this report.',
		reportLoading: 'Loading this branch report…',
		releasedRep: 'Released branch REP',
		formatApprovalReview: (feed, amount, token) => `Allow branch price feed ${feed} to spend up to ${amount} ${token === 'weth' ? 'WETH' : 'branch REP'} from your wallet. This sets the total allowance; it does not request a price report.`,
		formatRequestReview: (weth, rep, bounty) => `Fund this branch price report with ${weth} WETH, ${rep} branch REP and ${bounty} ETH bounty. Disputes may change the token amounts returned to your wallet. This does not activate the branch. Accepted prices can enable provider fees once the branch is active.`,
	},
	universe: {
		title: 'Shared REP price',
		description: 'Any wallet can fund a report; an accepted one renews this universe’s shared REP price.',
		// The universe report renders only once an account has been shown, so a missing target means it is reloading.
		missingTarget: readUnavailable,
		waitForStart: 'Until this branch activates, fund its price report under Fork choices and recovery.',
		loading: 'Checking price requirements…',
		prepared: 'This universe’s price feed is already prepared.',
		prepareFirst: 'This universe has no shared price feed.',
		closed: 'Price reporting closed when this universe forked.',
		requiredRep: 'REP funding',
		walletRep: 'Wallet REP',
		insufficientRep: 'Insufficient REP to fund the report.',
		request: 'Request REP price',
		requesting: 'Requesting REP price…',
		requestWarning: 'Your WETH and REP fund a two-sided oracle quote. Disputes can trade against that quote; the returned token amounts can change. Pool collateral does not fund this report.',
		reportLoading: 'Loading this report…',
		releasedRep: 'Released REP',
		formatApprovalReview: (feed, amount, token) => `Allow this universe’s price feed ${feed} to spend up to ${amount} ${token === 'weth' ? 'WETH' : 'REP'} from your wallet. This sets the total allowance; it does not request a price report.`,
		formatRequestReview: (weth, rep, bounty) => `Fund this REP price report with ${weth} WETH, ${rep} REP and ${bounty} ETH bounty. Disputes may change the token amounts returned to your wallet. An accepted price renews the shared price for this universe.`,
	},
}
export const universeReportSummary = 'REP price report'
export const prepare = 'Prepare price feed'
export const preparing = 'Preparing price feed…'
export const noPreparationSource = 'No registered origin question is available to prepare this feed.'
export const tooLate = 'Too little time remains to challenge and accept a new report before the preparation reporting window closes.'
export const reportingDeadline = 'Preparation reporting closes'
export const earliestSettlement = 'New report can settle from'
export const price = 'Proposed price (REP per ETH)'
export const priceInvalid = 'Enter a positive REP per ETH price.'
export const weth = 'Initial WETH funding'
export const wethHint = 'Leave blank to use the current minimum. A larger amount can support more exposure.'
export const wethInvalid = 'Enter a nonnegative WETH amount with up to 18 decimal places.'
export const minimumWeth = 'Minimum WETH funding'
export const bounty = 'Settlement bounty'
export const walletWeth = 'Wallet WETH'
export const wrapAmount = 'ETH to wrap'
export const wrap = 'Wrap ETH for report'
export const wrapping = 'Wrapping ETH…'
export const noWrap = 'Your WETH balance already covers this report.'
export const insufficientEth = 'Insufficient ETH for wrapping and the report bounty.'
export const insufficientWeth = 'Wrap the required ETH before requesting the report.'
export const approvalRequired = 'Approve both report tokens before requesting the report.'
export const approveWeth = 'Approve WETH for report'
export const approveRep = 'Approve REP for report'
export const approving = 'Approving report funding…'
export const currentPrice = 'Last accepted price (REP per ETH)'
export const validUntil = 'Price valid until'
export const reportId = 'Report ID'
export const reportHint = 'Leave blank to follow the latest report, or enter an older report ID to recover its funding.'
export const reportInvalid = 'Enter a positive report ID.'
export const noReport = 'No report selected.'
export const reportState = 'Report state'
export const states = { pending: 'Challenge period', settle: 'Ready to settle', accepted: 'Accepted', rejected: 'Settled without an accepted price', recovery: 'Settled; callback recovery available' }
export const settleAt = 'Settlement available from'
export const sponsor = 'Funding recipient'
export const releasedWeth = 'Released WETH'
export const settle = 'Settle price report'
export const settling = 'Settling price report…'
export const waitForSettlement = 'Wait until the report challenge period ends.'
export const alreadySettled = 'This report is already settled.'
export const recover = 'Recover settled report'
export const recovering = 'Recovering settled report…'
export const notSettled = 'Settle the report first.'
export const callbackComplete = 'This report callback is already complete.'
export const withdraw = 'Return released funding'
export const withdrawing = 'Returning released funding…'
export const noFunding = 'No released report funding is waiting to be returned.'
export const fundingReturnHint = 'Released funding always returns to this report’s original sponsor. Settlement and recovery remain available after the reporting window closes.'
export const refresh = 'Refresh report status'
export const refreshing = 'Refreshing report status…'
export const busy = 'Wait for the current transaction.'
export const formatInvertedPriceWarning = (reference: string) => `This looks inverted (ETH per REP). Enter REP per ETH; the last accepted price is ${reference} REP per ETH.`
export const formatPriceAboveReferenceWarning = (reference: string) => `More than double the last accepted price of ${reference} REP per ETH. Check the price before sending.`
export const formatPriceBelowReferenceWarning = (reference: string) => `Less than half the last accepted price of ${reference} REP per ETH. Check the price before sending.`
