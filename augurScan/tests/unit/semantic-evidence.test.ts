import { callTraceRows } from '../../browser/call-trace.ts'
import { expect, test } from 'bun:test'
import { semanticFields, semanticSummary, timelineEntityPath } from '../../browser/semantic-evidence.ts'

test('renders exact lifecycle amounts, counterparties and outcomes without rounding', () => {
	expect(semanticSummary({ event_data: { badDebtAttoEth: String(1000000000000000001n), outcome: '3', receiver: '0x1111111111111111111111111111111111111111' } }, 'ETH')).toContain('1.000000000000000001 ETH')
	expect(semanticSummary({ event_data: { badDebtAttoEth: String(10n ** 18n) } }, 'SepoliaETH')).toBe('Bad Debt: 1 SepoliaETH')
	expect(semanticSummary({ event_data: { outcome: '3' } }, 'ETH')).toContain('None')
	expect(semanticSummary({ event_data: { funded: false } }, 'ETH')).toContain('No')
	expect(semanticFields({ outcomeBalancesAttoRep: ['1000000000000000000', '2', '3'] }, 'ETH').map(field => field[0])).toEqual(['INVALID balance', 'YES balance', 'NO balance'])
})

test('timeline targets compound vault identities without losing the pool', () => {
	expect(timelineEntityPath({ entity_type: 'vault', entity_identity: 'pool:vault' })).toBe('/operations/risk/vault/pool/vault')
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

test('presents retention evidence as the annual open-interest fee', () => {
	expect(semanticFields({ currentRetentionRate: '1000000000000000000' }, 'ETH')).toEqual([['Annual open-interest fee', '0%']])
	expect(semanticFields({ initial_retention_rate: '0' }, 'ETH')).toEqual([['Initial annual open-interest fee', '100%']])
	expect(semanticFields({ current_retention_rate: null }, 'ETH')).toEqual([['Annual open-interest fee', 'Unavailable']])
})
