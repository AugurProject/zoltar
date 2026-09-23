import { type Account, type Address, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import type { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import type { OperatorSettings } from '../config/settings.ts'
import { EXECUTOR_FINALITY_BLOCKS } from '../operations/timing.ts'
import { type RuntimeState } from '../state/operator-state.ts'

type WriteClient = WalletClient<Transport, Chain, Account>

type RpcPool = ReturnType<typeof createRpcEndpointPool>

export const CHAOS_FINALITY_BLOCKS = EXECUTOR_FINALITY_BLOCKS

export class OperationRediscoveryRequired extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'OperationRediscoveryRequired'
	}
}

export type ExecutionEnvironment = {
	assertSubmissionReady?: (() => void) | undefined
	beforeBroadcast?: (() => Promise<void>) | undefined
	beforeSign?: (() => Promise<void>) | undefined
	chain: Chain
	clock?: (() => number) | undefined
	executionCancelled?: (() => boolean) | undefined
	/** Local-chain test override; live execution proceeds at canonical inclusion. */
	finalityBlocks?: bigint | undefined
	pool: RpcPool
	persistState?: ((state: RuntimeState) => Promise<void>) | undefined
	sender: Address
	settings: OperatorSettings
	state: RuntimeState
	wallet?: WriteClient | undefined
}

export type CanonicalExecutionAnchor = {
	attestingRpcUrls: ReadonlySet<string>
	baseFeePerGas: bigint
	hash: Hex
	number: bigint
	timestamp: bigint
}

export type CanonicalCallAnchor = Pick<CanonicalExecutionAnchor, 'attestingRpcUrls' | 'number'>

export type ExactRpcTransaction = {
	data: Hex
	from: Address
	gas?: Hex | undefined
	maxFeePerGas?: Hex | undefined
	maxPriorityFeePerGas?: Hex | undefined
	to: Address
	value: Hex
}

export function assertRequestedTransactionHash(returnedHash: Hex, requestedHash: Hex, label: string) {
	if (returnedHash.toLowerCase() !== requestedHash.toLowerCase()) {
		throw new Error(`${label} returned transaction hash ${returnedHash}, expected ${requestedHash}`)
	}
}

export function requiredExecutionWallet(environment: ExecutionEnvironment) {
	const wallet = environment.wallet
	if (wallet === undefined) throw new Error('Transaction execution requires the configured signer')
	if (wallet.account.address.toLowerCase() !== environment.sender.toLowerCase()) {
		throw new Error('Execution signer does not match the configured transaction sender')
	}
	return wallet
}

export function assertExecutionActive(environment: ExecutionEnvironment) {
	if (environment.executionCancelled?.() === true) {
		throw new Error('Chaos bot shutdown requested before transaction submission')
	}
	if (!environment.settings.runtime.execute) throw new Error('Transaction execution is disabled')
	if (environment.settings.paused || environment.state.paused) throw new Error('Chaos bot paused before transaction submission')
	if (environment.state.pendingTransactions.length > 1) throw new Error('Multiple pending transaction intents require manual reconciliation')
}
