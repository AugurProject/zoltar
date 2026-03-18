import { EIP1193Provider } from 'viem'
import { StateOverrides } from './types/ethSimulateTypes.js'
import { BlockTimeManipulation } from './types/visualizerTypes.js'
import { GetBlockReturn } from './types/jsonRpcTypes.js'
import { dateToBigintSeconds } from './utils/bigint.js'

export interface MockWindowEthereum extends EIP1193Provider {
	addStateOverrides: (stateOverrides: StateOverrides) => Promise<void>
	manipulateTime: (blockTimeManipulation: BlockTimeManipulation) => Promise<void>
	getTime: () => Promise<bigint>
	getBlock: () => Promise<GetBlockReturn>
	advanceTime: (amountInSeconds: bigint) => Promise<void>
	setTime: (timestamp: bigint) => Promise<void>
	impersonateAccount: (address: string) => Promise<void>
}

export const getMockedEthSimulateWindowEthereum = async (): Promise<MockWindowEthereum> => {
	const ANVIL_RPC = process.env['ANVIL_RPC'] || 'http://host.docker.internal:8545' || 'http://localhost:8545'

	// Make JSON-RPC request to Anvil
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
				id: 0,
				method: args.method,
				params: args.params || [],
			}),
		})
		if (!response.ok) throw new Error(`HTTP ${ response.status }: ${ response.statusText }`)
		const json = (await response.json()) as unknown as {
			jsonrpc: '2.0'
			id: number | string
			result?: unknown
			error?: { code: number; message: string; data?: unknown }
		}
		if (json.error !== undefined) {
			throw new Error(json.error.message || 'RPC error')
		}
		// For eth_getTransactionReceipt, return the receipt even if status === '0x0' (reverted)
		// Callers can check the status field themselves
		return json.result!
	}

	// Reset Anvil to a clean state before each test
	await request({ method: 'anvil_reset', params: [] })
	await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [0] })

	// Apply state overrides using Anvil admin methods
	const addStateOverrides = async (stateOverrides: StateOverrides) => {
		const bytesToHex = (bytes: Uint8Array) =>
			'0x' +
			Array.from(bytes)
				.map(b => b.toString(16).padStart(2, '0'))
				.join('')
		for (const address of Object.keys(stateOverrides)) {
			const override = stateOverrides[address]!
			if (override.stateDiff !== undefined) {
				for (const [keyHex, value] of Object.entries(override.stateDiff) as [string, bigint][]) {
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

	const mock: MockWindowEthereum = {
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
	}

	return mock
}
