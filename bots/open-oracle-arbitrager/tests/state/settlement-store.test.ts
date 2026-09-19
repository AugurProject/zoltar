import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, type Hex } from '@zoltar/bot-shared/ethereum'
import { ATTEMPT_FINALITY_BLOCKS } from '#execution/execution-orchestration'
import { appendSettlementRecord, loadSettlementJournal, mergeSettlementRecord, parseSettlementSettings, settlementAttemptHoldsFlow, settlementAttemptIsUnresolved, settlementGasSpentAttoEthOnUtcDay, settlementJournalPath, settlementSettings, settlementSnapshot, type SettlementRecord } from '#state/settlement-store'

const account = getAddress('0x00000000000000000000000000000000000000aa')
const coordinator = getAddress('0x00000000000000000000000000000000000000cc')
const hash = (index: number): Hex => `0x${index.toString(16).padStart(64, '0')}`
const directories: string[] = []

afterEach(async () => {
	for (const directory of directories.splice(0)) await rm(directory, { force: true, recursive: true })
})

function record(index: number, overrides: Partial<SettlementRecord> = {}): SettlementRecord {
	return {
		account,
		actualGasCostEth: '0.004',
		coordinator,
		kind: 'settlement',
		lastValidBlockNumber: '125',
		minedAt: '2026-09-19T10:00:30.000Z',
		nonce: index.toString(),
		projectedGasCostEth: '0.005',
		receiptBlock: { hash: hash(1_000 + index), number: '101' },
		reportId: index.toString(),
		rewardEth: '0.017',
		status: 'confirmed',
		submissionBlockNumber: '100',
		submissionMode: 'public',
		submittedAt: '2026-09-19T10:00:00.000Z',
		transactionHash: hash(index),
		transactionIntent: { data: '0x1234', to: coordinator, value: '0' },
		updatedAt: '2026-09-19T10:01:00.000Z',
		...overrides,
	}
}

describe('settlement settings', () => {
	test('defaults to disabled with conservative thresholds when the configuration omits the block', () => {
		expect(parseSettlementSettings(undefined)).toEqual(parseSettlementSettings(undefined))
		expect(settlementSettings(parseSettlementSettings(undefined))).toEqual({ enabled: false, maxGasPriceGwei: '50', minimumProfitWeth: '0.001', rewardWithdrawThresholdEth: '0.01' })
	})

	test('round-trips a complete block and rejects partial, unknown, or out-of-range values', () => {
		const parsed = parseSettlementSettings({ enabled: true, maxGasPriceGwei: '12.5', minimumProfitWeth: '0.0005', rewardWithdrawThresholdEth: '0.02' })
		expect(parsed).toEqual({ enabled: true, maxGasPriceAttoEthPerGas: 12_500_000_000n, minimumProfitAttoWeth: 5n * 10n ** 14n, rewardWithdrawThresholdAttoEth: 2n * 10n ** 16n })
		expect(settlementSettings(parsed)).toEqual({ enabled: true, maxGasPriceGwei: '12.5', minimumProfitWeth: '0.0005', rewardWithdrawThresholdEth: '0.02' })
		expect(() => parseSettlementSettings({ enabled: true })).toThrow('Every settlement setting is required')
		expect(() => parseSettlementSettings({ ...settlementSettings(parsed), extra: 1 })).toThrow('Unknown settlement setting: extra')
		expect(() => parseSettlementSettings({ ...settlementSettings(parsed), enabled: 'yes' })).toThrow('Settlement enabled must be a boolean')
		expect(() => parseSettlementSettings({ ...settlementSettings(parsed), maxGasPriceGwei: '0' })).toThrow('maxGasPriceGwei must be from')
		expect(() => parseSettlementSettings({ ...settlementSettings(parsed), minimumProfitWeth: '2' })).toThrow('must not exceed 1 WETH')
		expect(() => parseSettlementSettings({ ...settlementSettings(parsed), rewardWithdrawThresholdEth: '0' })).toThrow('rewardWithdrawThresholdEth must be from')
	})
})

describe('settlement journal', () => {
	test('validates journaled records and requires a coordinator and report for settlements only', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-settlement-records-'))
		directories.push(directory)
		const path = join(directory, 'journal')
		const load = async (value: unknown) => {
			await writeFile(path, `${JSON.stringify({ chainId: 1, record: value })}\n`, 'utf8')
			return loadSettlementJournal(path, 1)
		}
		const withdrawal = record(2, { coordinator: undefined, kind: 'reward-withdrawal', reportId: undefined })
		expect(await load(record(1))).toEqual([record(1)])
		expect(await load(withdrawal)).toEqual([withdrawal])
		for (const invalid of [
			record(3, { coordinator: undefined }),
			record(4, { rewardEth: '-1' }),
			{ ...record(5), status: 'lost' },
			{ ...record(6), nonce: '-1' },
			{ ...record(7), transactionIntent: undefined },
			{ ...record(8), transactionIntent: { data: '0x12', to: 'coordinator', value: '0' } },
			{ ...record(9), submissionMode: 'relay' },
			{ ...record(10), lastValidBlockNumber: undefined },
			{ ...record(11), receiptBlock: { hash: 'block', number: '1' } },
			null,
		])
			await expect(load(invalid)).rejects.toThrow('Invalid settlement journal record at line 1')
	})

	test('appends chain-scoped lines and reads back the latest record per transaction newest first', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-settlement-journal-'))
		directories.push(directory)
		const path = settlementJournalPath(join(directory, 'positions.json'))
		expect(path).toBe(join(directory, 'positions.json.settlements'))
		expect(await loadSettlementJournal(path, 1)).toEqual([])
		await appendSettlementRecord(path, record(1, { actualGasCostEth: undefined, status: 'pending' }), 1)
		await appendSettlementRecord(path, record(2), 1)
		await appendSettlementRecord(path, record(1), 1)
		expect(await loadSettlementJournal(path, 1)).toEqual([record(1), record(2)])
		expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(3)
		await expect(loadSettlementJournal(path, 2)).rejects.toThrow('belongs to another chain')
		await writeFile(path, '{"chainId":1,"record":{}}\n', 'utf8')
		await expect(loadSettlementJournal(path, 1)).rejects.toThrow('Invalid settlement journal record at line 1')
		await writeFile(path, 'not json\n', 'utf8')
		await expect(loadSettlementJournal(path, 1)).rejects.toThrow('Invalid settlement journal line 1')
	})

	test('merges by transaction hash, nets confirmed rewards against every paid gas cost, and charges gas to the mined UTC day', () => {
		const merged = mergeSettlementRecord([record(2), record(1, { status: 'pending', actualGasCostEth: undefined })], record(1))
		expect(merged.map(entry => `${entry.reportId ?? 'reward'}:${entry.status}`)).toEqual(['1:confirmed', '2:confirmed'])
		const records = [record(1), record(2, { status: 'reverted', actualGasCostEth: '0.002' }), record(3, { status: 'expired', actualGasCostEth: undefined }), record(4, { coordinator: undefined, kind: 'reward-withdrawal', reportId: undefined, rewardEth: '0.03', actualGasCostEth: '0.0001' })]
		const snapshot = settlementSnapshot({ now: new Date('2026-09-19T23:59:59.000Z'), queue: [], records, settings: parseSettlementSettings(undefined), unclaimedRewardAttoEth: undefined, withdrawalDecision: 'unavailable' })
		expect(snapshot.realizedIncomeEth).toBe('0.0109')
		expect(snapshot.utcDayGasSpentEth).toBe('0.0061')
		expect(settlementSnapshot({ now: new Date('2026-09-20T00:00:00.000Z'), queue: [], records, settings: parseSettlementSettings(undefined), unclaimedRewardAttoEth: undefined, withdrawalDecision: 'unavailable' }).utcDayGasSpentEth).toBe('0')
	})

	test('charges a pending attempt its signed exposure on every day until its outcome replaces it', () => {
		const pending = record(1, { actualGasCostEth: undefined, minedAt: undefined, receiptBlock: undefined, status: 'pending' })
		// A dropped attempt holds its report until its own horizon has finalized, so a repeating refusal re-signs at that cadence.
		const dropped = { ...pending, status: 'dropped' as const }
		const horizonFinalized = BigInt(dropped.lastValidBlockNumber) + ATTEMPT_FINALITY_BLOCKS
		expect(settlementAttemptHoldsFlow(pending, 10_000n)).toBeTrue()
		expect(settlementAttemptHoldsFlow(dropped, horizonFinalized - 1n)).toBeTrue()
		expect(settlementAttemptHoldsFlow(dropped, horizonFinalized)).toBeFalse()
		expect(settlementAttemptHoldsFlow({ ...pending, status: 'expired' }, 0n)).toBeFalse()
		// Recovery keeps checking a dropped private attempt indefinitely; a dropped public one only until its horizon finalizes.
		expect(settlementAttemptIsUnresolved({ ...dropped, submissionMode: 'private' }, 10_000n)).toBeTrue()
		expect(settlementAttemptIsUnresolved(dropped, horizonFinalized - 1n)).toBeTrue()
		expect(settlementAttemptIsUnresolved(dropped, horizonFinalized)).toBeFalse()
		expect(settlementAttemptIsUnresolved({ ...pending, status: 'expired' }, 0n)).toBeFalse()
		// A mined outcome is rechecked until its receipt block has finality, because a short reorg can orphan the receipt.
		expect(settlementAttemptIsUnresolved(record(1), 101n + ATTEMPT_FINALITY_BLOCKS - 1n)).toBeTrue()
		expect(settlementAttemptIsUnresolved(record(1), 101n + ATTEMPT_FINALITY_BLOCKS)).toBeFalse()
		expect(settlementAttemptIsUnresolved(record(1, { status: 'reverted' }), 101n)).toBeTrue()
		const day = new Date('2026-09-19T23:59:59.000Z')
		expect(settlementGasSpentAttoEthOnUtcDay([pending], day)).toBe(5n * 10n ** 15n)
		// The liability follows the attempt across midnight; only a mined cost is pinned to its block's day.
		expect(settlementGasSpentAttoEthOnUtcDay([pending], new Date('2026-09-20T00:00:00.000Z'))).toBe(5n * 10n ** 15n)
		expect(settlementGasSpentAttoEthOnUtcDay([record(1)], day)).toBe(4n * 10n ** 15n)
		expect(settlementGasSpentAttoEthOnUtcDay([record(1)], new Date('2026-09-20T00:00:00.000Z'))).toBe(0n)
		// An expired attempt can never be mined and a dropped one is past its relay horizon: neither charges anything.
		expect(settlementGasSpentAttoEthOnUtcDay([{ ...pending, status: 'expired' }], day)).toBe(0n)
		expect(settlementGasSpentAttoEthOnUtcDay([{ ...pending, status: 'dropped' }], day)).toBe(0n)
	})

	test('bounds the dashboard history and formats the snapshot figures', () => {
		const records = Array.from({ length: 205 }, (_, index) => record(index + 1))
		const snapshot = settlementSnapshot({ now: new Date(), queue: [], records, settings: parseSettlementSettings(undefined), unclaimedRewardAttoEth: 123n * 10n ** 15n, withdrawalDecision: 'due' })
		expect(snapshot.history).toHaveLength(200)
		expect(snapshot.unclaimedRewardEth).toBe('0.123')
		expect(snapshot.realizedIncomeEth).toBe('2.665')
		expect(settlementSnapshot({ now: new Date(), queue: [], records: [], settings: parseSettlementSettings(undefined), unclaimedRewardAttoEth: undefined, withdrawalDecision: 'unavailable' }).unclaimedRewardEth).toBeUndefined()
	})
})
