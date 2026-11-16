import { isPlainRecord } from '@zoltar/core-shared/validation/guards'
import { collateralUnit } from '../src/collateral.ts'
import { exactNumber, exactUnit, percentFromBps, utcDateTime } from './format.ts'
import { shortIdentifier } from './identifier-format.ts'

// A capital position is one owner's principal and commitment in the capital ledger of one portfolio universe.

const integer = (value: unknown): string | undefined => (typeof value === 'string' && /^\d+$/.test(value) ? value : undefined)

const amount = (value: unknown, decimals: number, unit: string): string => {
	const exact = integer(value)
	return exact === undefined ? 'Unavailable' : exactUnit(exact, decimals, unit)
}

const account = (value: unknown): string | undefined => (typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) ? shortIdentifier(value, 8, 6) : undefined)

/** The chip of a ranked position list: a bounded head says so, a complete list only states its order. */
export const capitalPositionListLabel = (shown: number, total: number): string => (shown < total ? `The ${exactNumber(shown)} most at risk of ${exactNumber(total)} positions` : `${exactNumber(total)} ${total === 1 ? 'position' : 'positions'} · most at risk first`)

/** The route of one owner's capital position in one ledger. */
export const capitalPositionPath = (ledger: unknown, owner: unknown): string => `/operations/risk/capital/${encodeURIComponent(String(ledger ?? ''))}/${encodeURIComponent(String(owner ?? ''))}`

const capitalHealthText = (value: unknown): string => {
	const bps = integer(value)
	return bps === undefined ? 'No health factor' : percentFromBps(bps)
}

/** Principal, commitment and health of one position read, with the commitment in the ledger's collateral token. */
export const capitalPositionSummary = (state: Readonly<Record<string, unknown>>): string => {
	const collateral = collateralUnit(state)
	const health = integer(state['healthFactorBps'])
	return `${amount(state['principalAttoRep'], 18, 'REP')} principal · ${amount(state['commitmentAttoEth'], collateral.decimals, collateral.symbol)} commitment · ${health === undefined ? 'no health factor' : `health ${percentFromBps(health)}`}`
}

/** Read fields the detail page already shows as metric cards, in its identity, or through the protocol state. */
export const capitalSummarizedFields: ReadonlySet<string> = new Set(['principalAttoRep', 'commitmentAttoEth', 'healthFactorBps', 'withdrawableAttoRep', 'unclaimedFeesAttoEth', 'unclaimedFeesAttoRep', 'ledger', 'owner', 'belowLiquidationPrice', 'takeoverPreconditionsMet'])

/** The title and summary of an owned position's card, shared by the address profile and the rich list. */
export const capitalPositionCard = (position: { readonly universeId: string | null; readonly readStatus: string } & Readonly<Record<string, unknown>>): { readonly title: string; readonly summary: string } => ({
	title: position.universeId === null ? 'Capital position' : `Capital position · universe ${shortIdentifier(position.universeId, 9, 6)}`,
	summary: position.readStatus === 'success' ? capitalPositionSummary(position) : 'Tagged read unavailable',
})

export const capitalSummaryMetrics = (state: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, string]> => {
	const collateral = collateralUnit(state)
	return [
		['Principal', amount(state['principalAttoRep'], 18, 'REP')],
		['Commitment', amount(state['commitmentAttoEth'], collateral.decimals, collateral.symbol)],
		['Health factor', capitalHealthText(state['healthFactorBps'])],
		['Withdrawable', amount(state['withdrawableAttoRep'], 18, 'REP')],
		['Unclaimed earnings', `${amount(state['unclaimedFeesAttoEth'], collateral.decimals, collateral.symbol)} · ${amount(state['unclaimedFeesAttoRep'], 18, 'REP')}`],
	]
}

/** One universe ledger's aggregate: pledged principal, commitment and the share of it that is healthy. */
export const capitalLedgerSummary = (state: Readonly<Record<string, unknown>>, ownerCount: unknown): string => {
	const collateral = collateralUnit(state)
	const owners = integer(String(ownerCount ?? ''))
	return [
		`${amount(state['pledgedAttoRep'], 18, 'REP')} pledged`,
		`${amount(state['commitmentAttoEth'], collateral.decimals, collateral.symbol)} committed`,
		`${amount(state['healthyCommitmentAttoEth'], collateral.decimals, collateral.symbol)} healthy`,
		state['priceValid'] === true ? 'price fresh' : 'price expired',
		...(owners === undefined ? [] : [`${exactNumber(owners)} ${owners === '1' ? 'owner' : 'owners'}`]),
	].join(' · ')
}

const capitalEventTitles: Readonly<Record<string, string>> = {
	PrincipalDeposited: 'Principal deposit',
	PrincipalWithdrawn: 'Principal withdrawal',
	CommitmentAuthorized: 'Commitment authorized',
	EarningsClaimed: 'Earnings claim',
	AuctionBidMaterialized: 'Auction bid materialized',
}

/** An owner's own ledger event with REP in REP and commitment in the ledger's collateral; undefined for any other event. */
export const capitalEventPresentation = (item: Readonly<Record<string, unknown>>): { readonly title: string; readonly summary: string } | undefined => {
	const title = capitalEventTitles[String(item['event_name'] ?? '')]
	if (title === undefined) return undefined
	const data = isPlainRecord(item['event_data']) ? item['event_data'] : {}
	const collateral = collateralUnit(item)
	const commitment = (value: unknown) => amount(value, collateral.decimals, collateral.symbol)
	const summaries: Readonly<Record<string, () => string>> = {
		PrincipalDeposited: () => `${amount(data['amountAttoRep'], 18, 'REP')} from ${account(data['payer']) ?? 'unknown payer'}`,
		PrincipalWithdrawn: () => `${amount(data['amountAttoRep'], 18, 'REP')} to ${account(data['recipient']) ?? 'unknown recipient'}`,
		CommitmentAuthorized: () => `position ${integer(data['positionId']) ?? '—'} · ${amount(data['rep'], 18, 'REP')} backing ${commitment(data['commitment'])} · target health ${capitalHealthText(data['targetHealthFactorBps'])}`,
		EarningsClaimed: () => `${commitment(data['ethAmount'])} · ${amount(data['repAmount'], 18, 'REP')}`,
		AuctionBidMaterialized: () => `bid ${integer(data['bidId']) ?? '—'} became position ${integer(data['positionId']) ?? '—'} · ${amount(data['principal'], 18, 'REP')} principal · ${commitment(data['commitment'])} commitment`,
	}
	return { title, summary: summaries[String(item['event_name'])]?.() ?? title }
}

const liquidationTitles: Readonly<Record<string, string>> = {
	CommitmentTakenOver: 'Commitment take-over',
	CommitmentCured: 'Commitment cure',
	ReportOperationAttempted: 'Report operation',
}

export const liquidationTitle = (item: Readonly<Record<string, unknown>>): string => liquidationTitles[String(item['event_name'] ?? '')] ?? String(item['event_name'] ?? 'Capital event')

/**
 * A take-over, cure or report operation with the attribution the chain supports: the universe of its ledger
 * and the owners of the positions it names. None of them belongs to a single question pool.
 */
export const liquidationSummary = (item: Readonly<Record<string, unknown>>, { universe: showUniverse = true }: { readonly universe?: boolean } = {}): string => {
	const data = isPlainRecord(item['event_data']) ? item['event_data'] : {}
	const collateral = collateralUnit(item)
	const universe = integer(item['universe_id'])
	const owner = (id: unknown, address: unknown): string | undefined => {
		const position = integer(id)
		if (position === undefined) return undefined
		return `position ${position} (${account(address) ?? 'owner unresolved'})`
	}
	let parts: ReadonlyArray<string | undefined>
	switch (item['event_name']) {
		case 'CommitmentTakenOver':
			parts = [[owner(data['sourceId'], item['source_owner']), owner(data['receiverId'], item['receiver_owner'])].filter(part => part !== undefined).join(' → '), `${amount(data['commitment'], collateral.decimals, collateral.symbol)} commitment`, `${amount(data['awardAttoRep'], 18, 'REP')} award`]
			break
		case 'CommitmentCured':
			parts = [owner(data['positionId'], item['source_owner']), `${amount(data['removedCommitment'], collateral.decimals, collateral.symbol)} commitment removed`]
			break
		case 'ReportOperationAttempted':
			parts = [`report ${integer(data['reportId']) ?? '—'} operation ${integer(data['operationIndex']) ?? '—'}`, `sponsor ${account(data['sponsor']) ?? 'unknown'}`, data['success'] === true ? 'succeeded' : 'failed']
			break
		default:
			parts = []
	}
	return [...parts, universe === undefined || !showUniverse ? undefined : `universe ${shortIdentifier(universe, 9, 6)}`].filter((part): part is string => part !== undefined && part !== '').join(' · ') || 'Capital evidence unavailable'
}

/**
 * One universe's fee economics in two lines: the configured rates with what has accrued and been funded, and
 * what owners claimed, what was burned unassigned, and what is still vesting. Collateral amounts use the
 * ledger's collateral token.
 */
export const feeEconomicsSummary = (item: Readonly<Record<string, unknown>>): { readonly rates: string; readonly flows: string } => {
	const collateral = collateralUnit(item)
	const cash = (value: unknown) => amount(value, collateral.decimals, collateral.symbol)
	const fees = isPlainRecord(item['fees']) ? item['fees'] : undefined
	const rate = (value: unknown) => (integer(value) === undefined ? 'unavailable' : percentFromBps(String(value)))
	return {
		rates: fees === undefined ? 'Rates unavailable' : `${rate(fees['annualFeeBps'])} annual fee · ${rate(fees['purchaseFeeBps'])} purchase fee · ${cash(fees['vestingOutstandingAttoEth'])} vesting to owners`,
		flows: `${cash(item['accrued_atto_eth'])} annual fees accrued · ${cash(item['purchase_fees_atto_eth'])} purchase fees, ${cash(item['earnings_funded_atto_eth'])} to owners · ${cash(item['claimed_atto_eth'])} and ${amount(item['claimed_atto_rep'], 18, 'REP')} claimed · ${cash(item['burned_atto_eth'])} and ${amount(item['burned_atto_rep'], 18, 'REP')} burned unassigned`,
	}
}

/**
 * A question's linear fee stream as of `asOfSeconds`, the snapshot block's time: its yearly rate and end, that
 * its end has passed, or that it has none.
 */
export const questionFeeStreamSummary = (item: Readonly<Record<string, unknown>>, asOfSeconds: bigint | undefined): string => {
	const collateral = collateralUnit(item)
	if (integer(item['rate_atto_eth_per_second']) === '0') return 'No fee stream'
	const end = integer(item['end_timestamp'])
	const rate = `${amount(item['rate_atto_eth_per_year'], collateral.decimals, collateral.symbol)} per year`
	if (end === undefined) return rate
	const date = utcDateTime(Number(end) * 1000)
	return asOfSeconds !== undefined && BigInt(end) <= asOfSeconds ? `Ended ${date} · was ${rate}` : `${rate} · ends ${date}`
}
