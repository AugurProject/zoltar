/// <reference types="bun-types" />

import { createMemoryClient } from 'tevm'
import { describe, expect, test } from 'bun:test'
import { bytesToHex, type Hex } from '@zoltar/shared/ethereum'
import { SIMULATION_BLOCK_INTERVAL_SECONDS, SIMULATION_INITIAL_TIMESTAMP, advanceSimulationTime, getNextSimulationTimestamp, getSimulationChainTimestamp, initializeSimulationClock, mineNextSimulationBlock, minePendingSimulationTransactionAtTimestamp } from '../simulation/clock.js'

function createSimulationNode(overrides: { blockStateRootHex: Hex; includeStateRoot: boolean; txForHash?: { isFound: boolean; txValue?: unknown } }) {
	const stateRoot = hexToBytes(overrides.blockStateRootHex)
	const canonicalBlock = {
		header: {
			calcNextBaseFee: () => 1n,
			gasLimit: 1n,
			number: 0n,
			stateRoot,
		},
		hash: () => new Uint8Array([1]),
	}
	const baseStateRoot = '0x' + '00'.repeat(32)
	const baseRootBytes = hexToBytes(baseStateRoot as Hex)
	const stateRoots = new Map([[bytesToHex(stateRoot), baseRootBytes]])

	if (!overrides.includeStateRoot) {
		stateRoots.clear()
	}

	const vm = {
		blockchain: {
			getCanonicalHeadBlock: async () => canonicalBlock,
			putBlock: async () => undefined,
		},
		common: {},
		deepCopy: async () => vm,
		evm: {
			blockchain: {},
		},
		buildBlock: async () => blockBuilder,
		stateManager: {
			_baseState: {
				getCurrentStateRoot: () => baseStateRoot,
				stateRoots,
			},
			checkpoint: async () => undefined,
			commit: async () => undefined,
			saveStateRoot: async () => undefined,
			setStateRoot: async () => undefined,
		},
	}
	const blockBuilder = {
		addTransaction: async () => ({ receipt: { status: 'success' } }),
		build: async () => ({
			hash: () => new Uint8Array([2]),
			header: {
				calcNextBaseFee: () => 1n,
				gasLimit: 1n,
				number: 1n,
				stateRoot,
			},
		}),
	}

	return {
		vm,
		node: {
			getReceiptsManager: async () => ({
				chain: {} as unknown,
				saveReceipts: async () => undefined,
			}),
			getTxPool: async () => ({
				getByHash: () => (overrides.txForHash?.isFound ? overrides.txForHash.txValue : null),
				removeByHash: () => undefined,
				removeNewBlockTxs: async () => undefined,
			}),
			getVm: async () => vm,
		},
		blockBuilder,
		canonicalBlock,
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

const SIMULATION_STATE_ROOT: Hex = `0x${'0a'.repeat(32)}`

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
		await mineNextSimulationBlock(memoryClient)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS)

		await advanceSimulationTime(memoryClient, 5n)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS + 5n)

		await advanceSimulationTime(memoryClient, 0n)
		expect(await getSimulationChainTimestamp(memoryClient)).toBe(SIMULATION_INITIAL_TIMESTAMP + SIMULATION_BLOCK_INTERVAL_SECONDS * 2n + 5n)
	})

	test('throws when the transport is not a compatible Tevm node', async () => {
		const memoryClient = {
			getBlock: async () => ({ timestamp: 0n }),
			transport: {},
		} as never

		await expect(mineNextSimulationBlock(memoryClient)).rejects.toThrow('Simulation transport did not expose a compatible Tevm node')
	})

	test('throws when mining a pending transaction that is missing from the tx pool', async () => {
		const { node } = createSimulationNode({
			blockStateRootHex: SIMULATION_STATE_ROOT,
			includeStateRoot: true,
			txForHash: { isFound: false },
		})

		const memoryClient = {
			getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
			transport: { tevm: node },
			impersonateAccount: async () => undefined,
			getStorageAt: async () => '0x',
			setStorageAt: async () => undefined,
			getCode: async () => '0x',
			setCode: async () => undefined,
			tevmReady: async () => undefined,
		}

		const txHash = '0x1234' as `0x${string}`

		await expect(minePendingSimulationTransactionAtTimestamp(memoryClient as never, txHash, SIMULATION_INITIAL_TIMESTAMP)).rejects.toThrow(`Simulation transaction ${txHash} was not found in the tx pool`)
	})

	test('throws when a mined simulation block has an unknown state root', async () => {
		const { node } = createSimulationNode({
			blockStateRootHex: SIMULATION_STATE_ROOT,
			includeStateRoot: false,
		})
		const memoryClient = {
			getBlock: async () => ({ timestamp: SIMULATION_INITIAL_TIMESTAMP }),
			transport: { tevm: node },
			impersonateAccount: async () => undefined,
			getStorageAt: async () => '0x',
			setStorageAt: async () => undefined,
			getCode: async () => '0x',
			setCode: async () => undefined,
			tevmReady: async () => undefined,
		}
		await expect(advanceSimulationTime(memoryClient as never, 1n)).rejects.toThrow('Simulation state root was not found after mining a block')
	})
})
