import type { Address, Hash, Hex, TransactionReceipt } from 'viem'
import type { SimulationScenario } from './scenarios.js'
import type { SimulationInitialization, SimulationSource } from './savedStates.js'

export type SimulationWorkerState = {
	bootstrapError: string | undefined
	bootstrapLabel: string | undefined
	bootstrapProgress: number | undefined
	blockCountSinceReset: bigint
	currentScenario: SimulationScenario
	currentTimestamp: bigint
	currentSource: SimulationSource
	isBootstrapped: boolean
	isBootstrapping: boolean
	queryDelayMilliseconds: number
	repPerEthPrice: bigint
	repPerUsdcPrice: bigint
	selectedAccount: Address
	transactionCountSinceReset: bigint
	transactionDelayMilliseconds: number
}

export type SimulationWorkerCallMap = {
	advanceTime: { params: { seconds: bigint }; result: undefined }
	bootstrap: { params: undefined; result: undefined }
	exportState: { params: { name: string }; result: string }
	getAccounts: { params: undefined; result: readonly Address[] }
	getState: { params: undefined; result: SimulationWorkerState }
	installSimulationProxyDeployer: { params: { address: Address; runtimeCode: Hex }; result: undefined }
	mintRep: { params: { amount: bigint }; result: undefined }
	mineBlock: { params: undefined; result: undefined }
	patchSimulationGenesisRepToken: { params: { repAddress: Address; zoltarAddress: Address }; result: undefined }
	reset: { params: undefined; result: undefined }
	selectAccount: { params: { address: Address }; result: undefined }
	setRepPerEthPrice: { params: { value: bigint }; result: undefined }
	setRepPerUsdcPrice: { params: { value: bigint }; result: undefined }
	setQueryDelayMilliseconds: { params: { value: number }; result: undefined }
	setTransactionDelayMilliseconds: { params: { value: number }; result: undefined }
	waitForTransactionReceipt: { params: { hash: Hash }; result: TransactionReceipt }
	waitUntilReady: { params: undefined; result: undefined }
}

export type SimulationWorkerCallMethod = keyof SimulationWorkerCallMap
type SimulationWorkerCallResult = {
	[TMethod in SimulationWorkerCallMethod]: SimulationWorkerCallMap[TMethod]['result']
}[SimulationWorkerCallMethod]
type SimulationWorkerJsonValue = string | number | boolean | bigint | null | { [key: string]: SimulationWorkerJsonValue } | SimulationWorkerJsonValue[] | readonly SimulationWorkerJsonValue[]
export type SimulationWorkerResultValue = SimulationWorkerCallResult | SimulationWorkerJsonValue

type SimulationWorkerInitMessage = {
	initialization: SimulationInitialization
	type: 'init'
}

export type SimulationWorkerCallMessage = {
	[TMethod in SimulationWorkerCallMethod]: {
		id: number
		method: TMethod
		params: SimulationWorkerCallMap[TMethod]['params']
		type: 'call'
	}
}[SimulationWorkerCallMethod]

export type SimulationWorkerRpcMessage = {
	id: number
	method: string
	params: unknown
	type: 'rpc'
}

export type SimulationWorkerMessage = SimulationWorkerInitMessage | SimulationWorkerCallMessage | SimulationWorkerRpcMessage

type SimulationWorkerReadyEvent = {
	state: SimulationWorkerState
	type: 'ready'
}

type SimulationWorkerResultEvent = {
	id: number
	type: 'result'
	value: SimulationWorkerResultValue
}

type SimulationWorkerErrorEvent = {
	id?: number
	message: string
	type: 'error'
}

type SimulationWorkerStateEvent = {
	state: SimulationWorkerState
	type: 'state'
}

export type SimulationWorkerEvent = SimulationWorkerErrorEvent | SimulationWorkerReadyEvent | SimulationWorkerResultEvent | SimulationWorkerStateEvent
