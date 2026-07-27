import { describe, expect, test } from 'bun:test'
import { blockAgeLabel, botStatusLabels, chartPointX, countLabel, exactAmount, marketPriceChartDescription, opportunityDecisionReason, requiredSignerPrivateKey, signerControlState, sumSignedDecimals, transactionKindLabel } from './dashboard-format.js'

describe('dashboard exact ETH formatting', () => {
	test('preserves signed sub-micro, 18-decimal, and beyond-safe-integer totals', () => {
		expect(exactAmount('-0.0000004', 'ETH')).toBe('-0.0000004 ETH')
		expect(exactAmount('0.123456789012345678', 'ETH')).toBe('0.123456789012345678 ETH')
		expect(exactAmount('9007199254740993.000000000000000001', 'ETH')).toBe('9007199254740993.000000000000000001 ETH')
	})

	test('sums signed decimal strings without floating-point precision loss', () => {
		expect(sumSignedDecimals(['9007199254740993.000000000000000001', '-9007199254740993', '-0.0000004'])).toBe('-0.000000399999999999')
	})

	test('never maps an empty Set signer form to the clear-signer request', () => {
		expect(() => requiredSignerPrivateKey('  ')).toThrow('Enter a private key')
		expect(requiredSignerPrivateKey('  0x1234  ')).toBe('0x1234')
	})

	test('keeps every signer control locked throughout a pending request', () => {
		expect(signerControlState({ hasQueuedSigner: true, hasWallet: true, privateKey: '0xchanged', requestPending: true })).toEqual({
			clearDisabled: true,
			inputDisabled: true,
			setDisabled: true,
		})
	})

	test('shows block delay against the operator computer without hiding clock skew', () => {
		expect(blockAgeLabel('1000', 1_012_400)).toBe('12s behind')
		expect(blockAgeLabel('1000', 995_000)).toBe('5s ahead of local clock')
		expect(blockAgeLabel(undefined, 1_012_400)).toBe('timestamp unavailable')
	})

	test('clears populated bot labels when the dashboard disconnects', () => {
		expect(botStatusLabels(undefined)).toEqual({ mode: 'Mode —', status: '—' })
	})

	test('renders every operator lifecycle state without conflating failures with running', () => {
		expect(botStatusLabels({ mode: 'dry-run', paused: false, status: 'syncing' })).toEqual({ mode: 'dry-run', status: 'Syncing' })
		expect(botStatusLabels({ mode: 'execute', paused: false, status: 'running' })).toEqual({ mode: 'execute', status: 'Running' })
		expect(botStatusLabels({ mode: 'execute', paused: false, status: 'error' })).toEqual({ mode: 'execute', status: 'Error' })
		expect(botStatusLabels({ mode: 'execute', paused: false, status: 'stopped' })).toEqual({ mode: 'execute', status: 'Stopped' })
		expect(botStatusLabels({ mode: 'execute', paused: false, status: 'paused' })).toEqual({ mode: 'execute', status: 'Paused' })
		expect(botStatusLabels({ mode: 'execute', paused: true, status: 'syncing' })).toEqual({ mode: 'execute', status: 'Paused' })
	})

	test('uses arbitrary token symbols in inventory and approval labels', () => {
		expect(opportunityDecisionReason({ decision: 'insufficient-inventory', tokenSymbol: 'USDC' })).toBe('Wallet lacks the required WETH or USDC')
		expect(transactionKindLabel({ kind: 'approval-token', tokenSymbol: 'USDC' })).toBe('approve USDC')
		expect(transactionKindLabel({ kind: 'approval-weth', tokenSymbol: 'WETH' })).toBe('approval weth')
	})

	test('describes risk limits as capital and UTC-day gas-spend controls', () => {
		expect(opportunityDecisionReason({ decision: 'risk-limit', tokenSymbol: 'REP' })).toBe('A concurrent-position, position-notional, total-locked-capital, or UTC-day gas-spend limit blocks execution')
	})

	test('describes current-head pool samples without claiming one sample per unseen block', () => {
		expect(marketPriceChartDescription([{ blockNumber: '100' }, { blockNumber: '100' }, { blockNumber: '103' }])).toBe('3 current-head pool samples spanning observed heads at blocks 100 through 103. Exact recent values follow the chart in a table.')
		expect(marketPriceChartDescription([{ blockNumber: '100' }])).toBe('1 current-head pool sample spanning observed heads at blocks 100 through 100. Exact recent values follow the chart in a table.')
	})

	test('renders singular counts and centers a one-record chart point', () => {
		expect(countLabel(1, 'pool')).toBe('1 pool')
		expect(countLabel(2, 'pool')).toBe('2 pools')
		expect(countLabel(1, 'report path')).toBe('1 report path')
		expect(countLabel(1, 'entry', 'entries')).toBe('1 entry')
		expect(chartPointX(0, 1, 1_000)).toBe(500)
		expect(chartPointX(1, 3, 1_000)).toBe(500)
	})
})
