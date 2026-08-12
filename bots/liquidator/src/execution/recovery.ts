import { createPublicClient, http, parseTransaction, type Account, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { scanRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import type { OperatorSettings } from '#config/settings'
import { stagedOperationOutcome } from '#core/staged-outcome'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS, requireRecoveredTransactionSuccess } from '#core/cycle-control'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { initialRuntimeState, assertIntentSender, recordActivity, recoveredIntentCanBeResubmitted, resolveRecoveredIntentJournal, saveDurableState } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'

const MAXIMUM_RECOVERY_LOG_RANGE = 10_000n

export function stagedOperationRecoveryRanges(queuedBlock: bigint, head: bigint) {
	return scanRanges({ nextBlock: queuedBlock }, head, MAXIMUM_RECOVERY_LOG_RANGE)
}

function missingReceipt(error: unknown) {
	return error instanceof Error && error.message.includes('could not be found')
}

export async function finalizedReceiptWithQuorum(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, hash: Hex) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	const clients = endpoints.map(endpoint => createPublicClient({ chain: wallet.chain, transport: http(endpoint) }))
	const results = await Promise.all(
		clients.map(async (client, index) => {
			try {
				const receipt = await client.getTransactionReceipt({ hash })
				return {
					endpoint: endpoints[index] ?? '',
					receipt,
					value: {
						blockHash: receipt.blockHash,
						blockNumber: receipt.blockNumber,
						hash: receipt.transactionHash,
						logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
						status: receipt.status,
					},
				}
			} catch (error) {
				if (missingReceipt(error)) return { endpoint: endpoints[index] ?? '', receipt: undefined, value: undefined }
				throw error
			}
		}),
	)
	const evidence = quorumValue(
		`receipt ${hash}`,
		results.map(result => ({ endpoint: result.endpoint, value: result.value })),
	)
	if (evidence === undefined) return { observed: false as const, receipt: undefined }
	const receipt = results.find(result => result.receipt?.transactionHash.toLowerCase() === evidence.hash.toLowerCase())?.receipt
	if (receipt === undefined) throw new Error(`Quorum receipt ${hash} was not available for semantic validation`)
	if (!(await confirmCanonicalReceiptFinality(clients, endpoints, `transaction ${hash}`, receipt, PRIVATE_INTENT_FINALITY_BLOCKS))) return { observed: true as const, receipt: undefined }
	return { observed: true as const, receipt }
}

export async function recoverPendingTransactions(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	for (const intent of [...state.pendingTransactions]) {
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
		const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, intent.hash)
		const receipt = receiptResult.receipt
		if (receipt !== undefined) {
			const receiptOutcome = receipt.status === 'success' ? validateReceiptExpectation(receipt, intent.receiptExpectation) : { queuedOperationId: undefined }
			if (receiptOutcome.queuedOperationId !== undefined && intent.receiptExpectation.type === 'pending-liquidation') {
				state.pendingStagedOperations.push({
					coordinator: intent.receiptExpectation.coordinator,
					operationId: receiptOutcome.queuedOperationId,
					queuedBlock: receipt.blockNumber,
					target: intent.receiptExpectation.target,
				})
			}
			resolveRecoveredIntentJournal(state, intent.hash, receipt.status)
			recordActivity(state, {
				hash: intent.hash,
				kind: intent.kind,
				message: receipt.status === 'success' ? `Recovered confirmation: ${intent.label}` : `Recovered revert: ${intent.label}`,
				status: receipt.status === 'success' ? 'confirmed' : 'failed',
			})
			await saveDurableState(settings.runtime.stateFile, state)
			requireRecoveredTransactionSuccess(receipt.status, intent.hash)
			continue
		}
		if (receiptResult.observed) return true
		const nonce = quorumValue(`pending signer nonce for ${intent.hash}`, await Promise.all(clients.map(async ({ client, endpoint }) => ({ endpoint, value: await client.getTransactionCount({ address: intent.sender, blockTag: 'pending' }) }))))
		if (nonce > intent.nonce) {
			throw new Error(`Transaction ${intent.hash} has no receipt but signer nonce ${intent.nonce.toString()} was consumed; manual reconciliation is required`)
		}
		const blocks = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		const recoveryAction = ambiguousRecoveryAction(intent, blocks)
		if (recoveryAction === 'expire-private') {
			await canonicalBlockHash(settings, intent.maxBlockNumber + PRIVATE_INTENT_FINALITY_BLOCKS)
			state.pendingTransactions = state.pendingTransactions.filter(value => value.hash.toLowerCase() !== intent.hash.toLowerCase())
			recordActivity(state, { hash: intent.hash, kind: intent.kind, message: `Private price-dependent intent expired after canonical finality without inclusion: ${intent.label}`, status: 'failed' })
			await saveDurableState(settings.runtime.stateFile, state)
			continue
		}
		if (recoveryAction === 'retain') {
			const recovery = intent.mode === 'public' ? 'manual reconciliation or a later receipt is required' : `private validity and ${PRIVATE_INTENT_FINALITY_BLOCKS.toString()} canonical confirmation blocks must pass`
			throw new Error(`Price-dependent transaction ${intent.hash} remains ambiguous; ${recovery}`)
		}
		if (!recoveredIntentCanBeResubmitted(intent)) throw new Error(`Price-dependent transaction ${intent.hash} cannot be resubmitted without fresh market evidence`)
		if (wallet.account.signMessage === undefined) throw new Error('Execution signer cannot authenticate transaction recovery')
		await submitSignedTransaction({
			address: intent.sender,
			hash: intent.hash,
			maxBlockNumber: intent.maxBlockNumber,
			publicRpcUrls: settings.connectivity.publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: intent.serializedTransaction,
			settings: settings.submission,
			signMessage: wallet.account.signMessage,
		})
		return true
	}
	return false
}

export async function reconcilePendingStagedOperations(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
	for (const pending of [...state.pendingStagedOperations]) {
		const heads = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		const toBlock = heads.reduce((minimum, head) => (head < minimum ? head : minimum))
		let outcome: (NonNullable<ReturnType<typeof stagedOperationOutcome>> & { blockHash: Hex; blockNumber: bigint; transactionHash: Hex }) | undefined
		for (const range of stagedOperationRecoveryRanges(pending.queuedBlock, toBlock)) {
			const observations = await Promise.all(
				clients.map(async ({ client, endpoint }) => ({
					endpoint,
					value: (await client.getLogs({ address: pending.coordinator, fromBlock: range.fromBlock, toBlock: range.toBlock })).flatMap(log => {
						const decoded = stagedOperationOutcome(log, pending.operationId)
						if (decoded === undefined) return []
						if (log.blockHash === undefined || log.blockNumber === undefined || log.transactionHash === undefined) throw new Error('Staged-operation outcome log is missing canonical identity')
						return [{ ...decoded, blockHash: log.blockHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash }]
					}),
				})),
			)
			const outcomes = quorumValue(`staged operation ${pending.operationId.toString()} blocks ${range.fromBlock.toString()}-${range.toBlock.toString()}`, observations)
			if (outcomes.length > 1) throw new Error(`Coordinator returned multiple outcomes for staged operation ${pending.operationId.toString()}`)
			outcome = outcomes[0]
			if (outcome !== undefined) break
		}
		if (outcome === undefined) continue
		if (outcome.operation !== 0n || outcome.operationId !== pending.operationId || typeof outcome.success !== 'boolean' || typeof outcome.errorMessage !== 'string') {
			throw new Error(`Coordinator returned an invalid outcome for staged operation ${pending.operationId.toString()}`)
		}
		if (
			!(await confirmCanonicalReceiptFinality(
				clients.map(entry => entry.client),
				endpoints,
				`staged operation ${pending.operationId.toString()}`,
				outcome,
				PRIVATE_INTENT_FINALITY_BLOCKS,
				toBlock,
			))
		)
			continue
		state.pendingStagedOperations = state.pendingStagedOperations.filter(operation => operation.coordinator.toLowerCase() !== pending.coordinator.toLowerCase() || operation.operationId !== pending.operationId)
		recordActivity(state, {
			details: `coordinator=${pending.coordinator} operation=${pending.operationId.toString()} target=${pending.target}`,
			kind: 'liquidation',
			message: outcome.success ? 'Staged liquidation settled successfully' : `Staged liquidation failed: ${outcome.errorMessage}`,
			status: outcome.success ? 'confirmed' : 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		if (!outcome.success) throw new Error(`Staged liquidation ${pending.operationId.toString()} failed: ${outcome.errorMessage}`)
	}
}
