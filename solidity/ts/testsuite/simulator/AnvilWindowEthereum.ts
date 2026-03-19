/* eslint @typescript-eslint/no-explicit-any: "off" */

import { EIP1193Provider } from 'viem'
import { dateToBigintSeconds } from './utils/bigint'
import { EthereumBlockHeader, EthereumBlockHeaderWithTransactionHashes } from './types/wire-types'
import type { EthereumBytes32, EthereumData, EthereumQuantity, EthereumQuantitySmall } from './types/wire-types'
import * as funtypes from 'funtypes'
import { ensureDefined } from './utils/testUtils'

type BlockTimeManipulation = { readonly type: 'AddToTimestamp', readonly deltaToAdd: EthereumQuantity } | { readonly type: 'SetTimestamp', readonly timeToSet: EthereumQuantity }

type AccountOverride = {
	readonly stateDiff?: Readonly<Record<string, EthereumBytes32>>
	readonly nonce?: EthereumQuantitySmall
	readonly balance?: EthereumQuantity
	readonly code?: EthereumData
}

type GetBlockReturn = funtypes.Static<typeof GetBlockReturn>
const GetBlockReturn = funtypes.Union(EthereumBlockHeader, EthereumBlockHeaderWithTransactionHashes)

type StateOverrides = Readonly<Record<string, AccountOverride>>

export interface AnvilWindowEthereum extends EIP1193Provider {
	addStateOverrides: (stateOverrides: StateOverrides) => Promise<void>
	manipulateTime: (blockTimeManipulation: BlockTimeManipulation) => Promise<void>
	getTime: () => Promise<bigint>
	getBlock: () => Promise<GetBlockReturn>
	advanceTime: (amountInSeconds: bigint) => Promise<void>
	setTime: (timestamp: bigint) => Promise<void>
	impersonateAccount: (address: string) => Promise<void>
	setBalance: (address: string, amount: bigint) => Promise<void>
	anvilSnapshot: () => Promise<string>
	anvilRevert: (snapshotId: string) => Promise<void>
}

export const getMockedEthSimulateWindowEthereum = async (): Promise<AnvilWindowEthereum> => {
	const ANVIL_RPC = process.env['ANVIL_RPC'] || 'http://host.docker.internal:8545' || 'http://localhost:8545'

	// Validate RPC endpoint points to localhost only for test security
	const validateLocalhostUrl = (url: string): void => {
		try {
			const parsed = new URL(url)
			const allowedHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']
			if (!allowedHosts.includes(parsed.hostname)) {
				throw new Error(
					`ANVIL_RPC points to unauthorized host '${ parsed.hostname }'. ` +
					`Test RPC endpoints must be localhost (localhost, 127.0.0.1, ::1, host.docker.internal). ` +
					`Set ANVIL_RPC to a local Anvil instance.`
				)
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('unauthorized')) {
				throw error
			}
			throw new Error(`Invalid ANVIL_RPC URL: ${ url }. Must be a valid HTTP URL.`)
		}
	}
	validateLocalhostUrl(ANVIL_RPC)

	// Make JSON-RPC request to Anvil
	let requestId = 0
	const request = async (args: { method: string; params?: unknown[] }): Promise<unknown> => {
		// For eth_sendTransaction, simulate first to catch reverts early
		if (args.method === 'eth_sendTransaction' && args.params?.[0]) {
			try {
				// Simulate the transaction with eth_call (readonly) to see if it would revert
				await request({ method: 'eth_call', params: [args.params[0], 'latest'] })
			} catch (simulationError: unknown) {
				// Simulation failed, so the transaction would revert - throw the same error
				throw simulationError
			}
		}

		const response = await fetch(ANVIL_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId++,
				method: args.method,
				params: args.params || [],
			}),
		})
		if (!response.ok) throw new Error(`HTTP ${ response.status }: ${ response.statusText }`)
		const raw = await response.json()
		if (typeof raw !== 'object' || raw === null) {
			throw new Error('Invalid JSON-RPC response: not an object')
		}
		const json = raw as {
			jsonrpc: string
			id: number | string
			result?: unknown
			error?: { code: number; message: string; data?: unknown }
		}

		// Validate JSON-RPC response structure
		if (json.jsonrpc !== '2.0') {
			throw new Error(`Invalid JSON-RPC version: expected '2.0', got '${ json.jsonrpc }'`)
		}
		if (json.id === undefined) {
			throw new Error('Invalid JSON-RPC response: missing id field')
		}

		// Ensure exactly one of result or error is present (per JSON-RPC spec)
		const hasResult = 'result' in json
		const hasError = 'error' in json
		if (hasResult && hasError) {
			throw new Error('Invalid JSON-RPC response: both result and error present')
		}
		if (!hasResult && !hasError) {
			throw new Error('Invalid JSON-RPC response: neither result nor error present')
		}

		if (json.error !== undefined) {
			throw new Error(json.error.message || 'RPC error')
		}
		// For eth_getTransactionReceipt, return the receipt even if status === '0x0' (reverted)
		// Callers can check the status field themselves
		ensureDefined(json.result, 'json.result is undefined')
		return json.result
	}

	// Reset Anvil to a clean state before each test
	await request({ method: 'anvil_reset', params: [] })
	await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })

	// Apply state overrides using Anvil admin methods
	const addStateOverrides = async (stateOverrides: StateOverrides) => {
		const bytesToHex = (bytes: Uint8Array) =>
			'0x' +
			Array.from(bytes)
				.map(b => b.toString(16).padStart(2, '0'))
				.join('')
		for (const address of Object.keys(stateOverrides)) {
			const override = stateOverrides[address]
			if (override === undefined) continue
			if (override.stateDiff !== undefined) {
				for (const [keyHex, value] of Object.entries(override.stateDiff)) {
					await request({
						method: 'anvil_setStorageAt',
						params: [address, keyHex, `0x${ value.toString(16).padStart(64, '0') }`],
					})
				}
			}
			if (override.balance !== undefined) {
				await request({
					method: 'anvil_setBalance',
					params: [address, `0x${ override.balance.toString(16) }`],
				})
			}
			if (override.code !== undefined) {
				await request({
					method: 'anvil_setCode',
					params: [address, bytesToHex(override.code)],
				})
			}
			if (override.nonce !== undefined) {
				await request({
					method: 'anvil_setNonce',
					params: [address, `0x${ override.nonce.toString(16) }`],
				})
			}
		}
	}

	// Time manipulation
	const manipulateTime = async (blockTimeManipulation: BlockTimeManipulation) => {
		if (blockTimeManipulation.type === 'AddToTimestamp') {
			await request({
				method: 'evm_increaseTime',
				params: [`0x${ blockTimeManipulation.deltaToAdd.toString(16) }`],
			})
			await request({ method: 'evm_mine', params: [] })
		} else if (blockTimeManipulation.type === 'SetTimestamp') {
			await request({
				method: 'evm_setNextBlockTimestamp',
				params: [`0x${ blockTimeManipulation.timeToSet.toString(16) }`],
			})
			await request({ method: 'evm_mine', params: [] })
		}
	}

	const getTime = async (): Promise<bigint> => {
		const block = await getBlock()
		if (block === null) {
			throw new Error('Failed to get block')
		}
		// block.timestamp is a Date after parsing
		return dateToBigintSeconds(block.timestamp)
	}

	const getBlock = async (): Promise<GetBlockReturn> => {
		const raw = await request({ method: 'eth_getBlockByNumber', params: ['latest', false] })
		// Parse the raw JSON through GetBlockReturn parser to convert timestamps, etc.
		return GetBlockReturn.parse(raw)
	}

	const advanceTime = async (amountInSeconds: bigint) => {
		await manipulateTime({ type: 'AddToTimestamp', deltaToAdd: amountInSeconds })
	}

	const setTime = async (timestamp: bigint) => {
		await manipulateTime({ type: 'SetTimestamp', timeToSet: timestamp })
	}

	const impersonateAccount = async (address: string) => {
		await request({
			method: 'anvil_impersonateAccount',
			params: [address],
		})
	}

	const setBalance = async (address: string, amount: bigint) => {
		await request({
			method: 'anvil_setBalance',
			params: [address, `0x${ amount.toString(16) }`],
		})
	}

	const anvilSnapshot = async (): Promise<string> => {
		const result = await request({ method: 'anvil_snapshot', params: [] })
		return result as string
	}

	const anvilRevert = async (snapshotId: string): Promise<void> => {
		await request({ method: 'anvil_revert', params: [snapshotId] })
	}

	const mock: AnvilWindowEthereum = {
		async request(args: any): Promise<any> {
			return await request(args)
		},
		on: () => {},
		removeListener: () => {},
		addStateOverrides,
		manipulateTime,
		getTime,
		getBlock,
		advanceTime,
		setTime,
		impersonateAccount,
		setBalance,
		anvilSnapshot,
		anvilRevert,
	}

	return mock
}
