import { forked, initialReportPriorityFee, operational, outcome } from '@zoltar/ui-core-shared/copy/common.js'
import * as appCopy from './app.js'
import { endSentence } from '../lib/format.js'
import { initializeLiquidityAction } from './liquidity.js'
import { marketDataUnavailable } from './marketBlockers.js'
import { tradingFee } from './tradeTicket.js'

const questionLedgerDiscoveryFailedLead = 'Question discovery failed'
const universeDiscoveryFailedLead = 'Universe discovery failed'
const unknownDiscovery = 'unknown error'

function unknownSystemState(state: number) {
	return `Unknown state ${state.toString()}`
}

function unknownQuestionOutcome(outcome: number) {
	return `Unknown outcome ${outcome.toString()}`
}

/** `blocker` is the short market status, such as `Question ended`, that rules out the first liquidity. */
function formatInitializationUnavailable(blocker: string) {
	return `${endSentence(blocker)} This market can no longer be created.`
}

function formatMarketNotCreatedDetail(feePercent: string) {
	return `This question does not have a market yet. Creating the market and adding the first liquidity happen in one transaction. Trading fee: ${feePercent}%.`
}

function formatNoLiquidityDetail(feePercent: string) {
	return `This market needs its first liquidity before trading can open. Trading fee: ${feePercent}%.`
}

function questionLedgerDetailsUnavailable(loadError: string, refreshError?: string) {
	return refreshError === undefined ? `Question details could not be loaded: ${endSentence(loadError)}` : `Question details could not be loaded: ${endSentence(loadError)} Latest retry failed: ${endSentence(refreshError)}`
}

function questionLedgerRefreshFailed(refreshError: string) {
	return `Question refresh failed; showing the last successful result: ${endSentence(refreshError)}`
}

/** The lead a route's discovery failure is reported under: the universe route discovers universes, every other live route discovers questions. */
function discoveryFailureLead(route: string) {
	return route === 'universe' ? universeDiscoveryFailedLead : questionLedgerDiscoveryFailedLead
}

/** Composes a discovery failure under its lead; a detail that already carries the lead (a redacted error) is not prefixed twice. */
function describeDiscoveryFailure(lead: string, detail?: string) {
	if (detail === undefined) return `${lead}: ${endSentence(unknownDiscovery)}`
	return endSentence(detail.startsWith(lead) ? detail : `${lead}: ${detail}`)
}

function questionLedgerDiscoveryFailed(error?: string) {
	return describeDiscoveryFailure(questionLedgerDiscoveryFailedLead, error)
}

function questionLedgerCouldNotLoad(error: string) {
	return `This question could not be loaded. Trading, liquidity, and settlement are unavailable until it loads: ${endSentence(error)}`
}

export const liveCopy = {
	questionLedgerDoesNotExist: 'Question does not exist',
	backToCreateMarket: 'Back to create market',
	openQuestionLedger: 'Open question',
	openMarket: 'Open market',
	marketDataUnavailable,
	marketNotCreated: 'Market not created',
	tradingOpen: 'Trading open',
	tradingClosed: 'Trading closed',
	universeForkedNotice: 'This universe has forked. Its markets no longer trade; settle each position from its market’s Settlement tab.',
	viewChildUniverses: 'View child universes',
	marketCreated: 'Market created and liquidity added. Your LP tokens are listed under Your position.',
	noLiquidityYet: 'No liquidity yet',
	operational,
	poolForked: 'Question forked',
	forkMigration: 'Fork migration',
	unresolvedOutcome: 'None (unresolved)',
	neverInitializedDetail: 'This market was never created, so it has no price.',
	addFirstLiquidity: initializeLiquidityAction,
	refreshingQuestionLedger: 'Refreshing question; showing the last successful result.',
	retryingQuestionLedgerDetails: 'Retrying question details…',
	retryRefresh: 'Retry refresh',
	retryQuestionLedger: 'Retry question',
	questionEnd: 'Question end',
	questionLedgerState: 'Question state',
	universeFork: 'Universe fork',
	notForked: 'Not forked',
	outcome,
	securityMultiplier: 'Security multiplier',
	initialReportPriorityFee,
	registeredVaults: 'Registered vaults',
	commitmentLimits: 'Total / fee-eligible commitment limit',
	mintingCapacity: 'Minting capacity',
	unknownDiscovery,
	loadingQuestionLedgerDetails: 'Loading question details…',
	retryDiscovery: 'Retry discovery',
	discoveringQuestionLedgers: 'Discovering questions…',
	noFavoritePools: 'No favorite questions yet',
	noFavoritePoolsDetail: 'This list only shows questions opened in this browser. Paste a question ledger address from Statoblast above to open one.',
	findQuestionLedgerGuide: 'How to find a question',
	poolAddressRequired: 'Enter a full question ledger address: 0x followed by 40 hexadecimal characters.',
	details: 'Details',
	questionLedgerFacts: 'Question facts',
	parameters: 'Question parameters',
	questionLedger: appCopy.questionLedger,
	tradingPool: 'Trading pool',
	tradingFee,
	forked,
	unknownSystemState,
	unknownQuestionOutcome,
	formatInitializationUnavailable,
	formatMarketNotCreatedDetail,
	formatNoLiquidityDetail,
	questionLedgerDetailsUnavailable,
	questionLedgerRefreshFailed,
	questionLedgerDiscoveryFailed,
	discoveryFailureLead,
	describeDiscoveryFailure,
	questionLedgerCouldNotLoad,
} as const
