import { keccak256 } from '@zoltar/bot-shared/ethereum'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { PendingTransactionIntent } from '../state/operator-state.ts'
import { balanceObservations, captureBalanceEvidence, captureStorageEvidence, storageObservations } from './execution-evidence.ts'
import { agreedPendingNonce, executionReadClients, requiredConnectivity } from './execution-quorum.ts'
import { assertRequestedTransactionHash, type ExecutionEnvironment } from './execution-context.ts'
import { requireSuccessfulReceipt } from './receipt-validation.ts'
import { transactionMatchesIntent } from './recovery-policy.ts'

function baselineMap(intent: PendingTransactionIntent) {
	return new Map(intent.semanticExpectation.balanceBaselines.map(baseline => [`${baseline.account.toLowerCase()}:${baseline.asset === 'ETH' ? 'ETH' : baseline.asset.toLowerCase()}`, BigInt(baseline.balance)]))
}

function storageBaselineMap(intent: PendingTransactionIntent) {
	return new Map(intent.semanticExpectation.storageBaselines.map(baseline => [`${baseline.contract.toLowerCase()}:${baseline.functionName}:${JSON.stringify(baseline.args)}`, baseline.value]))
}

export async function recoveredReceiptObservations(environment: ExecutionEnvironment, intent: PendingTransactionIntent, receipt: ReturnType<typeof requireSuccessfulReceipt>) {
	const after = await captureBalanceEvidence(environment, intent.semanticExpectation.evidence, receipt.blockNumber)
	const afterStorage = await captureStorageEvidence(environment, intent.semanticExpectation.evidence, receipt.blockNumber)
	return {
		balances: balanceObservations(intent.semanticExpectation.evidence, baselineMap(intent), after),
		storage: storageObservations(intent.semanticExpectation.evidence, storageBaselineMap(intent), afterStorage),
	}
}

export async function agreedIntentPendingNonce(environment: ExecutionEnvironment, intent: PendingTransactionIntent, capableRpcUrls?: ReadonlySet<string> | undefined) {
	return agreedPendingNonce(environment, intent.sender, capableRpcUrls, `pending signer nonce for ${intent.hash}`)
}

export async function availableHeads(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const connectivity = requiredConnectivity(environment.settings)
	const settled = await Promise.allSettled(
		executionReadClients(environment).map(async ({ client, endpoint, rpcUrl }) => ({
			endpoint,
			head: await client.getBlockNumber(),
			rpcUrl,
		})),
	)
	const heads = availableSettledValues(settled)
	if (heads.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`Transaction ${intent.hash} recovery does not satisfy the configured RPC quorum requirement`)
	}
	return heads
}

export async function assertRecoveryChain(environment: ExecutionEnvironment) {
	const connectivity = requiredConnectivity(environment.settings)
	await settledQuorumValue(
		'pending transaction recovery chain ID',
		executionReadClients(environment).map(async ({ client, endpoint }) => {
			const chainId = await client.getChainId()
			if (chainId !== environment.settings.network.chainId) {
				throw new Error(`RPC ${endpoint} returned chain ID ${chainId.toString()}, expected ${environment.settings.network.chainId.toString()}`)
			}
			return { endpoint, value: chainId }
		}),
		connectivity.rpcQuorum,
	)
}

export function assertIntentIdentity(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	if (intent.sender.toLowerCase() !== environment.sender.toLowerCase()) {
		throw new Error(`Pending transaction ${intent.hash} belongs to a different signer`)
	}
	if (keccak256(intent.serializedTransaction).toLowerCase() !== intent.hash.toLowerCase()) {
		throw new Error(`Pending transaction ${intent.hash} does not match its signed bytes`)
	}
}

export async function exactIntentIsVisible(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const connectivity = requiredConnectivity(environment.settings)
	const settled = await Promise.allSettled(
		executionReadClients(environment).map(async ({ client }) => {
			try {
				const transaction = await client.getTransaction({ hash: intent.hash })
				assertRequestedTransactionHash(transaction.hash, intent.hash, 'Pending intent lookup')
				if (!transactionMatchesIntent(transaction, intent)) {
					throw new Error(`Transaction ${intent.hash} does not match the persisted intent semantics`)
				}
				return true
			} catch (error) {
				if (error instanceof Error && (error.name === 'TransactionNotFoundError' || error.message.toLowerCase().includes('could not be found'))) {
					return false
				}
				throw error
			}
		}),
	)
	const observations = availableSettledValues(settled)
	if (observations.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError(`Transaction ${intent.hash} visibility does not satisfy the configured RPC quorum requirement`)
	}
	return observations.filter(Boolean).length >= connectivity.rpcQuorum
}
