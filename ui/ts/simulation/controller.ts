import type { Address } from '@zoltar/shared/ethereum'
import type { SimulationScenario } from './scenarios.js'
import type { SimulationSource } from './savedStates.js'

export type SimulationController = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	bootstrapError: string | undefined
	bootstrapLabel: string | undefined
	bootstrapProgress: number | undefined
	blockCountSinceReset: bigint
	currentTimestamp: bigint
	currentScenario: SimulationScenario
	dispose(): Promise<void>
	exportState(name: string): Promise<string>
	isActive: true
	isBootstrapped: boolean
	isBootstrapping: boolean
	mintRep(amount: bigint): Promise<void>
	mineBlock(): Promise<void>
	queryDelayMilliseconds: number
	repPerEthPrice: bigint
	repPerUsdcPrice: bigint
	reset(): Promise<void>
	selectAccount(address: Address): Promise<void>
	selectedAccount: Address
	simulationSource: SimulationSource
	setRepPerEthPrice(value: bigint): Promise<void>
	setRepPerUsdcPrice(value: bigint): Promise<void>
	setQueryDelayMilliseconds(value: number): Promise<void>
	subscribe(handler: () => void): () => void
	transactionCountSinceReset: bigint
	transactionDelayMilliseconds: number
	setTransactionDelayMilliseconds(value: number): Promise<void>
	waitUntilReady(): Promise<void>
}
