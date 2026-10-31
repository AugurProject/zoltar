import type { Abi, AbiValue, Address, Hex } from '@zoltar/core-shared/evm/ethereum'

/** A minimal adapter keeps block-pinned accounting usable in browser and server clients. */
export type PortfolioReadClient = {
	getChainId(): Promise<number>
	getBlock(parameters?: { blockNumber?: bigint }): Promise<{ number?: bigint | undefined; hash?: Hex | undefined; timestamp: bigint }>
	readContract(parameters: { address: Address; abi: Abi; functionName: string; args?: readonly AbiValue[]; blockNumber: bigint }): Promise<unknown>
}
