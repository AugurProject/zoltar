import type { Address } from 'viem'
import type { SimulationScenario } from './scenarios.js'

export type SimulationController = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	bootstrapError: string | undefined
	bootstrapLabel: string | undefined
	bootstrapProgress: number | undefined
	blockCountSinceReset: bigint
	currentTimestamp: bigint
	currentScenario: SimulationScenario
	isActive: true
	isBootstrapped: boolean
	isBootstrapping: boolean
	mineBlock(): Promise<void>
	queryDelayMilliseconds: number
	reset(): Promise<void>
	selectAccount(address: Address): Promise<void>
	selectedAccount: Address
	setQueryDelayMilliseconds(value: number): void
	subscribe(handler: () => void): () => void
	transactionCountSinceReset: bigint
	transactionDelayMilliseconds: number
	setTransactionDelayMilliseconds(value: number): void
	waitUntilReady(): Promise<void>
}
