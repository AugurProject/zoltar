import { describe, expect, test } from 'bun:test'
import type { Address } from '@zoltar/shared/ethereum'
import {
	blockAgeLabel,
	botStatusLabels,
	chartPointX,
	chartTimeTickIndexes,
	countLabel,
	exactAmount,
	marketPoolStrategyUse,
	marketPriceChartDescription,
	opportunityDecisionReason,
	requiredSignerPrivateKey,
	selectedTokenPriceHistory,
	signerControlState,
	sumSignedDecimals,
	transactionKindLabel,
	venueLabel,
} from './dashboard-format.js'

describe('dashboard exact ETH formatting', () => {
	test('renders execution venue names without exposing snapshot slugs', () => {
		expect(venueLabel('uniswap-v2')).toBe('Uniswap V2')
		expect(venueLabel('uniswap-v3')).toBe('Uniswap V3')
		expect(venueLabel('uniswap-v4')).toBe('Uniswap V4')
		expect(venueLabel(undefined)).toBe('Unknown')
	})

	test('distinguishes the optional Uniswap V2 route from the default V3 route', () => {
		expect(marketPoolStrategyUse(true, 'Uniswap V2')).toBe('Optional execution route')
		expect(marketPoolStrategyUse(true, 'Uniswap V3')).toBe('Execution route')
		expect(marketPoolStrategyUse(true, 'SushiSwap V2')).toBe('Monitoring only')
		expect(marketPoolStrategyUse(false, 'Uniswap V2')).toBe('Monitoring only')
	})

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

	test('counts only the selected token price history shown in the chart', () => {
		const first = '0x0000000000000000000000000000000000000001' as Address
		const second = '0x0000000000000000000000000000000000000002' as Address
		const shared = { blockNumber: '1', pool: first, priceWeth: '1', sampledAt: '2026-07-28T00:00:00.000Z', symbol: 'REP', token: first, venue: 'Uniswap V3 0.3%' }
		const points = [shared, { ...shared, blockNumber: '2', token: first }, { ...shared, symbol: 'OTHER', token: second }]
		expect(selectedTokenPriceHistory(points, first)).toHaveLength(2)
		expect(selectedTokenPriceHistory(points, second)).toHaveLength(1)
	})

	test('suppresses a middle time tick that would collide with an endpoint', () => {
		expect(chartTimeTickIndexes([0, 1, 100], false, 1_000, 120)).toEqual([0, 2])
		expect(chartTimeTickIndexes([0, 50, 100], false, 1_000, 120)).toEqual([0, 1, 2])
		expect(chartTimeTickIndexes([0, 50, 100], true, 320, 120)).toEqual([0, 2])
		expect(chartTimeTickIndexes([100, 100], false, 1_000, 120)).toEqual([0])
	})
})
