import { expect, test } from 'bun:test'
import { capitalEventPresentation, capitalLedgerSummary, capitalPositionListLabel, feeEconomicsSummary, questionFeeStreamSummary, capitalPositionPath, capitalPositionSummary, capitalSummaryMetrics, liquidationSummary, liquidationTitle } from '../../browser/capital-presentation.ts'
import { operationsDetailHeaderPresentation, operationsDetailSummaryPresentation, operationsRiskPresentation } from '../../browser/operations-presentation.ts'
import { parseOperationsDetailRoute, canonicalOperationsPath, classifyRoute, routeDataContext, routeTitle } from '../../browser/routes.ts'
import { semanticFields } from '../../browser/semantic-evidence.ts'

const ledger = `0x${'1'.repeat(40)}`
const alice = `0x${'a'.repeat(40)}`
const bob = `0x${'b'.repeat(40)}`
const usdc = { symbol: 'USDC', decimals: 6 }

test('summarizes a position with REP principal and commitment in the ledger collateral', () => {
	const state = { principalAttoRep: (475n * 10n ** 18n).toString(), commitmentAttoEth: '50000000', healthFactorBps: '9500', withdrawableAttoRep: '0', unclaimedFeesAttoEth: '1500000', unclaimedFeesAttoRep: (2n * 10n ** 18n).toString(), collateral: usdc }
	expect(capitalPositionSummary(state)).toBe('475 REP principal · 50 USDC commitment · health 95%')
	expect(capitalSummaryMetrics(state)).toEqual([
		['Principal', '475 REP'],
		['Commitment', '50 USDC'],
		['Health factor', '95%'],
		['Withdrawable', '0 REP'],
		['Credited fees awaiting claim', '1.5 USDC · 2 REP'],
	])
	// Without collateral metadata the commitment stays in explicit base units instead of borrowing ETH decimals.
	expect(capitalPositionSummary({ principalAttoRep: '0', commitmentAttoEth: '7' })).toBe('0 REP principal · 7 collateral units commitment · no health factor')
	expect(capitalSummaryMetrics({ healthFactorBps: '12550' })[2]).toEqual(['Health factor', '125.5%'])
	expect(capitalSummaryMetrics({})[2]).toEqual(['Health factor', 'No health factor'])
})

test('summarizes a ledger and says whether its price is fresh', () => {
	const state = { pledgedAttoRep: (1_470n * 10n ** 18n).toString(), commitmentAttoEth: '150000000', healthyCommitmentAttoEth: '100000000', acceptedPrice: (200n * 10n ** 30n).toString(), priceValid: false, collateral: usdc }
	expect(capitalLedgerSummary(state, 4)).toBe('1,470 REP pledged · 150 USDC committed · 100 USDC healthy · 200 REP/USDC · price expired · 4 owners')
	expect(capitalLedgerSummary({ ...state, acceptedPrice: '1', collateral: { symbol: 'TKN', decimals: 38 } }, 4)).toContain('100 REP/TKN')
	expect(capitalLedgerSummary({ ...state, priceValid: true }, '1')).toBe('1,470 REP pledged · 150 USDC committed · 100 USDC healthy · 200 REP/USDC · price fresh · 1 owner')
})

test('attributes take-overs, cures and report operations to owners and a universe', () => {
	const takeover = { event_name: 'CommitmentTakenOver', event_data: { sourceId: '1', receiverId: '2', commitment: '40000000', takeoverRewardAttoRep: (25n * 10n ** 18n).toString() }, source_owner: alice, receiver_owner: bob, universe_id: '0', collateral: usdc }
	expect(liquidationTitle(takeover)).toBe('Commitment take-over')
	expect(liquidationSummary(takeover)).toBe('position 1 (0xaaaaaa…aaaaaa) → position 2 (0xbbbbbb…bbbbbb) · 40 USDC commitment · 25 REP takeover reward · universe 0')
	expect(liquidationSummary(takeover, { universe: false })).toBe('position 1 (0xaaaaaa…aaaaaa) → position 2 (0xbbbbbb…bbbbbb) · 40 USDC commitment · 25 REP takeover reward')
	expect(capitalPositionListLabel(100, 240)).toBe('The 100 most at risk of 240 positions')
	expect(capitalPositionListLabel(3, 3)).toBe('3 positions · most at risk first')
	expect(capitalPositionListLabel(1, 1)).toBe('1 position · most at risk first')
	// An id whose owner no event or ledger read has supplied is stated as unresolved, never guessed.
	expect(liquidationSummary({ ...takeover, receiver_owner: null })).toContain('position 2 (owner unresolved)')
	expect(liquidationSummary({ event_name: 'CommitmentCured', event_data: { positionId: '1', removedCommitment: '10000000' }, source_owner: alice, universe_id: '0', collateral: usdc })).toBe('position 1 (0xaaaaaa…aaaaaa) · 10 USDC commitment removed · universe 0')
	const operation = { event_name: 'ReportOperationAttempted', event_data: { reportId: '7', sponsor: bob, operationIndex: '0', success: true }, universe_id: '0' }
	expect(liquidationTitle(operation)).toBe('Report operation')
	expect(liquidationSummary(operation)).toBe('report 7 operation 0 · sponsor 0xbbbbbb…bbbbbb · succeeded · universe 0')
	expect(liquidationSummary({ ...operation, event_data: { ...operation.event_data, success: false }, universe_id: null })).toBe('report 7 operation 0 · sponsor 0xbbbbbb…bbbbbb · failed')
	// A ledger that has not been read yet has no collateral metadata or universe.
	expect(liquidationSummary({ event_name: 'CommitmentCured', event_data: { positionId: '5', removedCommitment: '1' } })).toBe('position 5 (owner unresolved) · 1 collateral units commitment removed')
	expect(liquidationSummary({ event_name: 'Unknown' })).toBe('Capital evidence unavailable')
})

test("presents an owner's ledger events in REP and the ledger collateral", () => {
	const at = (event_name: string, event_data: Record<string, unknown>) => capitalEventPresentation({ event_name, event_data, collateral: usdc })
	expect(at('PrincipalDeposited', { payer: alice, owner: alice, amountAttoRep: (5n * 10n ** 18n).toString() })).toEqual({ title: 'Principal deposit', summary: '5 REP from 0xaaaaaa…aaaaaa' })
	expect(at('PrincipalWithdrawn', { owner: alice, recipient: bob, amountAttoRep: (5n * 10n ** 18n).toString() })).toEqual({ title: 'Principal withdrawal', summary: '5 REP to 0xbbbbbb…bbbbbb' })
	expect(at('CommitmentAuthorized', { owner: alice, positionId: '7', rep: (5n * 10n ** 18n).toString(), commitment: '100000000', targetHealthFactorBps: '12000' })?.summary).toBe('position 7 · 5 REP backing 100 USDC · target health 120%')
	expect(at('EarningsClaimed', { owner: alice, ethAmount: '1500000', repAmount: '0' })?.summary).toBe('1.5 USDC · 0 REP')
	expect(at('RepairAuctionBidMaterialized', { bidId: '4', vault: alice, positionId: '3', principal: (70n * 10n ** 18n).toString(), commitment: '10000000' })?.summary).toBe('bid 4 became position 3 · 70 REP principal · 10 USDC commitment')
	expect(at('CommitmentTakenOver', {})).toBeUndefined()
})

test('summarizes cash fee economics and question stream status', () => {
	const universe = {
		collateral: usdc,
		fees: { annualFeeBps: '200', purchaseFeeBps: '30', vestingOutstandingAttoEth: '700000000' },
		accrued_atto_eth: '1250000000',
		purchase_fees_atto_eth: '960000000',
		earnings_funded_atto_eth: '900000000',
		claimed_atto_eth: '1100000000',
		claimed_atto_rep: (12n * 10n ** 18n).toString(),
		burned_atto_eth: '25000000',
		burned_atto_rep: '0',
	}
	expect(feeEconomicsSummary(universe)).toEqual({
		rates: '2% annual holding fee · 0.3% base purchase fee · 700 USDC unreleased owner fees',
		flows: '1,250 USDC holding fees accrued · 960 USDC purchase charges, 900 USDC to owners · 1,100 USDC and 12 REP claimed · 25 USDC and 0 REP burned by the capital ledger',
	})
	expect(feeEconomicsSummary({ ...universe, fees: { ...universe.fees, vestingOutstandingAttoEth: '0' } }).rates).toContain('0 USDC unreleased owner fees')
	// Without a fee read the rates are not guessed; the event totals remain.
	expect(feeEconomicsSummary({ ...universe, fees: undefined, fee_read_error: 'execution reverted' }).rates).toBe('Rates unavailable')
	// Totals that have no source are stated as unavailable, never as zero.
	expect(feeEconomicsSummary({ ...universe, accrued_atto_eth: null, earnings_funded_atto_eth: undefined }).flows).toBe('Unavailable holding fees accrued · 960 USDC purchase charges, Unavailable to owners · 1,100 USDC and 12 REP claimed · 25 USDC and 0 REP burned by the capital ledger')
	const stream = { collateral: usdc, rate_claim_units_per_second: '203', rate_claim_units_per_year: '6401808000', end_timestamp: '1893456000' }
	expect(questionFeeStreamSummary({ ...stream, book_fees_enabled: false }, 1_800_000_000n)).toBe('Scheduled fee stream · ends 2030-01-01 00:00:00 UTC')
	// At or after its end the stream no longer accrues, although its last rate is non-zero.
	expect(questionFeeStreamSummary(stream, 1_893_456_000n)).toBe('Ended 2030-01-01 00:00:00 UTC')
	expect(questionFeeStreamSummary(stream, undefined)).toBe('Scheduled fee stream · ends 2030-01-01 00:00:00 UTC')
	expect(questionFeeStreamSummary({ rate_claim_units_per_second: '1' }, undefined)).toBe('Scheduled fee stream')
	expect(questionFeeStreamSummary({}, undefined)).toBe('Fee stream unavailable')
	expect(questionFeeStreamSummary({ collateral: usdc, rate_claim_units_per_second: '0', rate_claim_units_per_year: '0', end_timestamp: '0' }, 1n)).toBe('No fee stream')
})

test('question streams do not invent cash rates from indexed claim units', () => {
	// A book can have ten raw collateral units per claim unit. The event alone lacks that index.
	const stream = { collateral: usdc, claim_unit_scale: '1000000000', rate_claim_units_per_second: '1000000000000', rate_claim_units_per_year: '31536000000000000000', end_timestamp: '1893456000' }
	expect(questionFeeStreamSummary(stream, 1_800_000_000n)).toBe('Scheduled fee stream · ends 2030-01-01 00:00:00 UTC')
})

test('capital position routes parse, canonicalize and keep their snapshot block', () => {
	expect(capitalPositionPath(ledger, alice)).toBe(`/operations/risk/capital/${ledger}/${alice}`)
	expect(parseOperationsDetailRoute(`/operations/risk/capital/${ledger}/${alice}`)).toEqual({ kind: 'capital', identity: [ledger, alice] })
	expect(parseOperationsDetailRoute(`/capital/${ledger}/${alice}`)).toEqual({ kind: 'capital', identity: [ledger, alice] })
	expect(parseOperationsDetailRoute(`/capital/${ledger}`)).toBeUndefined()
	expect(canonicalOperationsPath(`/operations/risk/capital/${ledger}/${alice}`)).toBe(`/capital/${ledger}/${alice}`)
	expect(classifyRoute(`/capital/${ledger}/${alice}`)).toBe('operations')
	expect(routeTitle(`/capital/${ledger}/${alice}`)).toBe('Capital 0xaaaaaaaaaa…aaaaaaaa · augurScan')
	expect(routeDataContext('1', new URL(`https://scanner.test/capital/${ledger}/${alice}?atBlock=9&tab=history`))).toBe(`1:/capital/${ledger}/${alice}?atBlock=9`)
})

test('capital detail uses the risk catalog, protocol state labels and readable ledger prices', () => {
	expect(operationsDetailHeaderPresentation('capital', { blockNumber: '1', lagBlocks: '0' }, true).catalogPath).toBe('/operations/risk')
	expect(operationsDetailSummaryPresentation('capital', { protocolState: 'takeover-preconditions-met', scannerSeverity: 'critical' })).toEqual({ label: 'Protocol state', value: 'Take-over preconditions met' })
	for (const [state, label] of [
		['healthy', 'Healthy'],
		['uncommitted', 'No commitment'],
		['under-collateralized', 'Below liquidation price'],
		['frozen', 'Frozen by fork'],
	] as const)
		expect(operationsRiskPresentation(state, 'healthy').protocolState).toBe(label)
	const fields = Object.fromEntries(
		semanticFields({ liquidationPrice: (190n * 10n ** 30n).toString(), maxHealthyPrice: (2n ** 256n - 1n).toString(), liquidationStartedAt: '0', priceValidUntil: '1767225600', healthFactorBps: '9500', principalAttoRep: (475n * 10n ** 18n).toString(), commitmentAttoEth: '50000000', collateral: usdc }, 'ETH'),
	)
	expect(fields).toMatchObject({
		// 36 - 6 collateral decimals: attoREP per whole USDC scaled by 1e18.
		'Liquidation Price': '190 REP/USDC',
		'Max Healthy Price': 'No limit',
		'Liquidation Started At': 'Not started',
		'Price Valid Until': '2026-01-01 00:00:00 UTC',
		'Health Factor': '95%',
		Principal: '475 REP',
		Commitment: '50 USDC',
	})
	expect(Object.fromEntries(semanticFields({ liquidationStartedAt: '1767225600', liquidationPrice: '5' }, 'ETH'))).toEqual({ 'Liquidation Started At': '2026-01-01 00:00:00 UTC', 'Liquidation Price': '5' })
})
