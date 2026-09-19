import { describe, expect, test } from 'bun:test'
import { getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import type { OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import type { CoordinatorGamePolicy } from '#core/game-policy'
import type { ActiveReport } from '#monitoring/oracle-log-state'
import { selectSettlementPlan, settlementQueue, type SettlementQueueInput } from '#core/settlement-queue'
import { parseSettlementSettings, type SettlementRecord } from '#state/settlement-store'

const NANO_ETH = 10n ** 9n
const wallet = getAddress('0x00000000000000000000000000000000000000aa')
const coordinator = getAddress('0x00000000000000000000000000000000000000cc')
const openOracle = getAddress('0x0000000000000000000000000000000000000099')
const weth = getAddress('0x0000000000000000000000000000000000000001')
const rep = getAddress('0x0000000000000000000000000000000000000002')

function report(reportId: bigint, overrides: Partial<OpenOracleStatePreimage['game']> = {}, creator = coordinator): ActiveReport {
	const game = {
		callbackContract: coordinator,
		callbackGasLimit: 4_000_000n,
		currentAmount1: 10n ** 18n,
		currentAmount2: 10n ** 18n,
		currentReporter: coordinator,
		disputeDelay: 0n,
		escalationHalt: 10n ** 19n,
		feePercentage: 10_000n,
		flags: 7n,
		lastReportOppoTime: 1n,
		multiplier: 115n,
		numReports: 1n,
		protocolFee: 100_000n,
		protocolFeeRecipient: coordinator,
		reportTimestamp: 1_000n,
		settlementTime: 480n,
		settlementTimestamp: 0n,
		settlerRewardAttoEth: 17_043_310_270_400_101n,
		token1: weth,
		token2: rep,
		...overrides,
	}
	return { latest: { game, helper: { blockNumber: 10n, blockTimestamp: 1_000n, creator, reportId } }, settled: game.settlementTimestamp !== 0n, steps: [] }
}

const policy: CoordinatorGamePolicy = { ...report(0n).latest.game, coordinator, openOracle }

function input(overrides: Partial<SettlementQueueInput> = {}): SettlementQueueInput {
	return {
		account: wallet,
		blockNumber: 50n,
		blockTimestamp: 1_500n,
		config: { execute: true, openOracle, settlement: { ...parseSettlementSettings(undefined), enabled: true } },
		coordinatorPolicies: [policy],
		dailyGas: { limitAttoWeth: 5n * 10n ** 16n, spentAttoWeth: 0n },
		gasPrice: 2n * NANO_ETH,
		maxFeePerGas: 2n * NANO_ETH,
		paused: false,
		records: [],
		reports: [],
		signerReady: true,
		tokenSymbol: token => (token === rep ? 'REP' : undefined),
		...overrides,
	}
}

describe('settlement queue', () => {
	test('lists only unsettled approved-coordinator reports past their window and prices each one', () => {
		const stranger = getAddress('0x00000000000000000000000000000000000000dd')
		const { plans, queue } = settlementQueue(
			input({
				reports: [report(11n), report(12n, { reportTimestamp: 1_100n }), report(13n, { settlementTimestamp: 1_490n }), report(14n, {}, stranger), report(15n, { currentReporter: wallet }), report(16n, { callbackGasLimit: 1n })],
			}),
		)
		expect(queue.map(candidate => candidate.reportId)).toEqual(['11'])
		expect(queue[0]).toMatchObject({ callbackGasLimit: '4000000', coordinator, decision: 'eligible', elapsed: '20', projectedGasCostEth: '0.01053638', projectedNetEth: '0.006506930270400101', rewardEth: '0.017043310270400101', token: rep, tokenSymbol: 'REP', windowUnit: 'seconds' })
		expect(plans.get('11')?.gas).toBe(4_313_492n)
	})

	test('explains why a candidate waits and keeps in-flight reports out of the plans', () => {
		const pending: SettlementRecord = {
			account: wallet,
			actualGasCostEth: undefined,
			coordinator,
			finalized: false,
			kind: 'settlement',
			lastValidBlockNumber: '74',
			minedAt: undefined,
			nonce: '3',
			projectedGasCostEth: '0.008',
			receiptBlock: undefined,
			replacedBy: undefined,
			reportId: '11',
			rewardEth: '0.017',
			status: 'pending',
			submissionBlockNumber: '49',
			submissionMode: 'public',
			submittedAt: '2026-09-19T10:00:00.000Z',
			transactionHash: `0x${'1'.repeat(64)}` as Hex,
			transactionIntent: { data: '0x', to: openOracle, value: '0' },
			updatedAt: '2026-09-19T10:00:00.000Z',
		}
		const inFlight = settlementQueue(input({ records: [pending], reports: [report(11n), report(12n, { settlerRewardAttoEth: 1n })] }))
		expect(inFlight.queue.map(candidate => [candidate.reportId, candidate.decision])).toEqual([
			['12', 'unprofitable'],
			['11', 'in-flight'],
		])
		expect(inFlight.plans.size).toBe(0)
		// A public transaction has no deadline: the report stays in flight however many blocks pass, until the nonce is consumed by another transaction.
		expect(settlementQueue(input({ blockNumber: 49n + 10_000n, records: [pending], reports: [report(11n)] })).queue[0]?.decision).toBe('in-flight')
		expect(settlementQueue(input({ blockNumber: 50n, records: [{ ...pending, status: 'expired' }], reports: [report(11n)] })).queue[0]?.decision).toBe('eligible')
		// A dropped attempt holds the report until its own horizon has finalized, then the report is free while recovery keeps rechecking it.
		expect(settlementQueue(input({ blockNumber: 74n + 11n, records: [{ ...pending, status: 'dropped' }], reports: [report(11n)] })).queue[0]?.decision).toBe('in-flight')
		expect(settlementQueue(input({ blockNumber: 74n + 12n, records: [{ ...pending, status: 'dropped', submissionMode: 'private' }], reports: [report(11n)] })).queue[0]?.decision).toBe('eligible')
		expect(settlementQueue(input({ config: { execute: false, openOracle, settlement: { ...parseSettlementSettings(undefined), enabled: true } }, reports: [report(11n)] })).queue[0]?.decision).toBe('dry-run-settlement')
		expect(settlementQueue(input({ reports: [report(11n)], config: { execute: true, openOracle, settlement: parseSettlementSettings(undefined) } })).queue[0]?.decision).toBe('disabled')
		expect(settlementQueue(input({ paused: true, reports: [report(11n)] })).queue[0]?.decision).toBe('paused')
		expect(settlementQueue(input({ gasPrice: 51n * NANO_ETH, reports: [report(11n, { settlerRewardAttoEth: 10n ** 18n })] })).queue[0]?.decision).toBe('gas-price-cap')
		expect(settlementQueue(input({ signerReady: false, reports: [report(11n)] })).queue[0]?.decision).toBe('signer-unavailable')
		expect(settlementQueue(input({ dailyGas: { limitAttoWeth: 5n * 10n ** 16n, spentAttoWeth: 45n * 10n ** 15n }, reports: [report(11n)] })).queue[0]?.decision).toBe('risk-limit')
	})

	test('prices profitability and the budget at the signed fee ceiling, not the projected inclusion price', () => {
		// 2 nanoETH is worth sending, but the signature may pay up to 4 nanoETH per gas; the plan and the budget carry the 4 nanoETH cost.
		const { plans, queue } = settlementQueue(input({ gasPrice: 2n * NANO_ETH, maxFeePerGas: 4n * NANO_ETH, reports: [report(11n, { settlerRewardAttoEth: 3n * 10n ** 16n })] }))
		expect(queue[0]).toMatchObject({ decision: 'eligible', projectedGasCostEth: '0.02107276', projectedNetEth: '0.00892724' })
		expect(plans.get('11')?.projectedGasCostAttoEth).toBe((5_186_190n + 82_000n) * 4n * NANO_ETH)
		// The default reward clears 2 nanoETH but not the 4 nanoETH the signature could pay.
		expect(settlementQueue(input({ gasPrice: 2n * NANO_ETH, maxFeePerGas: 2n * NANO_ETH, reports: [report(11n)] })).queue[0]?.decision).toBe('eligible')
		expect(settlementQueue(input({ gasPrice: 2n * NANO_ETH, maxFeePerGas: 4n * NANO_ETH, reports: [report(11n)] })).queue[0]?.decision).toBe('unprofitable')
		expect(settlementQueue(input({ dailyGas: { limitAttoWeth: 2n * 10n ** 16n, spentAttoWeth: 3n * 10n ** 15n }, gasPrice: 2n * NANO_ETH, maxFeePerGas: 4n * NANO_ETH, reports: [report(11n, { settlerRewardAttoEth: 3n * 10n ** 16n })] })).queue[0]?.decision).toBe('risk-limit')
	})

	test('selects the plan with the highest projected net', () => {
		const { plans } = settlementQueue(input({ reports: [report(11n), report(12n, { settlerRewardAttoEth: 2n * 10n ** 16n }), report(13n, { settlerRewardAttoEth: 3n * 10n ** 16n })] }))
		expect(plans.size).toBe(3)
		expect(selectSettlementPlan(plans)?.report.helper.reportId).toBe(13n)
		expect(selectSettlementPlan(new Map())).toBeUndefined()
	})
})
