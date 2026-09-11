import { bytesToHex, decodeFunctionData, encodeAbiParameters, getAddress, hexToBytes, isHex, type Address, type EIP1193Provider, type Hex } from '@zoltar/bot-shared/ethereum'

const aggregate3Abi = [
	{
		type: 'function',
		name: 'aggregate3',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'calls',
				type: 'tuple[]',
				components: [
					{ name: 'target', type: 'address' },
					{ name: 'allowFailure', type: 'bool' },
					{ name: 'callData', type: 'bytes' },
				],
			},
		],
		outputs: [
			{
				name: 'returnData',
				type: 'tuple[]',
				components: [
					{ name: 'success', type: 'bool' },
					{ name: 'returnData', type: 'bytes' },
				],
			},
		],
	},
] as const

export type ContractCall = { blockTag: unknown; data: Hex; to: Address }

function requiredHex(value: string): Hex {
	if (!isHex(value, { strict: true })) throw new Error(`Contract call data is not hex: ${value}`)
	return bytesToHex(hexToBytes(value))
}

/**
 * Serves `eth_call` requests to Multicall3 `aggregate3` by dispatching every inner call to `handleCall`
 * so tests keep describing one contract read at a time. A thrown error becomes a reverted entry.
 */
export function multicallProvider(multicall3: Address, handleCall: (call: ContractCall) => Hex | Promise<Hex>, fallback?: (parameters: { method: string; params?: unknown }) => unknown): EIP1193Provider {
	return {
		request: async parameters => {
			if (parameters.method === 'eth_call' && Array.isArray(parameters.params)) {
				const request = parameters.params[0]
				if (typeof request === 'object' && request !== null && 'to' in request && 'data' in request && typeof request.to === 'string' && typeof request.data === 'string') {
					const to = getAddress(request.to)
					const data = requiredHex(request.data)
					const blockTag = parameters.params[1]
					if (to.toLowerCase() === multicall3.toLowerCase()) {
						const decoded = decodeFunctionData({ abi: aggregate3Abi, data })
						const results = await Promise.all(
							decoded.args[0].map(async call => {
								try {
									return { returnData: await handleCall({ blockTag, data: call.callData, to: getAddress(call.target) }), success: true }
								} catch (error) {
									if (!call.allowFailure) throw error
									// A thrown handler error is surfaced the way a reverting contract would: as `Error(string)` revert data.
									return { returnData: `0x08c379a0${encodeAbiParameters([{ type: 'string' }], [error instanceof Error ? error.message : String(error)]).slice(2)}` as Hex, success: false }
								}
							}),
						)
						return encodeAbiParameters(aggregate3Abi[0].outputs, [results])
					}
					return await handleCall({ blockTag, data, to })
				}
			}
			if (fallback === undefined) throw new Error(`Unexpected RPC method ${parameters.method}`)
			return fallback(parameters)
		},
	}
}
