import { createPublicClient, parseTransaction, type Account, type Chain, type Hex, type TransactionReceipt, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges, latestLogRange, newestFirstScanRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import type { OperatorSettings } from '#config/settings'
import { stagedOperationOutcome } from '#core/staged-outcome'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS, requireRecoveredTransactionSuccess } from '#core/cycle-control'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import { initialRuntimeState, assertIntentSender, recordActivity, recoveredIntentCanBeResubmitted, resolveRecoveredIntentJournal, saveDurableState, type PendingStagedOperation } from '#state/operator-state'
import { validateReceiptExpectation } from '#execution/receipt-validation'

const MAXIMUM_RECOVERY_LOG_RANGE = 256n

export function stagedOperationRecoveryRanges(queuedBlock: bigint, head: bigint) {
	const recent = latestLogRange(head, MAXIMUM_RECOVERY_LOG_RANGE)
	return newestFirstScanRanges(recent.fromBlock > queuedBlock ? recent.fromBlock : queuedBlock, head, MAXIMUM_RECOVERY_LOG_RANGE)
}

export function recordStagedRecoveryChunk(pending: PendingStagedOperation, range: { fromBlock: bigint; toBlock: bigint }, outcome: PendingStagedOperation['candidateOutcome'], historical: boolean) {
	if (outcome !== undefined) {
		pending.candidateOutcome = outcome
		return
	}
	if (historical) {
		if (range.fromBlock === pending.queuedBlock) {
			pending.nextHistoricalBlock = undefined
			pending.historicalRecoveryComplete = true
		} else pending.nextHistoricalBlock = range.fromBlock - 1n
		return
	}
	pending.latestRecoveryBlock = range.toBlock > (pending.latestRecoveryBlock ?? 0n) ? range.toBlock : pending.latestRecoveryBlock
	if (pending.nextHistoricalBlock === undefined && !pending.historicalRecoveryComplete && range.fromBlock > pending.queuedBlock) pending.nextHistoricalBlock = range.fromBlock - 1n
}

export function recordStagedRecoveryGap(pending: PendingStagedOperation, cursorFromBlock: bigint, latestFromBlock: bigint) {
	if (latestFromBlock <= cursorFromBlock) return
	const newestMissingBlock = latestFromBlock - 1n
	if (pending.nextHistoricalBlock === undefined || newestMissingBlock > pending.nextHistoricalBlock) pending.nextHistoricalBlock = newestMissingBlock
	pending.historicalRecoveryComplete = false
}

export function nextStagedHistoricalRecoveryRange(pending: PendingStagedOperation, maximumBlocks: bigint) {
	if (pending.nextHistoricalBlock === undefined || pending.nextHistoricalBlock < pending.queuedBlock) return undefined
	const availableBlocks = pending.nextHistoricalBlock - pending.queuedBlock + 1n
	const requestedBlocks = maximumBlocks < availableBlocks ? maximumBlocks : availableBlocks
	return {
		fromBlock: pending.nextHistoricalBlock - requestedBlocks + 1n,
		toBlock: pending.nextHistoricalBlock,
	}
}

export function stagedRecoveryAnchorMatches(pending: Pick<PendingStagedOperation, 'recoveryAnchorBlock' | 'recoveryAnchorHash'>, head: bigint, observedHash: Hex | undefined) {
	if (pending.recoveryAnchorBlock === undefined || pending.recoveryAnchorHash === undefined) return true
	return pending.recoveryAnchorBlock <= head && observedHash?.toLowerCase() === pending.recoveryAnchorHash.toLowerCase()
}

function missingReceipt(error: unknown) {
	return error instanceof Error && error.message.includes('could not be found')
}

function recoveryReaders(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, pool: ReturnType<typeof createRpcEndpointPool>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	return {
		clients: endpoints.map(endpoint => ({
			client: createPublicClient({
				chain: wallet.chain,
				transport: pool.transportFor(endpoint),
			}),
			endpoint,
		})),
		endpoints,
	}
}

export async function finalizedReceiptWithQuorum(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, hash: Hex, pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])) {
	const readers = recoveryReaders(settings, wallet, pool)
	const result = await settledQuorumValue<{
		evidence:
			| {
					blockHash: Hex
					blockNumber: bigint
					hash: Hex
					logs: { address: `0x${string}`; data: Hex; topics: readonly Hex[] }[]
					status: 'reverted' | 'success'
			  }
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
							logs: receipt.logs.map(log => ({
								address: log.address,
								data: log.data,
								topics: log.topics,
							})),
							status: receipt.status,
						},
						receipt,
					},
				}
			} catch (error) {
				if (missingReceipt(error))
					return {
						endpoint,
						value: { evidence: undefined, receipt: undefined },
					}
				throw error
			}
		}),
		settings.connectivity.rpcQuorum,
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
			undefined,
			settings.connectivity.rpcQuorum,
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
			clients.map(async ({ client, endpoint }) => ({
				endpoint,
				value: await client.getTransactionCount({
					address: intent.sender,
					blockTag: 'pending',
				}),
			})),
			settings.connectivity.rpcQuorum,
		)
		if (nonce > intent.nonce) {
			throw new Error(`Transaction ${intent.hash} has no receipt but signer nonce ${intent.nonce.toString()} was consumed; manual reconciliation is required`)
		}
		const settledBlocks = await Promise.allSettled(clients.map(async ({ client }) => await client.getBlockNumber()))
		const blocks = availableSettledValues(settledBlocks)
		if (blocks.length < settings.connectivity.rpcQuorum) throw new ConnectivityDegradedError(`Transaction ${intent.hash} recovery does not satisfy the configured RPC quorum requirement`)
		const recoveryAction = ambiguousRecoveryAction(intent, blocks)
		if (recoveryAction === 'expire-private') {
			await canonicalBlockHash(settings, intent.maxBlockNumber + PRIVATE_INTENT_FINALITY_BLOCKS, pool)
			state.pendingTransactions = state.pendingTransactions.filter(value => value.hash.toLowerCase() !== intent.hash.toLowerCase())
			recordActivity(state, {
				hash: intent.hash,
				kind: intent.kind,
				message: `Private price-dependent intent expired after canonical finality without inclusion: ${intent.label}`,
				status: 'failed',
			})
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
		if (heads.length < settings.connectivity.rpcQuorum) throw new ConnectivityDegradedError(`Staged operation ${pending.operationId.toString()} recovery does not satisfy the configured RPC quorum requirement`)
		const toBlock = heads.reduce((minimum, head) => (head < minimum ? head : minimum))
		const canonicalRecoveryHash = async (blockNumber: bigint) =>
			await settledQuorumValue(
				`staged operation ${pending.operationId.toString()} recovery anchor ${blockNumber.toString()}`,
				clients.map(async ({ client, endpoint }) => {
					const block = await client.getBlock({ blockNumber })
					if (block.hash === null) throw new Error(`Recovery anchor block ${blockNumber.toString()} is missing its hash`)
					return { endpoint, value: block.hash }
				}),
				settings.connectivity.rpcQuorum,
			)
		let observedRecoveryAnchor: Hex | undefined
		if (pending.recoveryAnchorBlock !== undefined && pending.recoveryAnchorBlock <= toBlock) observedRecoveryAnchor = await canonicalRecoveryHash(pending.recoveryAnchorBlock)
		if (!stagedRecoveryAnchorMatches(pending, toBlock, observedRecoveryAnchor)) {
			delete pending.candidateOutcome
			pending.historicalRecoveryComplete = undefined
			pending.latestRecoveryBlock = undefined
			pending.nextHistoricalBlock = undefined
			pending.recoveryAnchorBlock = undefined
			pending.recoveryAnchorHash = undefined
			await saveDurableState(settings.runtime.stateFile, state)
		}
		const retainRecoveryAnchor = async (blockNumber: bigint) => {
			const anchorBlock = pending.recoveryAnchorBlock !== undefined && pending.recoveryAnchorBlock > blockNumber ? pending.recoveryAnchorBlock : blockNumber
			pending.recoveryAnchorBlock = anchorBlock
			pending.recoveryAnchorHash = await canonicalRecoveryHash(anchorBlock)
		}
		let outcome:
			| (NonNullable<ReturnType<typeof stagedOperationOutcome>> & {
					blockHash: Hex
					blockNumber: bigint
					transactionHash: Hex
			  })
			| undefined = pending.candidateOutcome
		const scanRange = async (range: { fromBlock: bigint; toBlock: bigint }) => {
			const outcomes = await settledQuorumValue(
				`staged operation ${pending.operationId.toString()} blocks ${range.fromBlock.toString()}-${range.toBlock.toString()}`,
				clients.map(async ({ client, endpoint }) => {
					const logs = await fetchLogsWithAdaptiveRanges({ nextBlock: range.fromBlock }, range.toBlock, MAXIMUM_RECOVERY_LOG_RANGE, subRange =>
						client.getLogs({
							address: pending.coordinator,
							fromBlock: subRange.fromBlock,
							toBlock: subRange.toBlock,
						}),
					)
					return {
						endpoint,
						value: logs.flatMap(log => {
							const decoded = stagedOperationOutcome(log, pending.operationId)
							if (decoded === undefined) return []
							if (log.blockHash === undefined || log.blockNumber === undefined || log.transactionHash === undefined) throw new Error('Staged-operation outcome log is missing canonical identity')
							return [
								{
									...decoded,
									blockHash: log.blockHash,
									blockNumber: log.blockNumber,
									transactionHash: log.transactionHash,
								},
							]
						}),
					}
				}),
				settings.connectivity.rpcQuorum,
			)
			if (outcomes.length > 1) throw new Error(`Coordinator returned multiple outcomes for staged operation ${pending.operationId.toString()}`)
			return outcomes[0]
		}
		const maximumBlocks = BigInt(settings.runtime.logLookbackBlocks)
		const recent = latestLogRange(toBlock, maximumBlocks)
		const cursorFromBlock = pending.latestRecoveryBlock === undefined ? pending.queuedBlock : pending.latestRecoveryBlock + 1n
		const latestFromBlock = recent.fromBlock > cursorFromBlock ? recent.fromBlock : cursorFromBlock
		recordStagedRecoveryGap(pending, cursorFromBlock, latestFromBlock)
		if (outcome === undefined && latestFromBlock <= toBlock) {
			for (const range of newestFirstScanRanges(latestFromBlock, toBlock, maximumBlocks)) {
				outcome = await scanRange(range)
				recordStagedRecoveryChunk(pending, range, outcome, false)
				await retainRecoveryAnchor(range.toBlock)
				await saveDurableState(settings.runtime.stateFile, state)
				if (outcome !== undefined) break
			}
		}
		const historicalRange = nextStagedHistoricalRecoveryRange(pending, maximumBlocks)
		if (outcome === undefined && settings.runtime.historicalLogRecovery && historicalRange !== undefined) {
			const range = historicalRange
			outcome = await scanRange(range)
			recordStagedRecoveryChunk(pending, range, outcome, true)
			await retainRecoveryAnchor(range.toBlock)
			await saveDurableState(settings.runtime.stateFile, state)
		}
		if (outcome === undefined) continue
		if (outcome.operation !== 0n || outcome.operationId !== pending.operationId || typeof outcome.success !== 'boolean' || typeof outcome.errorMessage !== 'string') {
			throw new Error(`Coordinator returned an invalid outcome for staged operation ${pending.operationId.toString()}`)
		}
		let finalized: boolean
		try {
			finalized = await confirmCanonicalReceiptFinality(
				clients.map(entry => entry.client),
				endpoints,
				`staged operation ${pending.operationId.toString()}`,
				outcome,
				PRIVATE_INTENT_FINALITY_BLOCKS,
				toBlock,
				settings.connectivity.rpcQuorum,
			)
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('receipt is no longer canonical')) throw error
			delete pending.candidateOutcome
			await saveDurableState(settings.runtime.stateFile, state)
			continue
		}
		if (!finalized) continue
		delete pending.candidateOutcome
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
