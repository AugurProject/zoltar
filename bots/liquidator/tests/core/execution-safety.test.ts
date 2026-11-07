import { describe, expect, test } from 'bun:test'
import { shouldStopAfterSuccessfulCycle } from '../../src/core/cycle-control.ts'
import { assertExecutionActive, assertGasCostLimitForBaseFee, requireFinalizedTransactionReceipt, setExecutionShutdownCheck } from '../../src/execution/execution-safety.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { maximumFeePerGas, paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { availableExecutionObservations, liquidationExecutionSnapshotObservation } from '../../src/monitoring/execution-quorum.ts'

describe('liquidator execution safety', () => {
	test('tolerates one offline scan but never hides malformed state behind two agreeing scans', async () => {
		const agreeing = { endpoint: 'rpc-a', state: { blockHash: '0xabc' } }
		const healthy = [Promise.resolve(agreeing), Promise.resolve({ ...agreeing, endpoint: 'rpc-b' }), Promise.reject(new TypeError('fetch failed'))]
		const available = availableExecutionObservations('liquidation snapshot', await Promise.allSettled(healthy), observation => ({ endpoint: observation.endpoint, value: observation.state }), 2)
		expect(available).toHaveLength(2)

		const malformed = [Promise.resolve(agreeing), Promise.resolve({ ...agreeing, endpoint: 'rpc-b' }), Promise.reject(new Error('Constant-product pair returned malformed state'))]
		const malformedSettled = await Promise.allSettled(malformed)
		expect(() => availableExecutionObservations('liquidation snapshot', malformedSettled, observation => ({ endpoint: observation.endpoint, value: observation.state }), 2)).toThrow('malformed state')
	})

	test('classifies insufficient transport-only scan observations as degraded connectivity under the explicit quorum policy', () => {
		const unavailable = new TypeError('fetch failed')
		const settled: PromiseSettledResult<{ endpoint: string; value: bigint }>[] = [
			{ status: 'fulfilled', value: { endpoint: 'rpc-a', value: 1n } },
			{ reason: unavailable, status: 'rejected' },
			{ reason: unavailable, status: 'rejected' },
		]
		try {
			availableExecutionObservations('scan', settled, value => value, 2)
			throw new Error('Expected an insufficient transport quorum')
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			if (!(error instanceof Error)) throw error
			expect(error.name).toBe('ConnectivityDegradedError')
		}
	})
	test('fails closed when an available execution reader disagrees on wallet REP balance', async () => {
		const observations = await Promise.allSettled([Promise.resolve({ endpoint: 'rpc-a', walletRepByToken: [['0xrep', 10n]] }), Promise.resolve({ endpoint: 'rpc-b', walletRepByToken: [['0xrep', 10n]] }), Promise.resolve({ endpoint: 'rpc-c', walletRepByToken: [['0xrep', 11n]] })])
		expect(() => availableExecutionObservations('liquidation execution snapshot', observations, observation => ({ endpoint: observation.endpoint, value: observation.walletRepByToken }), 2)).toThrow('RPC disagreement')
	})
	test('fails closed when execution readers observe matching portfolio data at different blocks', async () => {
		const scan = { block: { hash: `0x${'11'.repeat(32)}`, number: 1n, timestamp: 1n }, portfolios: [], universes: [], walletRepByToken: new Map<string, bigint>() }
		const observations = await Promise.allSettled([Promise.resolve({ endpoint: 'rpc-a', scan }), Promise.resolve({ endpoint: 'rpc-b', scan: { ...scan, block: { ...scan.block, hash: `0x${'22'.repeat(32)}`, number: 2n } } })])
		expect(() => availableExecutionObservations('liquidation execution snapshot', observations, liquidationExecutionSnapshotObservation, 2)).toThrow('RPC disagreement')
	})
	test('rechecks an operator pause at transaction boundaries', () => {
		expect(() => assertExecutionActive({ paused: false })).not.toThrow()
		expect(() => assertExecutionActive({ paused: true })).toThrow('Operator paused before transaction submission')
	})
	test('rechecks shutdown at every transaction boundary', () => {
		const state = initialRuntimeState(false, undefined, 1)
		let stopping = false
		setExecutionShutdownCheck(state, () => stopping)
		expect(() => assertExecutionActive(state)).not.toThrow()
		stopping = true
		expect(() => assertExecutionActive(state)).toThrow('Operator stopping before transaction submission')
	})

	test('continues successful polling unless once mode is enabled', () => {
		expect(shouldStopAfterSuccessfulCycle(false)).toBe(false)
		expect(shouldStopAfterSuccessfulCycle(true)).toBe(true)
	})

	test('stops a dependent transaction sequence while the first receipt awaits canonical finality', () => {
		let dependentTransactionStarted = false
		expect(() => {
			requireFinalizedTransactionReceipt('Approve REP', `0x${'11'.repeat(32)}`, { observed: true, receipt: undefined })
			dependentTransactionStarted = true
		}).toThrow('awaiting canonical finality')
		expect(dependentTransactionStarted).toBe(false)
	})

	test('applies the exact signed-transaction fee horizon to the gas-cap precheck', () => {
		const baseFeePerGas = 10n * 10n ** 9n
		const capThatOnlyCoversTheFormerDoubleBaseFeeEstimate = 3_000_000_000_000_000n
		expect(() => assertGasCostLimitForBaseFee(100_000n, baseFeePerGas, capThatOnlyCoversTheFormerDoubleBaseFeeEstimate)).toThrow('maximumGasCostEth')
		const paddedCeiling = paddedTransactionGas(100_000n) * maximumFeePerGas(baseFeePerGas)
		expect(() => assertGasCostLimitForBaseFee(100_000n, baseFeePerGas, paddedCeiling)).not.toThrow()
		expect(() => assertGasCostLimitForBaseFee(100_000n, baseFeePerGas, paddedCeiling - 1n)).toThrow('maximumGasCostEth')
	})
})
