import { expect, spyOn, test } from 'bun:test'
import { keccak256, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createBlockWithTimestamp, createMulticallStub } from '@zoltar/ui-core-shared/tests/testUtils/protocolTestSupport.js'
import { testDouble } from '@zoltar/ui-core-shared/tests/testUtils/testDouble.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { exportStatoblastWatchlist, importStatoblastWatchlist } from '@zoltar/ui-statoblast-shared/protocol/watchlistTransfer.js'
import { getInfraContractAddresses } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { loadWatchlistRows, type WatchlistEntity, type WatchlistReadCheckpoint } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'

installDomTestLifecycle()

const pool: Address = '0x1111111111111111111111111111111111111111'
const ledger: Address = '0x2222222222222222222222222222222222222222'
const game: Address = '0x3333333333333333333333333333333333333333'
const foreign: Address = '0x4444444444444444444444444444444444444444'
const depositor: Address = '0x5555555555555555555555555555555555555555'
const factory = getInfraContractAddresses().securityPoolFactory
const hash = keccak256('0x01')

test('saved pools batch at most 25 verified items together at the same block', async () => {
	const entries = Array.from({ length: 26 }, (_, index): WatchlistEntity => {
		const address = `0x${(index + 256).toString(16).padStart(40, '0')}` as const
		return { kind: 'pool', id: address, pool: address }
	})
	const batches: number[] = []
	const progress: number[] = []
	let failSecondChunk = true
	const client = testDouble<Parameters<typeof loadWatchlistRows>[0]>({
		getBlock: async () => ({ ...createBlockWithTimestamp(10n), number: 15n, hash }),
		multicall: createMulticallStub(({ blockNumber, contracts }) => {
			expect(blockNumber).toBe(15n)
			batches.push(contracts.length)
			if (contracts.length === 7 && failSecondChunk) {
				failSecondChunk = false
				throw new Error('RPC unavailable')
			}
			return contracts.map(call => {
				if (call.functionName === 'isSecurityPool') return { status: 'success', result: true }
				if (call.functionName === 'annualFeeBps') return { status: 'success', result: 15n }
				if (call.functionName === 'universes') return { status: 'success', result: [0n, 0n] }
				return { status: 'success', result: '0x0000000000000000000000000000000000000000' }
			})
		}),
	})
	const checkpoint: WatchlistReadCheckpoint = { rows: [] }
	const load = () => loadWatchlistRows(client, entries, 0n, undefined, MAINNET_NETWORK_PROFILE, { checkpoint, onChunk: (_rows, finished) => progress.push(finished) })
	await expect(load()).rejects.toThrow('RPC unavailable')
	const rows = await load()
	expect(batches).toEqual([25, 151, 1, 7, 7])
	expect(progress).toEqual([25, 26])
	expect(rows.map(row => row.annualFee)).toEqual(entries.map(() => 15n))
})

test('import verifies the pool, question, game and depositor in order and skips foreign references', async () => {
	const calls: { target: Address; functionName: string }[] = []
	const client = testDouble<Parameters<typeof importStatoblastWatchlist>[0] & { getCode: (input: { address: Address }) => Promise<undefined> }>({
		getBlock: async () => ({ ...createBlockWithTimestamp(10n), number: 1n, hash }),
		getCode: async ({ address }: { address: Address }) => {
			calls.push({ target: address, functionName: 'getCode' })
			return undefined
		},
		multicall: createMulticallStub(request => {
			expect(request.blockNumber).toBe(1n)
			return request.contracts.map(call => {
				calls.push({ target: call.address, functionName: call.functionName })
				const success = (result: unknown) => ({ status: 'success', result })
				switch (call.functionName) {
					case 'isSecurityPool':
						expect(call.address).toBe(factory)
						return success(call.args?.[0] === pool)
					case 'getQuestionLedger':
						expect(call.address).toBe(pool)
						return call.args?.[0] === 1n ? success(ledger) : { status: 'failure', error: new Error('Multicall contract call failed: execution reverted: Question not registered') }
					case 'escalationGame':
						expect(call.address).toBe(ledger)
						return success(game)
					case 'getDepositsByOutcome':
						expect(call.address).toBe(game)
						return success([{ depositor, amountAttoRep: 0n, cumulativeAmountAttoRep: 11n }])
					default:
						throw new Error(`Unexpected import read ${call.functionName}`)
				}
			})
		}),
	})
	const deposit = { pool, questionId: '1', universeId: '0', outcome: 'yes', depositor, index: '2' }
	const file = JSON.stringify({
		version: 1,
		chainId: MAINNET_NETWORK_PROFILE.chain.id,
		saved: [
			{ kind: 'pool', pool: foreign },
			{ kind: 'question', pool, questionId: '9' },
		],
		deposits: [
			{ ...deposit, pool: foreign },
			{ ...deposit, questionId: '9' },
			{ ...deposit, ledger: foreign, game: foreign },
			{ ...deposit, depositor: foreign },
		],
	})
	await expect(importStatoblastWatchlist(client, MAINNET_NETWORK_PROFILE, 0n, file)).resolves.toEqual({ skipped: 5 })
	expect(calls.some(call => call.target === foreign)).toBe(false)
	expect(JSON.parse(exportStatoblastWatchlist(MAINNET_NETWORK_PROFILE))).toMatchObject({ saved: [], deposits: [deposit] })
})

test('import ignores question labels while preserving labels on saved pools', async () => {
	const client = testDouble<Parameters<typeof importStatoblastWatchlist>[0]>({
		getBlock: async () => ({ ...createBlockWithTimestamp(10n), number: 1n, hash }),
		multicall: createMulticallStub(request => request.contracts.map(call => ({ status: 'success', result: call.functionName === 'isSecurityPool' ? true : ledger }))),
	})
	const file = JSON.stringify({
		version: 1,
		chainId: MAINNET_NETWORK_PROFILE.chain.id,
		saved: [
			{ kind: 'pool', pool, label: 'My pool' },
			{ kind: 'question', pool, questionId: '1', label: 'Forged title' },
		],
		deposits: [],
	})
	await expect(importStatoblastWatchlist(client, MAINNET_NETWORK_PROFILE, 0n, file)).resolves.toEqual({ skipped: 0 })
	expect(JSON.parse(exportStatoblastWatchlist(MAINNET_NETWORK_PROFILE)).saved).toEqual([
		{ kind: 'pool', pool, label: 'My pool' },
		{ kind: 'question', pool, questionId: '1' },
	])
})

test.each(['expired', 'historical read failed'] as const)('watchlist retries from the latest block when the checkpoint is %s', async condition => {
	const clock = spyOn(Date, 'now').mockReturnValue(1_000)
	try {
		const entry: WatchlistEntity = { kind: 'pool', id: pool, pool }
		const checkpoint: WatchlistReadCheckpoint = { rows: [{ entity: entry, status: 'pool', annualFee: 15n }], anchor: { number: 1n, timestamp: 10n, hash, observedAt: 1_000 } }
		if (condition === 'expired') clock.mockReturnValue(61_001)
		const client = testDouble<Parameters<typeof loadWatchlistRows>[0]>({
			getBlock: async request => ({ ...createBlockWithTimestamp(11n), number: request?.blockNumber ?? 2n, hash }),
			multicall: createMulticallStub(({ blockNumber, contracts }) => {
				if (blockNumber === 1n) throw new Error('Historical state unavailable')
				return contracts.map(({ functionName }) => {
					switch (functionName) {
						case 'isSecurityPool':
							return { status: 'success', result: true }
						case 'annualFeeBps':
							return { status: 'success', result: 20n }
						case 'universes':
							return { status: 'success', result: [0n, 0n] }
						default:
							return { status: 'success', result: '0x0000000000000000000000000000000000000000' }
					}
				})
			}),
		})
		const entries = condition === 'expired' ? [entry] : [entry, entry]
		await expect(loadWatchlistRows(client, entries, 0n, undefined, MAINNET_NETWORK_PROFILE, { checkpoint })).resolves.toEqual(entries.map(() => expect.objectContaining({ annualFee: 20n })))
		expect(checkpoint.anchor?.number).toBe(2n)
	} finally {
		clock.mockRestore()
	}
})
