import { createPublicClient, createWalletClient, encodeFunctionData, parseTransaction, type Account, type Chain, type Hex, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges, latestLogRange, newestFirstScanRanges } from '@zoltar/bot-shared/monitoring/block-sync'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { DEFAULT_TRANSACTION_VALIDITY_BLOCKS, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import type { OperatorSettings } from '#config/settings'
import { isPoolExecutionEligible } from '#core/fork-migration'
import { stagedOperationOutcome } from '#core/staged-outcome'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS } from '#core/cycle-control'
import { securityPoolAbi, securityPoolFactoryAbi } from '@zoltar/bot-shared/contracts/abi'
import type { PendingTransactionIntent } from '#state/operator-state'
import { initialRuntimeState, assertIntentSender, recordActivity, recoveredIntentCanBeResubmitted, saveDurableState } from '#state/operator-state'
import { resolveFinalizedReceipt } from '#execution/receipt-transition'
import { nextStagedHistoricalRecoveryRange, recordStagedRecoveryChunk, recordStagedRecoveryGap, stagedRecoveryAnchorMatches } from '#execution/staged-recovery-journal'

const MAXIMUM_RECOVERY_LOG_RANGE = 256n

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
	const observations = readers.clients.map(async ({ client, endpoint }) => {
		try {
			const receipt = await client.getTransactionReceipt({ hash })
			return {
				endpoint,
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
			}
		} catch (error) {
			if (missingReceipt(error))
				return {
					endpoint,
					evidence: undefined,
					receipt: undefined,
				}
			throw error
		}
	})
	const evidence = await settledQuorumValue(
		`receipt ${hash}`,
		observations.map(async observation => {
			const { endpoint, evidence: value } = await observation
			return { endpoint, value }
		}),
		settings.connectivity.rpcQuorum,
	)
	if (evidence === undefined) return { observed: false as const, receipt: undefined }
	const receipt = availableSettledValues(await Promise.allSettled(observations)).find(observation => observation.receipt !== undefined)?.receipt
	if (receipt === undefined) throw new Error(`Receipt ${hash} quorum did not retain its matching transaction receipt`)
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

// Match exact supported calldata, not just a historical label or lack of a price check.
// Migration needs a refreshed fork selection and deadline; generic calls need their own replay policy.
function replayIneligibilityReason(settings: OperatorSettings, intent: PendingTransactionIntent) {
	const transaction = parseTransaction(intent.serializedTransaction)
	if ((transaction.value ?? 0n) !== 0n) return 'Automatic replay of value-bearing calls is unsupported'
	if (intent.kind === 'fees' && settings.selectedPools.some(pool => pool.toLowerCase() === transaction.to?.toLowerCase()) && transaction.data === encodeFunctionData({ abi: securityPoolAbi, functionName: 'redeemFees', args: [intent.sender] })) return undefined
	if (
		intent.kind === 'deployment' &&
		settings.strategy.allowAutomaticPoolCreation &&
		transaction.to?.toLowerCase() === settings.deployment.securityPoolFactory.toLowerCase() &&
		settings.desiredPools.some(
			desired =>
				settings.approvedUniverses.includes(desired.universeId) && transaction.data === encodeFunctionData({ abi: securityPoolFactoryAbi, functionName: 'deployOriginSecurityPool', args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas] }),
		)
	)
		return undefined
	return intent.kind === 'migration' ? 'Vault migration requires a fresh approved fork selection and migration-window check' : 'The signed call is no longer authorized by current settings or has no automatic replay policy'
}

export async function recoverPendingTransactions(
	settings: OperatorSettings,
	wallet: WalletClient<Transport, Chain, Account>,
	state: ReturnType<typeof initialRuntimeState>,
	pool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]),
	isStopping: () => boolean = () => false,
) {
	for (const intent of [...state.pendingTransactions]) {
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const { clients } = recoveryReaders(settings, wallet, pool)
		const receiptResult = await finalizedReceiptWithQuorum(settings, wallet, intent.hash, pool)
		const receipt = receiptResult.receipt
		if (receipt !== undefined) {
			await resolveFinalizedReceipt(settings.runtime.stateFile, state, intent, receipt)
			continue
		}
		if (receiptResult.observed) return true
		const requireReconciliation = async (reason: string): Promise<never> => {
			intent.reconciliationReason = `${reason}; inspect the transaction and reconcile its receipt or replace signer nonce ${intent.nonce.toString()} before resuming`
			await saveDurableState(settings.runtime.stateFile, state)
			throw new Error(`Transaction ${intent.hash}: ${intent.reconciliationReason}`)
		}
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
			await requireReconciliation('The signer nonce was consumed without a receipt for this transaction; manual reconciliation is required')
		}
		const recoveryAction = ambiguousRecoveryAction(intent)
		if (recoveryAction === 'retain') await requireReconciliation('Fresh market evidence is required; relay expiry does not prove the signed transaction cannot execute')
		const eligibilityReason = replayIneligibilityReason(settings, intent)
		if (eligibilityReason !== undefined) await requireReconciliation(eligibilityReason)
		const transaction = parseTransaction(intent.serializedTransaction)
		try {
			await settledQuorumValue(
				`recovery simulation for ${intent.hash}`,
				clients.map(async ({ endpoint }) => ({
					endpoint,
					value: await createWalletClient({ account: wallet.account, chain: wallet.chain, transport: pool.transportFor(endpoint) }).call({
						account: intent.sender,
						to: transaction.to,
						data: transaction.data,
						value: transaction.value,
						gas: transaction.gas,
						maxFeePerGas: transaction.maxFeePerGas,
						maxPriorityFeePerGas: transaction.maxPriorityFeePerGas,
					}),
				})),
				settings.connectivity.rpcQuorum,
			)
		} catch (error) {
			await requireReconciliation(`Current-chain replay simulation failed: ${error instanceof Error ? error.message : String(error)}`)
		}
		// Read the envelope head after simulation so a slow preflight cannot reuse an expired window.
		const block = await settledQuorumValue(
			`recovery relay window block for ${intent.hash}`,
			clients.map(async ({ client, endpoint }) => {
				const current = await client.getBlock()
				return { endpoint, value: { number: current.number, hash: current.hash, baseFeePerGas: current.baseFeePerGas } }
			}),
			settings.connectivity.rpcQuorum,
		)
		if (block.number === undefined || block.hash === undefined || block.baseFeePerGas === undefined) throw new ConnectivityDegradedError('Recovery block is missing canonical identity or base fee')
		if (intent.lastValidBlockNumber !== undefined && block.number >= intent.lastValidBlockNumber) await requireReconciliation('The calldata validity deadline has expired')
		if (transaction.maxFeePerGas === undefined || transaction.maxFeePerGas < block.baseFeePerGas) await requireReconciliation('The signed fee ceiling is below the current base fee; envelope renewal cannot raise it')
		if (transaction.gas === undefined || transaction.maxFeePerGas === undefined || transaction.gas * transaction.maxFeePerGas > settings.strategy.maximumGasCostAttoEth) await requireReconciliation('The signed transaction exceeds the current maximum gas cost; replacement requires newly approved signed limits')
		if (intent.kind === 'fees') {
			const address = transaction.to
			if (address === undefined) throw new Error('Fee redemption transaction is missing its pool address')
			const feeState = await settledQuorumValue(
				`fee redemption eligibility for ${intent.hash}`,
				clients.map(async ({ client, endpoint }) => {
					const [vault, systemState, universeId] = await Promise.all([
						client.readContract({ abi: securityPoolAbi, address, functionName: 'securityVaults', args: [intent.sender], blockNumber: block.number }),
						client.readContract({ abi: securityPoolAbi, address, functionName: 'systemState', blockNumber: block.number }),
						client.readContract({ abi: securityPoolAbi, address, functionName: 'universeId', blockNumber: block.number }),
					])
					return { endpoint, value: { claimableFeesAttoEth: vault[2], systemState, universeId } }
				}),
				settings.connectivity.rpcQuorum,
			)
			if (!isPoolExecutionEligible({ selected: settings.selectedPools.some(pool => pool.toLowerCase() === address.toLowerCase()), approvedUniverse: settings.approvedUniverses.includes(feeState.universeId), systemState: feeState.systemState }))
				await requireReconciliation('Fee redemption pool is no longer eligible under current universe and pool policy')
			if (feeState.claimableFeesAttoEth === 0n || feeState.claimableFeesAttoEth < settings.strategy.redeemFeesAboveAttoEth) await requireReconciliation('Fee redemption no longer meets the positive claimable-fee threshold')
		}
		if (!recoveredIntentCanBeResubmitted(intent)) throw new Error(`Price-dependent transaction ${intent.hash} cannot be resubmitted without fresh market evidence`)
		if (wallet.account.signMessage === undefined) throw new Error('Execution signer cannot authenticate transaction recovery')
		if (isStopping()) return true
		if (intent.mode === 'private') {
			const futureWindow = block.number + DEFAULT_TRANSACTION_VALIDITY_BLOCKS
			intent.maxBlockNumber = intent.lastValidBlockNumber === undefined || intent.lastValidBlockNumber > futureWindow ? futureWindow : intent.lastValidBlockNumber
		}
		delete intent.reconciliationReason
		await saveDurableState(settings.runtime.stateFile, state)
		if (isStopping()) return true
		await submitSignedTransaction({
			address: intent.sender,
			hash: intent.hash,
			maxBlockNumber: intent.maxBlockNumber,
			publicRpcUrls: settings.connectivity.publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: intent.serializedTransaction,
			settings: { ...settings.submission, mode: intent.mode },
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
		if (outcome.operation !== BigInt(pending.operation ?? 0) || outcome.operationId !== pending.operationId || typeof outcome.success !== 'boolean' || typeof outcome.errorMessage !== 'string') {
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
		const next = {
			...state,
			activities: [...state.activities],
			pendingStagedOperations: state.pendingStagedOperations.filter(operation => operation.coordinator.toLowerCase() !== pending.coordinator.toLowerCase() || operation.operationId !== pending.operationId),
		}
		recordActivity(next, {
			details: `coordinator=${pending.coordinator} operation=${pending.operationId.toString()} target=${pending.target}`,
			kind: pending.operation === 1 ? 'withdrawal' : 'liquidation',
			message: outcome.success ? 'Staged operation settled successfully' : `Staged operation failed: ${outcome.errorMessage}`,
			status: outcome.success ? 'confirmed' : 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, next)
		state.activities = next.activities
		state.pendingStagedOperations = next.pendingStagedOperations
		if (!outcome.success) throw new Error(`Staged operation ${pending.operationId.toString()} failed: ${outcome.errorMessage}`)
	}
}
