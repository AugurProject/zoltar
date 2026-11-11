import { registerSponsoredReplacement } from '#execution/sponsored-report-receipt'
import { PRIVATE_INTENT_FINALITY_BLOCKS } from '#core/cycle-control'
import { parseTransactionReconciliation, validateReconciliationIntentChain, verifyFinalizedReplacement } from '#core/transaction-reconciliation'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { commitReconciledIntent } from '#state/operator-state'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { isReceiptNotFound, receiptEvidence } from '@zoltar/bot-shared/execution/receipt-quorum'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { readEndpoints, type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'

/** Resolves a paused pending intent to its finalized replacement transaction, verified under the RPC quorum. */
export function reconcileTransaction(runtime: Pick<LiquidatorRuntime, 'settings' | 'chain' | 'readPool'>, deps: Pick<LiquidatorDeps, 'state' | 'configurationMutationGate'>, value: unknown) {
	return deps.configurationMutationGate.run(async () => {
		const { state } = deps
		if (!state.paused) throw new Error('Pause the bot before reconciling a replacement transaction')
		const request = parseTransactionReconciliation(value)
		const intent = state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === request.intentHash.toLowerCase())
		if (intent === undefined) throw new Error('Pending transaction intent was not found')
		validateReconciliationIntentChain(intent.serializedTransaction, runtime.settings.network.chainId)
		const endpoints = readEndpoints(runtime.settings)
		const replacementEvidence = await settledQuorumValue(
			`replacement transaction ${request.replacementHash}`,
			endpoints.map(async endpoint => {
				const rpc = createPublicClient({ chain: runtime.chain, transport: runtime.readPool.transportFor(endpoint) })
				try {
					const [receipt, transaction] = await Promise.all([rpc.getTransactionReceipt({ hash: request.replacementHash }), rpc.getTransaction({ hash: request.replacementHash })])
					if (receipt.blockHash === null) throw new Error('Replacement receipt is missing its block hash')
					if (receipt.transactionHash.toLowerCase() !== request.replacementHash.toLowerCase() || transaction.hash.toLowerCase() !== request.replacementHash.toLowerCase()) throw new Error('Replacement RPC returned another transaction')
					return {
						endpoint,
						value: {
							receipt: receiptEvidence(receipt),
							transaction: { to: transaction.to ?? undefined, input: transaction.input, value: transaction.value },
							blockHash: receipt.blockHash,
							blockNumber: receipt.blockNumber,
							from: transaction.from,
							hash: transaction.hash,
							nonce: transaction.nonce,
							status: receipt.status,
						},
					}
				} catch (error) {
					if (isReceiptNotFound(error)) return { endpoint, value: undefined }
					throw error
				}
			}),
			runtime.settings.connectivity.rpcQuorum,
		)
		const replacement = await verifyFinalizedReplacement(intent, request.replacementHash, PRIVATE_INTENT_FINALITY_BLOCKS, {
			canonicalBlockHash: async blockNumber => await canonicalBlockHash(runtime.settings, blockNumber, runtime.readPool),
			currentHeads: async () => {
				const settled = await Promise.allSettled(endpoints.map(async endpoint => await createPublicClient({ chain: runtime.chain, transport: runtime.readPool.transportFor(endpoint) }).getBlockNumber()))
				const heads = availableSettledValues(settled)
				if (heads.length < runtime.settings.connectivity.rpcQuorum) throw new ConnectivityDegradedError('Replacement reconciliation does not satisfy the configured RPC quorum requirement')
				return heads
			},
			replacement: async () => replacementEvidence,
		})
		const reconciledState = { ...state, sponsoredReports: [...(state.sponsoredReports ?? [])] }
		if (replacementEvidence !== undefined) registerSponsoredReplacement(reconciledState, intent, replacementEvidence.receipt, replacementEvidence.transaction)
		await commitReconciledIntent(runtime.settings.runtime.stateFile, reconciledState, intent.hash, {
			details: `original=${intent.hash} replacement=${replacement.hash} nonce=${intent.nonce.toString()} replacementStatus=${replacement.status}`,
			hash: replacement.hash,
			kind: 'recovery',
			message: `Finalized replacement reconciled: ${intent.label}`,
			status: 'confirmed',
		})
		state.sponsoredReports = reconciledState.sponsoredReports
		state.activities = reconciledState.activities
		state.pendingTransactions = reconciledState.pendingTransactions
		return { intentHash: intent.hash, replacementHash: replacement.hash, replacementStatus: replacement.status }
	})
}
