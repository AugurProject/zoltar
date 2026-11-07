/// <reference types="bun-types" />

import { createMemoryClient } from '@tevm/memory-client'
import { describe, expect, test } from 'bun:test'
import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import { advanceSimulationTime, getNextSimulationTimestamp, getSimulationChainTimestamp, initializeSimulationClock, advanceNextSimulationBlock, includePendingSimulationTransaction, includePendingSimulationTransactionAtTimestamp, withSimulationLock } from '../../simulation/clock.js'

// The simulation clock starts at 2025-01-01T00:00:00Z and advances one second per block.
const SIMULATION_INITIAL_TIMESTAMP = 1_735_689_600n
const SIMULATION_BLOCK_INTERVAL_SECONDS = 1n
const SENDER = '0x00000000000000000000000000000000000000a1'
const RECIPIENT = '0x00000000000000000000000000000000000000b2'

function createSimulationNode(overrides: { addTransactionError?: Error; txForHash?: { isFound: boolean; txValue?: unknown } }) {
	const stateRoot = hexToBytes(`0x${'0a'.repeat(32)}`)
	const canonicalBlock = {
		header: {
			calcNextBaseFee: () => 1n,
			gasLimit: 1n,
			number: 0n,
			stateRoot,
		},
		hash: () => new Uint8Array([1]),
	}
	const calls: string[] = []
	const vm = {
		blockchain: {
			getCanonicalHeadBlock: async () => canonicalBlock,
			putBlock: async () => {
				calls.push('putBlock')
			},
		},
		common: {},
		evm: {
			blockchain: {},
		},
		buildBlock: async () => blockBuilder,
		stateManager: {
			_baseState: { stateRoots: new Map<string, unknown>() },
			checkpoint: async () => {
				calls.push('checkpoint')
			},
			commit: async () => {
				calls.push('commit')
			},
		},
	}
	const blockBuilder = {
		addTransaction: async () => {
			if (overrides.addTransactionError !== undefined) throw overrides.addTransactionError
			return { receipt: { status: 1 } }
		},
		build: async () => ({
			hash: () => new Uint8Array([2]),
			header: {
				calcNextBaseFee: () => 1n,
				gasLimit: 1n,
				number: 1n,
				stateRoot,
			},
		}),
		revert: async () => {
			calls.push('revert')
		},
	}

	return {
		calls,
		node: {
			getReceiptsManager: async () => ({
				chain: {} as unknown,
				saveReceipts: async () => {
					calls.push('saveReceipts')
				},
			}),
			getTxPool: async () => ({
				getByHash: () => (overrides.txForHash?.isFound ? overrides.txForHash.txValue : null),
				removeByHash: () => undefined,
				removeNewBlockTxs: async () => undefined,
			}),
			getVm: async () => vm,
		},
	}
}

function createFakeMemoryClient(node: ReturnType<typeof createSimulationNode>['node']) {
	return {
		getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
		transport: { tevm: node },
	}
}

function hexToBytes(hex: Hex): Uint8Array {
	const withoutPrefix = hex.startsWith('0x') ? hex.slice(2) : hex
	if (withoutPrefix.length % 2 === 1) throw new Error('Invalid hex string')
	const result = new Uint8Array(withoutPrefix.length / 2)
	for (let index = 0; index < withoutPrefix.length; index += 2) {
		result[index / 2] = Number.parseInt(withoutPrefix.slice(index, index + 2), 16)
	}
	return result
}

async function createFundedMemoryClient() {
	const memoryClient = createMemoryClient({ miningConfig: { type: 'manual' } })
	await memoryClient.tevmReady()
	await memoryClient.impersonateAccount({ address: SENDER })
	await memoryClient.setBalance({ address: SENDER, value: 10n ** 20n })
	await initializeSimulationClock(memoryClient)
	return memoryClient
}

async function poolTransfer(memoryClient: Awaited<ReturnType<typeof createFundedMemoryClient>>, value: bigint) {
	const result = await memoryClient.tevmCall({ addToMempool: true, from: SENDER, to: RECIPIENT, value })
	if (result.txHash === undefined) throw new Error('Expected a pooled transaction hash')
	return result.txHash
}

describe('simulation clock', () => {
	test('calculates the next simulation timestamp from a fixed interval', () => {
		expect(getNextSimulationTimestamp(12n)).toBe(13n)
		expect(getNextSimulationTimestamp(0n)).toBe(1n)
	})

	test('requires a timestamp on chain blocks', async () => {
		const memoryClient = {
			getBlock: async () => ({}) as { timestamp: bigint },
		}

		await expect(getSimulationChainTimestamp(memoryClient as never)).rejects.toThrow('Simulation block timestamp was unavailable')
	})

	test('initializes the clock only when needed', async () => {
		const memoryClient = createMemoryClient()
		const initialized = await initializeSimulationClock(memoryClient)
		const secondInit = await initializeSimulationClock(memoryClient, initialized)
		const timestamp = await getSimulationChainTimestamp(memoryClient)

		expect(initialized).toBe(SIMULATION_INITIAL_TIMESTAMP)
		expect(timestamp).toBe(SIMULATION_INITIAL_TIMESTAMP)
		expect(secondInit).toBe(SIMULATION_INITIAL_TIMESTAMP)
	})

	test('advances by explicit seconds and by default interval', async () => {
		const memoryClient = createMemoryClient()
		await initializeSimulationClock(memoryClient)
		await advanceNextSimulationBlock(memoryClient)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS)

		await advanceSimulationTime(memoryClient, 5n)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS + 5n)

		await advanceSimulationTime(memoryClient, 0n)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS * 2n + 5n)
	})

	test('mines a pooled transaction into its own block on the live VM and reports its receipt', async () => {
		const memoryClient = await createFundedMemoryClient()
		const blockBefore = await memoryClient.getBlock()
		const txHash = await poolTransfer(memoryClient, 5n)

		const receipt = await includePendingSimulationTransaction(memoryClient, txHash)

		const block = await memoryClient.getBlock()
		expect(block.number).toBe(blockBefore.number + 1n)
		expect(block.timestamp).toBe(blockBefore.timestamp + SIMULATION_BLOCK_INTERVAL_SECONDS)
		expect(receipt).toMatchObject({ blockHash: block.hash, blockNumber: `0x${block.number.toString(16)}`, gasUsed: '0x5208', status: '0x1', to: RECIPIENT, transactionHash: txHash, transactionIndex: '0x0', type: '0x2' })
		expect(receipt.from.toLowerCase()).toBe(SENDER)
		expect(await memoryClient.getBalance({ address: RECIPIENT })).toBe(5n)
		expect(await memoryClient.getTransactionCount({ address: SENDER })).toBe(1)
		expect(await memoryClient.getTransactionReceipt({ hash: txHash })).toMatchObject({ blockNumber: block.number, status: 'success' })
	})

	test('serializes concurrent blocks so each one reads the chain it extends', async () => {
		const memoryClient = await createFundedMemoryClient()
		const startBlock = await memoryClient.getBlock()
		const firstTransfer = await poolTransfer(memoryClient, 1n)
		const secondTransfer = await poolTransfer(memoryClient, 2n)

		await Promise.all([advanceSimulationTime(memoryClient, 5n), includePendingSimulationTransaction(memoryClient, firstTransfer), advanceSimulationTime(memoryClient, 5n), advanceNextSimulationBlock(memoryClient), includePendingSimulationTransaction(memoryClient, secondTransfer)])

		const block = await memoryClient.getBlock()
		expect(block.number).toBe(startBlock.number + 5n)
		expect(block.timestamp).toBe(startBlock.timestamp + 5n + 1n + 5n + 1n + 1n)
		expect(await memoryClient.getBalance({ address: RECIPIENT })).toBe(3n)
	})

	test('runs locked work in order and keeps going after a failure', async () => {
		const key = createMemoryClient()
		const order: string[] = []
		const failing = withSimulationLock(key, async () => {
			order.push('first')
			throw new Error('first failed')
		})
		const second = withSimulationLock(key, async () => {
			order.push('second')
			return 'done'
		})
		await expect(failing).rejects.toThrow('first failed')
		expect(await second).toBe('done')
		expect(order).toEqual(['first', 'second'])
	})

	test('throws when the transport is not a compatible Tevm node', async () => {
		const memoryClient = {
			getBlock: async () => ({ timestamp: 0n }),
			transport: {},
		} as never

		await expect(advanceNextSimulationBlock(memoryClient)).rejects.toThrow('Simulation transport did not expose a compatible Tevm node')
	})

	test('throws when including a pending transaction that is missing from the tx pool', async () => {
		const { node } = createSimulationNode({ txForHash: { isFound: false } })
		const txHash = '0x1234' as `0x${string}`

		await expect(includePendingSimulationTransactionAtTimestamp(createFakeMemoryClient(node) as never, txHash, SIMULATION_INITIAL_TIMESTAMP)).rejects.toThrow(`Simulation transaction ${txHash} was not found in the tx pool`)
	})

	test('reverts the open block when the builder rejects the transaction', async () => {
		const { calls, node } = createSimulationNode({ addTransactionError: new Error('tx has a higher gas limit than the remaining gas in the block'), txForHash: { isFound: true, txValue: {} } })

		await expect(includePendingSimulationTransactionAtTimestamp(createFakeMemoryClient(node) as never, '0x1234', SIMULATION_INITIAL_TIMESTAMP)).rejects.toThrow('higher gas limit')
		expect(calls).toEqual(['revert'])
	})
})
