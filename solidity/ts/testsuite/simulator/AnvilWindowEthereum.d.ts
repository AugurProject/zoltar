import type { EthereumBytes32, EthereumData, EthereumQuantity, EthereumQuantitySmall } from './types/wire-types'
type BlockTimeManipulation =
	| {
			readonly type: 'AddToTimestamp'
			readonly deltaToAdd: EthereumQuantity
	  }
	| {
			readonly type: 'SetTimestamp'
			readonly timeToSet: EthereumQuantity
	  }
type AccountOverride = {
	readonly stateDiff?: Readonly<Record<string, EthereumBytes32>>
	readonly nonce?: EthereumQuantitySmall
	readonly balance?: EthereumQuantity
	readonly code?: EthereumData
}
type GetBlockReturn = {
	readonly timestamp: bigint
}
type StateOverrides = Readonly<Record<string, AccountOverride>>
export interface AnvilWindowEthereum {
	addStateOverrides: (stateOverrides: StateOverrides) => Promise<void>
	manipulateTime: (blockTimeManipulation: BlockTimeManipulation) => Promise<void>
	getTime: () => Promise<bigint>
	getBlock: () => Promise<GetBlockReturn>
	advanceTime: (amountInSeconds: bigint) => Promise<void>
	setTime: (timestamp: bigint) => Promise<void>
	resetToCleanState: () => Promise<void>
	setNextBlockBaseFeePerGasToZero: () => Promise<void>
	impersonateAccount: (address: string) => Promise<void>
	setBalance: (address: string, amount: bigint) => Promise<void>
	anvilSnapshot: () => Promise<string>
	anvilRevert: (snapshotId: string) => Promise<void>
	request: (args: { method: string; params?: unknown }) => Promise<unknown>
	on: () => void
	removeListener: () => void
}
export declare const getDefaultAnvilRpcUrl: () => string
export declare const getMockedEthSimulateWindowEthereum: (rpcUrl?: string) => Promise<AnvilWindowEthereum>
export {}
//# sourceMappingURL=AnvilWindowEthereum.d.ts.map
