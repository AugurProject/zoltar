import { readUnavailable } from './securityPool.js'

export const readTimeout = 'Price report read timed out. Try again.'
export const requirementsReadFailed = 'Unable to load price requirements.'
export const reportReadFailed = 'Unable to load the selected price report.'
export const savedReport = 'Saved report details'
const reportBaseFeeUnit = 'nanoETH/gas'
export const waitForBaseFee = 'Wait for the block base fee to fall to the report’s ceiling.'
export const formatSettlementReview = (baseFee: string | undefined, ceiling: string) =>
	`Settle the selected oracle report. The report’s base-fee ceiling is ${ceiling} ${reportBaseFeeUnit}. ${baseFee === undefined ? 'The current block base fee is unavailable.' : `The current block base fee is ${baseFee} ${reportBaseFeeUnit}.`} Price acceptance can be deferred if the fee is above the ceiling at inclusion.`

/** A fork branch reports before activation; an open security pool account reports for its own universe. */
export type SecurityPoolPriceScope = 'branch' | 'universe'
type ScopeCopy = {
	missingTarget: string
	waitForStart: string
	loading: string
	prepared: string
	prepareFirst: string
	closed: string
	walletRep: string
	insufficientRep: string
	request: string
	requesting: string
	reportLoading: string
	releasedRep: string
	formatApprovalReview: (feed: string, amount: string, token: 'weth' | 'rep', collateral: string) => string
	formatRequestReview: (weth: string, rep: string, bounty: string, collateral: string) => string
}
export const scopes: Record<SecurityPoolPriceScope, ScopeCopy> = {
	branch: {
		missingTarget: 'Select a fork branch first.',
		waitForStart: 'Start branch migration before funding its price report.',
		loading: 'Checking branch price requirements…',
		prepared: 'The branch price feed is already prepared.',
		prepareFirst: 'Start branch migration price feed first.',
		closed: 'The branch price reporting window is closed.',
		walletRep: 'Wallet branch REP',
		insufficientRep: 'Insufficient branch REP to fund the report.',
		request: 'Report branch price',
		requesting: 'Reporting branch price…',
		reportLoading: 'Loading this branch report…',
		releasedRep: 'Released branch REP',
		formatApprovalReview: (feed, amount, token, collateral) => `Allow branch price feed ${feed} to spend up to ${amount} ${token === 'weth' ? collateral : 'branch REP'} from your wallet. This sets the total allowance for reporting.`,
		formatRequestReview: (weth, rep, bounty, collateral) =>
			`Fund this branch price report with ${weth} ${collateral}, ${rep} branch REP and ${bounty} ETH bounty. Whoever settles earns the bounty as withdrawable OpenOracle credit. Disputes may change the token amounts returned to your wallet. This does not activate the branch. An accepted price can enable position fees once the branch is active.`,
	},
	universe: {
		// The universe report renders only once an account has been shown, so a missing target means it is reloading.
		missingTarget: readUnavailable,
		waitForStart: 'Before this branch activates, report its price in Fork & recovery.',
		loading: 'Checking price requirements…',
		prepared: 'This universe’s price feed is already prepared.',
		prepareFirst: 'This universe has no shared price feed.',
		closed: 'Price reporting closed when this universe forked.',
		walletRep: 'Wallet REP',
		insufficientRep: 'Insufficient REP to fund the report.',
		request: 'Report a price',
		requesting: 'Reporting a price…',
		reportLoading: 'Loading this report…',
		releasedRep: 'Released REP',
		formatApprovalReview: (feed, amount, token, collateral) => `Allow this universe’s price feed ${feed} to spend up to ${amount} ${token === 'weth' ? collateral : 'REP'} from your wallet. This sets the total allowance for reporting.`,
		formatRequestReview: (weth, rep, bounty, collateral) =>
			`Fund this REP price report with ${weth} ${collateral}, ${rep} REP and ${bounty} ETH bounty. Whoever settles earns the bounty as withdrawable OpenOracle credit. Disputes may change the token amounts returned to your wallet. An accepted price renews the shared price for this universe.`,
	},
}
export const prepare = 'Prepare price feed'
export const preparing = 'Preparing price feed…'
export const noPreparationSource = 'No registered origin question is available to prepare this feed.'
export const tooLate = 'Too little time remains to challenge and accept a new report before the preparation reporting window closes.'
export const reportingDeadline = 'Preparation reporting closes'
export const earliestSettlement = 'New report can settle from'
export const priceInvalid = 'Enter a positive REP price.'
export const wethHint = 'Leave blank to use the suggested collateral amount shown below.'
export const wethInvalid = 'Enter a nonnegative collateral amount in the token’s precision.'
export const wrapAmount = 'ETH to wrap'
export const wrap = 'Wrap ETH for report'
export const wrapping = 'Wrapping ETH…'
export const noWrap = 'Your WETH balance already covers this report.'
export const insufficientEth = 'Insufficient ETH for wrapping and the report bounty.'
export const insufficientWeth = 'Insufficient collateral to fund the report.'
export const approvalRequired = 'Approve both tokens before reporting a price.'
export const approveWeth = 'Approve collateral for report'
export const approveRep = 'Approve REP for report'
export const currentPrice = (collateral: string) => `Last accepted price (REP per ${collateral})`
export const validUntil = 'Price valid until'
export const pricePage = 'REP price'
export const priceCurrent = 'Current'
export const priceDue = 'Price due'
export const reportNewPrice = 'Report a new REP price'
export const acceptedPrice = 'Accepted REP price'
export const priceUnits = (collateral: string) => `REP per ${collateral}`
export const priceDraftLabel = (collateral: string) => `REP price (${priceUnits(collateral)})`
export const referencePrice = (reference: string) => `Last accepted: ${reference}`
export const branchReferencePrice = (reference: string) => `Last accepted in the parent: ${reference}`
export const suggestedStake = (minimum: string, suggested: string, collateral: string) => `Minimum ${minimum} ${collateral} · suggested ${suggested} ${collateral}`
export const minimumStake = (minimum: string, collateral: string) => `Minimum ${minimum} ${collateral}`
export const wrapStep = 'Wrap ETH'
export const approveStep = (symbol: string) => `Approve ${symbol}`
export const adjustAmount = 'Adjust amount'
export const preparedStep = 'Prepared'
export const stepComplete = 'Completed'
export const recoverStep = 'Recover'
export const settleReportStep = (id: bigint) => `Settle report #${id}`
export const settleEarns = <Amount>(amount: Amount) => ['Anyone can settle and earn ', amount, '.']
export const now = 'Now'
export const fundsRecipient = 'To the funder'
export const howReportWorks = 'How a price report works'
export const disputeTip = 'Disputers can trade against your quote. You may get back a different mix of tokens.'
export const coverageTip = 'You fund a two-sided quote at your price. A report that covers less than the pool’s exposure is rejected.'
export const coverLabel = 'This report covers'
export const exposureNow = 'Exposure now'
export const extraCoverage = 'Extra coverage'
export const bountyPaidByYou = 'Settle bounty, paid by you'
export const deviationLabel = (percent: string) => `±${percent}%`
export const latestReportHint = 'Enter an older ID to return its funds.'
export const asOf = (age: string) => `as of ${age} ago`
export const currentReport = 'Current report'
export const releasedToken = (symbol: string) => `Released ${symbol}`
export const reportHeading = (id: bigint) => `Report #${id}`
export const reportedStep = 'Reported'
export const disputeStep = 'Dispute window'
export const settleStep = 'Settle'
export const fundsReturnedStep = 'Funds returned'
export const olderReports = 'Older reports and exceptions'
export const openOracleReport = 'Open it in OpenOracle ↗'
export const liquidationsUse = 'Liquidations use'
export const acceptedStep = 'Accepted'
export const healthUses = 'Health uses'
export const reportId = 'Report ID'
export const reportInvalid = 'Enter a positive report ID.'
export const noReport = 'No report selected.'
export const states = { pending: 'Dispute window open', settle: 'Ready to settle', accepted: 'Accepted', rejected: 'Settled without an accepted price', recovery: 'Settled · recovery available' }
export const sponsor = 'Return funds to'
export const settle = 'Settle price report'
export const settling = 'Settling price report…'
export const waitForSettlement = 'Wait until the report dispute window ends.'
export const alreadySettled = 'This report is already settled.'
export const recover = 'Recover settled report'
export const recovering = 'Recovering settled report…'
export const notSettled = 'Settle the report first.'
export const callbackComplete = 'This report is already recovered.'
export const withdraw = 'Return released funding'
export const withdrawing = 'Returning released funding…'
export const noFunding = 'No released report funding is waiting to be returned.'
export const withdrawToken = (symbol: string) => `Return released ${symbol}`
export const withdrawingToken = (symbol: string) => `Returning released ${symbol}…`
export const withdrawalRecipient = 'Single-token recipient'
export const withdrawalRecipientHint = 'Leave blank to return funds to the original funder.'
export const invalidWithdrawalRecipient = 'Enter a valid recipient address other than the report funding address.'
export const withdrawalRecipientRequiresFunder = 'Only the original funder can send funds to a different address.'
export const reportFunderChanged = 'The report funder changed. Refresh and review it again.'
export const tokenWithdrawalReview = (symbol: string, recipient: string) => `Send released ${symbol} to ${recipient}.`
export const formatInvertedPriceWarning = (reference: string, collateral: string) => `This looks inverted (${collateral} per REP). Enter REP per ${collateral}; the last accepted price is ${reference}\u00a0REP per ${collateral}.`
export const formatPriceAboveReferenceWarning = (reference: string, collateral: string) => `More than double the last accepted price of ${reference}\u00a0REP per ${collateral}. Check the price before sending.`
export const formatPriceBelowReferenceWarning = (reference: string, collateral: string) => `Less than half the last accepted price of ${reference}\u00a0REP per ${collateral}. Check the price before sending.`

export const deviation = 'Deviation'
export const formatDeviation = (percent: string) => `${percent}%`
export const returnFunds = 'Return funds'

export const invalidReportFunding = 'Invalid report funding.'
export const wrappingUnavailable = 'Wrapping does not apply to this collateral.'
export const priceEnvironmentChanged = 'Price feed or wallet environment changed. Review again.'
export const priceIdentityChanged = 'Price feed identities changed. Review again.'
export const fundingChanged = 'Report funding changed. Review the updated amounts before trying again.'
export const reportChanged = 'This report changed. Refresh and review it again.'
export const wrapFundingChanged = 'Wallet funding changed. Refresh before wrapping ETH.'
export const insufficientReportFunding = 'Wallet report funding is insufficient.'
export const reportNotReady = 'This report is not ready to settle.'
