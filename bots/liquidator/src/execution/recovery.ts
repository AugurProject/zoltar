import { createPublicClient, parseTransaction, type Account, type Chain, type Hex, type TransactionReceipt, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum/rpc-resilience'
import { scanRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
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

function recoveryReaders(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, pool: ReturnType<typeof createRpcEndpointPool>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	return {
		clients: endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: pool.transportFor(endpoint) }), endpoint })),
		endpoints,
	}
}

export async function finalizedReceiptWithQuorum(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, hash: Hex, pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])) {
	const readers = recoveryReaders(settings, wallet, pool)
	const result = await settledQuorumValue<{
		evidence:
			| { blockHash: Hex; blockNumber: bigint; hash: Hex; logs: { address: `0x${string}`; data: Hex; topics: readonly Hex[] }[]; status: 'reverted' | 'success' }
			| undefined
		receipt: TransactionReceipt | undefined
	}>(
		`receipt ${hash}`,
		readers.clients.map(async ({ client, endpoint }) => {
			try {
				const receipt = await client.getTransactionReceipt({ hash })
				return {
					endpoint,
					value: {
						evidence: {
							blockHash: receipt.blockHash,
							blockNumber: receipt.blockNumber,
							hash: receipt.transactionHash,
							logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
							status: receipt.status,
						},
						receipt,
					},
				}
			} catch (error) {
				if (missingReceipt(error)) return { endpoint, value: { evidence: undefined, receipt: undefined } }
				throw error
			}
		}),
	)
	if (result.evidence === undefined || result.receipt === undefined) return { observed: false as const, receipt: undefined }
	const receipt = result.receipt
	if (
		!(await confirmCanonicalReceiptFinality(
			readers.clients.map(reader => reader.client),
			readers.endpoints,
			`transaction ${hash}`,
			receipt,
			PRIVATE_INTENT_FINALITY_BLOCKS,
		))
	)
		return { observed: true as const, receipt: undefined }
	return { observed: true as const, receipt }
}

export async function recoverPendingTransactions(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>, pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])) {
	for (const intent of [...state.pendingTransactions]) {
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const { clients } = recoveryReaders(settings, wallet, pool)
		const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, intent.hash, pool)
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
		const nonce = await settledQuorumValue(
			`pending signer nonce for ${intent.hash}`,
			clients.map(async ({ client, endpoint }) => ({ endpoint, value: await client.getTransactionCount({ address: intent.sender, blockTag: 'pending' }) })),
		)
		if (nonce > intent.nonce) {
			throw new Error(`Transaction ${intent.hash} has no receipt but signer nonce ${intent.nonce.toString()} was consumed; manual reconciliation is required`)
		}
		const settledBlocks = await Promise.allSettled(clients.map(async ({ client }) => await client.getBlockNumber()))
		const blocks = availableSettledValues(settledBlocks)
		if (blocks.length < 2) throw new ConnectivityDegradedError(`Transaction ${intent.hash} recovery requires at least two available independent RPC endpoints`)
		const recoveryAction = ambiguousRecoveryAction(intent, blocks)
		if (recoveryAction === 'expire-private') {
			await canonicalBlockHash(settings, intent.maxBlockNumber + PRIVATE_INTENT_FINALITY_BLOCKS, pool)
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

export async function reconcilePendingStagedOperations(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>, pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])) {
	const { clients, endpoints } = recoveryReaders(settings, wallet, pool)
	for (const pending of [...state.pendingStagedOperations]) {
		const settledHeads = await Promise.allSettled(clients.map(async ({ client }) => await client.getBlockNumber()))
		const heads = availableSettledValues(settledHeads)
		if (heads.length < 2) throw new ConnectivityDegradedError(`Staged operation ${pending.operationId.toString()} recovery requires at least two available independent RPC endpoints`)
		const toBlock = heads.reduce((minimum, head) => (head < minimum ? head : minimum))
		let outcome: (NonNullable<ReturnType<typeof stagedOperationOutcome>> & { blockHash: Hex; blockNumber: bigint; transactionHash: Hex }) | undefined
		for (const range of stagedOperationRecoveryRanges(pending.queuedBlock, toBlock)) {
			const outcomes = await settledQuorumValue(
				`staged operation ${pending.operationId.toString()} blocks ${range.fromBlock.toString()}-${range.toBlock.toString()}`,
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
