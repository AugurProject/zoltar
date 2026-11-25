import { callTraceRows } from '../../browser/call-trace.ts'
import { expect, test } from 'bun:test'
import { semanticFields, semanticSummary, timelineEntityPath, timelineTransitionSummary } from '../../browser/semantic-evidence.ts'

test('renders exact lifecycle amounts, counterparties and outcomes without rounding', () => {
	expect(semanticSummary({ event_data: { badDebtAttoEth: String(1000000000000000001n), outcome: '3', receiver: '0x1111111111111111111111111111111111111111' } }, 'ETH')).toContain('1.000000000000000001 ETH')
	expect(semanticSummary({ event_data: { badDebtAttoEth: String(10n ** 18n) } }, 'SepoliaETH')).toBe('Bad Debt: 1 SepoliaETH')
	expect(semanticSummary({ event_data: { outcome: '3' } }, 'ETH')).toContain('Outcome: 3')
	expect(semanticSummary({ event_data: { funded: false } }, 'ETH')).toContain('No')
	expect(semanticFields({ outcomeBalancesAttoRep: ['1000000000000000000', '2', '3'] }, 'ETH').map(field => field[0])).toEqual(['INVALID balance', 'YES balance', 'NO balance'])
})

test('formats auction collateral amounts, including nested clearing, with the collateral token units', () => {
	const usdc = { symbol: 'USDC', decimals: 6 }
	const auction = { collateral: usdc, depositedAttoEth: String(2500000n), clearing: { raisedAttoEth: String(1500000n), soldAttoRep: String(10n ** 18n) } }
	expect(semanticFields(auction, 'ETH')).toEqual([
		['Collateral', 'Symbol: USDC · Decimals: 6'],
		['Deposited', '2.5 USDC'],
		['Clearing', 'Raised: 1.5 USDC · Sold: 1 REP'],
	])
	// Auctions without sampled token metadata stay in explicit raw collateral units instead of native ETH.
	expect(semanticFields({ lotAttoEth: String(2500000n), clearing: { raisedAttoEth: String(7n) } }, 'ETH', { symbol: 'collateral units', decimals: 0 })).toEqual([
		['Lot', '2,500,000 collateral units'],
		['Clearing', 'Raised: 7 collateral units'],
	])
})

test('timeline security pool premiums use the security pool collateral token, never native ETH', () => {
	const premium = { entity_type: 'security-pool-services', summary_data: { universeId: '0', amountAttoEth: '14247' } }
	expect(timelineTransitionSummary({ ...premium, collateral: { symbol: 'USDC', decimals: 6 } }, 'ETH')).toBe('Universe Id: 0 · Amount: 0.014247 USDC')
	expect(timelineTransitionSummary(premium, 'ETH')).toBe('Universe Id: 0 · Amount: 14,247 collateral units')
	for (const entity_type of ['pool', 'security-pool-settlement', 'security-pool-auction']) {
		expect(timelineTransitionSummary({ entity_type, collateral: { symbol: 'USDC', decimals: 6 }, summary_data: { amountAttoEth: '1000000' } }, 'ETH')).toBe('Amount: 1 USDC')
	}
})

test('timeline targets link only entities that have a detail page', () => {
	// A vault is a capital-ledger owner; it has timeline evidence but no detail page of its own.
	expect(timelineEntityPath({ entity_type: 'vault', entity_identity: 'ledger:owner' })).toBeUndefined()
	expect(timelineEntityPath({ entity_type: 'pool', entity_identity: 'pool' })).toBe('/operations/risk/pool/pool')
	expect(timelineEntityPath({ entity_type: 'auction', entity_identity: 'auction' })).toBe('/operations/auction/auction')
})

test('formats checkpoint units and tagged timestamps', () => {
	expect(semanticFields({ healthFactorBps: '11350' }, 'ETH')).toEqual([['Health Factor', '113.5%']])
	expect(semanticFields({ claimable_fees_atto_eth: '1000000000000000000', endTimestamp: '1750000000' }, 'SepoliaETH')).toEqual([
		['Claimable fees', '1 SepoliaETH'],
		['End Timestamp', '2025-06-15 15:06:40 UTC'],
	])
})

test('reverted ancestors make child ETH movements attempted rather than transferred', () => {
	const rows = callTraceRows({ type: 'CALL', error: 'execution reverted', value: '0x1', calls: [{ value: '0x1' }] }, 'ETH')
	expect(rows).toHaveLength(2)
	expect(rows.every(row => row.includes('value not transferred'))).toBe(true)
	expect(rows[1]).toContain('0.000000000000000001 ETH')
	expect(callTraceRows({ type: 'CALL', calls: [{ value: '0x0' }] }, 'SepoliaETH')).toEqual(['Transaction · CALL · Unknown → Creation · 0 SepoliaETH', 'Internal call (depth 1) · CALL · Unknown → Creation · 0 SepoliaETH'])
})

test('presents annual basis points as a fee and leaves legacy retention values raw', () => {
	expect(semanticFields({ annualFeeBps: '125' }, 'ETH')).toEqual([['Annual open-interest fee', '1.25%']])
	expect(semanticFields({ annual_fee_bps: null }, 'ETH')).toEqual([['Annual open-interest fee', 'Unavailable']])
	expect(semanticFields({ currentRetentionRate: '1000000000000000000' }, 'ETH')).toEqual([['Current Retention Rate', '1,000,000,000,000,000,000']])
})

test('formats pool share supply and coordinator prices with collateral precision', () => {
	expect(semanticFields({ shareTokenSupplyAttoShares: '1000000', repPerEth1e18: (2n * 10n ** 30n).toString(), lastSettlementTimestamp: '1750000000' }, 'ETH', { symbol: 'USDC', decimals: 6 })).toEqual([
		['Share Token Supply', '1 shares'],
		['Rep Per Eth1e18', '2 REP/USDC'],
		['Last Settlement Timestamp', '2025-06-15 15:06:40 UTC'],
	])
})

test('formats auction windows as dates without treating security pool clock values as timestamps', () => {
	expect(semanticFields({ opensAt: '1750000000', closesAt: '1750000000', lastSettlementSecurityPoolTime: '1750000000' }, 'ETH')).toEqual([
		['Opens At', '2025-06-15 15:06:40 UTC'],
		['Closes At', '2025-06-15 15:06:40 UTC'],
		['Last Settlement Security Pool Time', '1,750,000,000'],
	])
})

test('timeline coordinator prices carry their REP per collateral units', () => {
	expect(timelineTransitionSummary({ entity_type: 'price-coordinator', collateral: { symbol: 'USDC', decimals: 6 }, event_data: { price: (2n * 10n ** 30n).toString() } }, 'ETH')).toBe('Rep Per Eth1e18: 2 REP/USDC')
})

test('renders raw pool accounting columns without requiring an event payload', () => {
	const record = { block_number: '99', settlement_collateral_atto_eth: '1500000', share_token_supply_atto_shares: '2000000', last_settlement_portfolio_time: '120' }
	const summary = semanticSummary(record, 'ETH', { symbol: 'USDC', decimals: 6 })
	expect(summary).toContain('Settlement collateral: 1.5 USDC')
	expect(summary).toContain('Share token supply: 2 shares')
	expect(summary).toContain('Last settlement security pool time: 120')
	expect(summary).not.toContain('99')
})

test('delegate calls distinguish inherited value from a transfer', () => {
	const rows = callTraceRows({ type: 'CALL', value: '0xde0b6b3a7640000', calls: [{ type: 'DELEGATECALL', value: '0xde0b6b3a7640000', calls: [{ type: 'CALL', value: '0x1' }] }] }, 'ETH')
	expect(rows[1]).toContain('inherited value 1 ETH')
	expect(rows[2]).toEndWith('0.000000000000000001 ETH')
})
