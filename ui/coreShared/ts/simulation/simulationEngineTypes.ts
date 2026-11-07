import type { Address, Hash, Hex } from '@zoltar/core-shared/evm/ethereum'
import type { ChainBackend, ReadClient } from '../wallet/chainBackend.js'
import type { SimulationProviderRequest } from './simulationProvider.js'
import type { SimulationBootstrapParameters, SimulationWorkerState } from './tevmWorkerProtocol.js'

export type SimulationEngine = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	bootstrap(parameters?: SimulationBootstrapParameters): Promise<void>
	exportState(name: string): Promise<string>
	getAccounts(): Promise<readonly Address[]>
	getChainId(): Promise<string>
	getProfile(): ChainBackend['profile']
	getState(): SimulationWorkerState
	installSimulationProxyDeployer(parameters: { address: Address; runtimeCode: Hex }): Promise<void>
	mintRep(amount: bigint): Promise<void>
	advanceBlock(): Promise<void>
	patchSimulationGenesisRepToken(parameters: { repAddress: Address; zoltarAddress: Address }): Promise<void>
	request(parameters: SimulationProviderRequest): Promise<unknown>
	reset(): Promise<void>
	selectAccount(address: Address): Promise<void>
	setRepPerEthPrice(value: bigint): void
	setRepPerUsdcPrice(value: bigint): void
	setQueryDelayMilliseconds(value: number): void
	setTransactionDelayMilliseconds(value: number): void
	subscribe(handler: () => void): () => void
	waitForTransactionReceipt(hash: Hash): Promise<Awaited<ReturnType<ReadClient['getTransactionReceipt']>>>
	waitUntilReady(): Promise<void>
}
