import type { Address } from 'viem'
import type { SimulationScenario } from './scenarios.js'

export type SimulationController = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	blockCountSinceReset: bigint
	currentTimestamp: bigint
	currentScenario: SimulationScenario
	isActive: true
	mineBlock(): Promise<void>
	reset(): Promise<void>
	selectAccount(address: Address): Promise<void>
	selectedAccount: Address
	subscribe(handler: () => void): () => void
	transactionCountSinceReset: bigint
	transactionDelayMilliseconds: number
	setTransactionDelayMilliseconds(value: number): void
}
