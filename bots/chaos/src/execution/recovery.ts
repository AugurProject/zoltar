import { keccak256, parseTransaction, toHex, type Hex } from '@zoltar/bot-shared/ethereum'
import { submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import {
	captureWorkflowIntentSubmissionJournal,
	durableWorkflowPlan,
	markWorkflowFailed,
	markWorkflowIntentBroadcastAttempt,
	markWorkflowStepConfirmed,
	markWorkflowStepSubmitted,
	markWorkflowStepWaitingCanonical,
	requireWorkflowStep,
	recoverableWorkflowForIntent,
	restoreWorkflowIntentSubmissionJournal,
} from '../runtime/workflows.ts'
import { recordActivity, saveDurableState, type PendingTransactionIntent } from '../state/operator-state.ts'
import { requireSuccessfulReceipt, stepReceiptEvidenceDisposition, type ReceiptEvidenceDisposition } from './receipt-validation.ts'
import {
	balanceObservations,
	agreedMaximumGasEstimate,
	assertExecutionActive,
	agreedLatestBlock,
	agreedExactCall,
	assertFreshWalletAssetDebits,
	assertRequestedTransactionHash,
	assertStepPreflightCalls,
	captureBalanceEvidence,
	captureStorageEvidence,
	CHAOS_FINALITY_BLOCKS,
	exactAttestedEthBalance,
	executionReadClients,
	finalizedReceiptWithQuorum,
	requiredConnectivity,
	sameCanonicalExecutionAnchor,
	storageObservations,
	TransactionAwaitingRecovery,
	OperationRediscoveryRequired,
	type CanonicalExecutionAnchor,
	type ExecutionEnvironment,
} from './transaction-executor.ts'
import { assertOperationPrincipalCaps } from './safety.ts'

function baselineMap(intent: PendingTransactionIntent) {
	return new Map(intent.semanticExpectation.balanceBaselines.map(baseline => [`${baseline.account.toLowerCase()}:${baseline.asset === 'ETH' ? 'ETH' : baseline.asset.toLowerCase()}`, BigInt(baseline.balance)]))
}

function storageBaselineMap(intent: PendingTransactionIntent) {
	return new Map(intent.semanticExpectation.storageBaselines.map(baseline => [`${baseline.contract.toLowerCase()}:${baseline.functionName}:${JSON.stringify(baseline.args)}`, baseline.value]))
}

async function persist(environment: ExecutionEnvironment) {
	await saveDurableState(environment.settings.runtime.stateFile, environment.state)
}

function removeIntent(environment: ExecutionEnvironment, id: string) {
	environment.state.pendingTransactions = environment.state.pendingTransactions.filter(intent => intent.id !== id)
}

async function recoveredReceiptObservations(environment: ExecutionEnvironment, intent: PendingTransactionIntent, receipt: ReturnType<typeof requireSuccessfulReceipt>) {
	const after = await captureBalanceEvidence(environment, intent.semanticExpectation.evidence, receipt.blockNumber)
	const afterStorage = await captureStorageEvidence(environment, intent.semanticExpectation.evidence, receipt.blockNumber)
	return {
		balances: balanceObservations(intent.semanticExpectation.evidence, baselineMap(intent), after),
		storage: storageObservations(intent.semanticExpectation.evidence, storageBaselineMap(intent), afterStorage),
	}
}

async function agreedPendingNonce(environment: ExecutionEnvironment, intent: PendingTransactionIntent, capableRpcUrls?: ReadonlySet<string> | undefined) {
	const connectivity = requiredConnectivity(environment.settings)
	return settledQuorumValue(
		`pending signer nonce for ${intent.hash}`,
		executionReadClients(environment)
			.filter(({ rpcUrl }) => capableRpcUrls?.has(rpcUrl) ?? true)
			.map(async ({ client, endpoint }) => ({
				endpoint,
				value: await client.getTransactionCount({
					address: intent.sender,
					blockTag: 'pending',
				}),
			})),
		connectivity.rpcQuorum,
	)
}

async function availableHeads(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
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

async function assertRecoveryChain(environment: ExecutionEnvironment) {
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

function assertIntentIdentity(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	if (intent.sender.toLowerCase() !== environment.sender.toLowerCase()) {
		throw new Error(`Pending transaction ${intent.hash} belongs to a different signer`)
	}
	if (keccak256(intent.serializedTransaction).toLowerCase() !== intent.hash.toLowerCase()) {
		throw new Error(`Pending transaction ${intent.hash} does not match its signed bytes`)
	}
}

export function transactionMatchesIntent(
	transaction: {
		from: string
		input: string
		nonce: bigint
		to?: string | null | undefined
		value: bigint
	},
	intent: Pick<PendingTransactionIntent, 'data' | 'nonce' | 'sender' | 'to' | 'value'>,
) {
	return transaction.from.toLowerCase() === intent.sender.toLowerCase() && transaction.nonce === intent.nonce && transaction.to?.toLowerCase() === intent.to.toLowerCase() && transaction.input.toLowerCase() === intent.data.toLowerCase() && transaction.value === intent.value
}

export function transactionIsStrictNonceCancellation(
	transaction: {
		from: string
		input: string
		nonce: bigint
		to?: string | null | undefined
		value: bigint
	},
	intent: Pick<PendingTransactionIntent, 'nonce' | 'sender'>,
) {
	return transaction.from.toLowerCase() === intent.sender.toLowerCase() && transaction.nonce === intent.nonce && transaction.to?.toLowerCase() === intent.sender.toLowerCase() && transaction.input.toLowerCase() === '0x' && transaction.value === 0n
}

async function exactIntentIsVisible(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
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

export function assertRecoverySubmissionMode(intentMode: PendingTransactionIntent['mode'], configuredMode: PendingTransactionIntent['mode']) {
	if (intentMode !== configuredMode) {
		throw new Error(`Pending ${intentMode} transaction recovery requires submission.mode to remain ${intentMode}`)
	}
}

export function pendingIntentRecoveryAction(intent: Pick<PendingTransactionIntent, 'maxBlockNumber' | 'mode' | 'nonce'>, pendingNonce: bigint, heads: readonly bigint[], finalityBlocks = CHAOS_FINALITY_BLOCKS, exactTransactionVisible = false, rpcQuorum = heads.length) {
	if (heads.length === 0) throw new Error('Pending intent recovery requires at least one canonical head')
	if (finalityBlocks < 1n) throw new Error('Pending intent recovery finality must be positive')
	if (!Number.isSafeInteger(rpcQuorum) || rpcQuorum < 1 || rpcQuorum > heads.length) {
		throw new Error('Pending intent recovery requires a valid RPC quorum')
	}
	if (exactTransactionVisible) return 'wait-known-pending' as const
	if (pendingNonce !== intent.nonce) return 'manual-reconciliation' as const
	const descendingHeads = [...heads].sort((left, right) => {
		if (left === right) return 0
		return left > right ? -1 : 1
	})
	const sharedHead = descendingHeads[rpcQuorum - 1]
	if (sharedHead === undefined) {
		throw new Error('Pending intent recovery could not determine a shared head')
	}
	if (sharedHead >= intent.maxBlockNumber) {
		return 'submission-window-closed' as const
	}
	return 'resubmit-identical' as const
}

async function resolveReceipt(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const result = await finalizedReceiptWithQuorum(environment, intent.hash)
	if (result.receipt === undefined) return result
	const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
	let receipt: ReturnType<typeof requireSuccessfulReceipt>
	try {
		receipt = requireSuccessfulReceipt(intent.label, result.receipt)
	} catch (error) {
		removeIntent(environment, intent.id)
		markWorkflowFailed(workflow, intent.stepId, error, 'receipt-reverted')
		recordActivity(environment.state, {
			hash: intent.hash,
			message: `Recovered transaction reverted: ${intent.label}`,
			operationId: intent.operationId,
			status: 'failed',
			type: 'recovery',
		})
		await persist(environment)
		throw error
	}
	let observations: Awaited<ReturnType<typeof recoveredReceiptObservations>>
	try {
		observations = await recoveredReceiptObservations(environment, intent, receipt)
	} catch (error) {
		intent.status = 'confirmation-unknown'
		await persist(environment)
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, `confirmed receipt evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`)
	}
	let evidenceDisposition: ReceiptEvidenceDisposition
	try {
		evidenceDisposition = stepReceiptEvidenceDisposition({ evidence: intent.semanticExpectation.evidence, label: intent.label }, receipt, observations)
	} catch (error) {
		removeIntent(environment, intent.id)
		markWorkflowFailed(workflow, intent.stepId, error, 'semantic-failure')
		recordActivity(environment.state, {
			hash: intent.hash,
			message: `Recovered transaction failed semantic validation: ${intent.label}`,
			operationId: intent.operationId,
			status: 'failed',
			type: 'recovery',
		})
		await persist(environment)
		throw error
	}
	removeIntent(environment, intent.id)
	if (evidenceDisposition === 'waiting-canonical') markWorkflowStepWaitingCanonical(workflow, intent.stepId, receipt.transactionHash)
	else markWorkflowStepConfirmed(workflow, intent.stepId, receipt.transactionHash)
	recordActivity(environment.state, {
		hash: intent.hash,
		message: evidenceDisposition === 'waiting-canonical' ? `Recovered confirmation awaiting canonical lifecycle evidence: ${intent.label}` : `Recovered confirmation: ${intent.label}`,
		operationId: intent.operationId,
		status: evidenceDisposition === 'waiting-canonical' ? 'pending' : 'confirmed',
		type: 'recovery',
	})
	await persist(environment)
	return { observed: true as const, receipt }
}

async function retainClosedSubmissionWindow(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const blocker = 'Automatic resubmission window closed; verify a receipt, exact replacement, or nonce cancellation'
	if (intent.recoveryBlocker !== blocker) {
		intent.recoveryBlocker = blocker
		recordActivity(environment.state, {
			hash: intent.hash,
			message: `Automatic resubmission window closed; exact intent retained for receipt or replacement verification: ${intent.label}`,
			operationId: intent.operationId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
	}
}

function manualReconciliationBlocker(intent: PendingTransactionIntent, nonce: bigint) {
	return nonce > intent.nonce
		? `Signer nonce ${intent.nonce.toString()} was consumed without a quorum receipt; verify an exact replacement or nonce cancellation`
		: `Signer pending nonce moved backward to ${nonce.toString()}, below journaled nonce ${intent.nonce.toString()}; manual reconciliation is required before any resubmission`
}

async function retainManualReconciliation(environment: ExecutionEnvironment, intent: PendingTransactionIntent, nonce: bigint): Promise<never> {
	const blocker = manualReconciliationBlocker(intent, nonce)
	if (intent.recoveryBlocker !== blocker) {
		intent.recoveryBlocker = blocker
		await persist(environment)
	}
	throw new Error(`Transaction ${intent.hash}: ${blocker}`)
}

class RecoveryPolicyBlocked extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'RecoveryPolicyBlocked'
	}
}

async function assertRecoveryPolicy(environment: ExecutionEnvironment, intent: PendingTransactionIntent, workflow: ReturnType<typeof recoverableWorkflowForIntent>, step: ReturnType<typeof requireWorkflowStep>, parsed: ReturnType<typeof parseTransaction>, anchor: CanonicalExecutionAnchor) {
	try {
		assertOperationPrincipalCaps(durableWorkflowPlan(workflow), environment.settings.strategy)
	} catch (error) {
		throw new RecoveryPolicyBlocked(error instanceof Error ? error.message : String(error), error)
	}
	try {
		await assertFreshWalletAssetDebits(environment, step, anchor)
	} catch (error) {
		if (error instanceof OperationRediscoveryRequired) throw new RecoveryPolicyBlocked(error.message, error)
		throw error
	}
	if (parsed.type !== 'eip1559' || parsed.gas === undefined || parsed.maxFeePerGas === undefined || parsed.maxPriorityFeePerGas === undefined) {
		throw new Error(`Pending transaction ${intent.hash} is not a complete EIP-1559 transaction`)
	}
	if (parsed.maxPriorityFeePerGas > parsed.maxFeePerGas) {
		throw new Error(`Pending transaction ${intent.hash} has a priority fee above its maximum fee`)
	}
	if ((parsed.value ?? 0n) !== intent.value) {
		throw new Error(`Pending transaction ${intent.hash} value does not match its durable intent`)
	}
	if (parsed.maxFeePerGas < anchor.baseFeePerGas) {
		throw new RecoveryPolicyBlocked(`${intent.label} signed maximum fee is below the current canonical base fee`)
	}
	const maximumGasCost = parsed.gas * parsed.maxFeePerGas
	if (maximumGasCost > environment.settings.strategy.maximumGasCostAttoEth) {
		throw new RecoveryPolicyBlocked(`${intent.label} signed gas ceiling exceeds the current strategy.maximumGasCostEth`)
	}
	const balance = await exactAttestedEthBalance(environment, intent.sender, anchor)
	const requiredBalance = environment.settings.strategy.minimumEthReserveAttoEth + intent.value + maximumGasCost
	if (balance < requiredBalance) {
		throw new RecoveryPolicyBlocked(`${intent.label} signed value and gas ceiling would breach the current wallet ETH reserve`)
	}
	return {
		gas: parsed.gas,
		maxFeePerGas: parsed.maxFeePerGas,
		maxPriorityFeePerGas: parsed.maxPriorityFeePerGas,
	}
}

async function resubmitIntent(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	assertExecutionActive(environment)
	const wallet = environment.wallet
	if (wallet === undefined) throw new Error('Transaction resubmission requires the configured recovery signer')
	const account = wallet.account
	if (account.address.toLowerCase() !== intent.sender.toLowerCase()) {
		throw new Error(`Pending transaction ${intent.hash} belongs to a different signer`)
	}
	if (account.signMessage === undefined) throw new Error('Execution signer cannot authenticate transaction recovery')
	assertRecoverySubmissionMode(intent.mode, environment.settings.submission.mode)
	const parsed = parseTransaction(intent.serializedTransaction)
	const preflightNonce = await agreedPendingNonce(environment, intent)
	if (preflightNonce !== intent.nonce) await retainManualReconciliation(environment, intent, preflightNonce)
	const anchor = await agreedLatestBlock(environment, `${intent.label} recovery block`)
	if (anchor.number >= intent.maxBlockNumber) {
		await retainClosedSubmissionWindow(environment, intent)
		return
	}
	try {
		const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
		const step = requireWorkflowStep(workflow, intent.stepId)
		const signedPolicy = await assertRecoveryPolicy(environment, intent, workflow, step, parsed, anchor)
		await assertStepPreflightCalls(environment, step, anchor)
		const recoveryTransaction = {
			data: intent.data,
			from: intent.sender,
			gas: toHex(signedPolicy.gas),
			maxFeePerGas: toHex(signedPolicy.maxFeePerGas),
			maxPriorityFeePerGas: toHex(signedPolicy.maxPriorityFeePerGas),
			to: intent.to,
			value: toHex(intent.value),
		}
		await agreedExactCall(environment, `${intent.label} exact recovery simulation`, recoveryTransaction, anchor)
		const gasEstimate = await agreedMaximumGasEstimate(environment, `${intent.label} exact recovery gas estimate`, recoveryTransaction, anchor)
		if (gasEstimate > signedPolicy.gas) {
			throw new OperationRediscoveryRequired(`${intent.label} now requires ${gasEstimate.toString()} gas, above its signed ${signedPolicy.gas.toString()} gas limit`)
		}
		const replayAnchor = await agreedLatestBlock(environment, `${intent.label} recovery block re-attestation`)
		if (!sameCanonicalExecutionAnchor(replayAnchor, anchor)) {
			throw new TransactionAwaitingRecovery(intent.label, intent.hash, 'canonical recovery anchor or its attester set changed during replay checks')
		}
		const replayNonce = await agreedPendingNonce(environment, intent, replayAnchor.attestingRpcUrls)
		if (replayNonce !== intent.nonce) await retainManualReconciliation(environment, intent, replayNonce)
	} catch (error) {
		if (error instanceof RecoveryPolicyBlocked) {
			const blocker = `Current recovery policy blocks identical-byte resubmission: ${error.message}`
			if (intent.recoveryBlocker !== blocker) {
				intent.recoveryBlocker = blocker
				recordActivity(environment.state, {
					hash: intent.hash,
					message: `Identical-byte resubmission blocked by current funding or policy: ${intent.label}`,
					operationId: intent.operationId,
					status: 'pending',
					type: 'recovery',
				})
				await persist(environment)
			}
			throw new TransactionAwaitingRecovery(intent.label, intent.hash, `${error.message}; restore funding or policy, or verify a nonce cancellation while paused`)
		}
		if (error instanceof OperationRediscoveryRequired || (error instanceof Error && /(?:execution reverted|\brevert(?:ed|ing)?\b|always failing transaction)/i.test(error.message))) {
			const blocker = 'Exact recovery simulation no longer succeeds; verify a nonce cancellation while paused'
			if (intent.recoveryBlocker !== blocker) {
				intent.recoveryBlocker = blocker
				recordActivity(environment.state, {
					hash: intent.hash,
					message: `Identical-byte resubmission blocked after fresh quorum simulation reverted: ${intent.label}`,
					operationId: intent.operationId,
					status: 'pending',
					type: 'recovery',
				})
				await persist(environment)
			}
			throw new TransactionAwaitingRecovery(intent.label, intent.hash, 'exact recovery simulation no longer succeeds; verify a nonce cancellation while paused')
		}
		throw error
	}
	delete intent.recoveryBlocker
	const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
	const broadcastJournal = captureWorkflowIntentSubmissionJournal(workflow, intent)
	markWorkflowIntentBroadcastAttempt(workflow, intent, anchor.number)
	await persist(environment)
	assertExecutionActive(environment)
	let deferral: { blocker?: string | undefined; manual: boolean; reason: string } | undefined
	try {
		await environment.beforeBroadcast?.()
		assertExecutionActive(environment)
		const submissionAnchor = await agreedLatestBlock(environment, `${intent.label} recovery pre-broadcast block`)
		if (submissionAnchor.number >= intent.maxBlockNumber) {
			deferral = {
				blocker: 'Automatic resubmission window closed; verify a receipt, exact replacement, or nonce cancellation',
				manual: false,
				reason: 'signed recovery submission window closed before broadcast',
			}
		} else if (!sameCanonicalExecutionAnchor(submissionAnchor, anchor)) {
			deferral = {
				manual: false,
				reason: 'canonical recovery anchor or its attester set changed after broadcast journaling',
			}
		} else {
			const submissionWorkflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
			const submissionStep = requireWorkflowStep(submissionWorkflow, intent.stepId)
			await assertRecoveryPolicy(environment, intent, submissionWorkflow, submissionStep, parsed, submissionAnchor)
			const submissionNonce = await agreedPendingNonce(environment, intent, submissionAnchor.attestingRpcUrls)
			if (submissionNonce !== intent.nonce) {
				const blocker = manualReconciliationBlocker(intent, submissionNonce)
				deferral = { blocker, manual: true, reason: blocker }
			}
		}
		assertExecutionActive(environment)
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error)
		deferral =
			error instanceof RecoveryPolicyBlocked
				? {
						blocker: `Current recovery policy blocks identical-byte resubmission: ${reason}`,
						manual: false,
						reason,
					}
				: {
						manual: false,
						reason,
					}
	}
	if (deferral !== undefined) {
		restoreWorkflowIntentSubmissionJournal(workflow, intent, broadcastJournal)
		if (deferral.blocker === undefined) delete intent.recoveryBlocker
		else intent.recoveryBlocker = deferral.blocker
		recordActivity(environment.state, {
			hash: intent.hash,
			message: `Identical-byte resubmission deferred before network broadcast: ${intent.label}`,
			operationId: intent.operationId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
		if (deferral.manual) throw new Error(`Transaction ${intent.hash}: ${deferral.reason}`)
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, deferral.reason)
	}
	try {
		await submitSignedTransaction({
			address: intent.sender,
			hash: intent.hash,
			maxBlockNumber: intent.maxBlockNumber,
			publicRpcUrls: requiredConnectivity(environment.settings).publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: intent.serializedTransaction,
			settings: environment.settings.submission,
			signMessage: account.signMessage,
		})
	} catch (error) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, error instanceof Error ? error.message : String(error))
	}
	intent.status = 'submitted'
	intent.submissionBlock ??= anchor.number
	intent.submittedAt ??= new Date().toISOString()
	markWorkflowStepSubmitted(workflow, intent.stepId)
	recordActivity(environment.state, {
		hash: intent.hash,
		message: `Resubmitted identical signed intent: ${intent.label}`,
		operationId: intent.operationId,
		status: 'pending',
		type: 'recovery',
	})
	await persist(environment)
}

export type RecoveryOptions = {
	beforeResubmit?: (() => Promise<void>) | undefined
	resubmit?: boolean | undefined
}

class ReplacementTransactionFailed extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause })
		this.name = 'ReplacementTransactionFailed'
	}
}

async function resolveQueuedReplacement(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const replacementHash = intent.replacementHash
	if (replacementHash === undefined) return false
	let verified: Awaited<ReturnType<typeof verifyRecoveredReplacement>>
	try {
		verified = await verifyRecoveredReplacement(environment, intent, replacementHash)
	} catch (error) {
		if (!(error instanceof ReplacementTransactionFailed)) throw error
		removeIntent(environment, intent.id)
		const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
		markWorkflowFailed(workflow, intent.stepId, error, 'receipt-reverted')
		recordActivity(environment.state, {
			hash: replacementHash,
			message: `Verified replacement failed on chain: ${intent.label}`,
			operationId: intent.operationId,
			status: 'failed',
			type: 'recovery',
		})
		await persist(environment)
		throw error
	}
	removeIntent(environment, intent.id)
	const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
	if (verified.evidenceDisposition === 'waiting-canonical') markWorkflowStepWaitingCanonical(workflow, intent.stepId, verified.receipt.transactionHash)
	else markWorkflowStepConfirmed(workflow, intent.stepId, verified.receipt.transactionHash)
	recordActivity(environment.state, {
		hash: verified.receipt.transactionHash,
		message: verified.evidenceDisposition === 'waiting-canonical' ? `Verified replacement awaiting canonical lifecycle evidence: ${intent.label}` : `Verified replacement confirmed: ${intent.label}`,
		operationId: intent.operationId,
		status: verified.evidenceDisposition === 'waiting-canonical' ? 'pending' : 'confirmed',
		type: 'recovery',
	})
	await persist(environment)
	return true
}

async function verifyRecoveredCancellation(environment: ExecutionEnvironment, intent: PendingTransactionIntent, cancellationHash: Hex) {
	const connectivity = requiredConnectivity(environment.settings)
	const transaction = await settledQuorumValue(
		`nonce cancellation transaction ${cancellationHash}`,
		executionReadClients(environment).map(async ({ client, endpoint }) => {
			const candidate = await client.getTransaction({ hash: cancellationHash })
			assertRequestedTransactionHash(candidate.hash, cancellationHash, `RPC ${endpoint} nonce cancellation lookup`)
			return {
				endpoint,
				value: {
					from: candidate.from,
					input: candidate.input,
					nonce: candidate.nonce,
					to: candidate.to,
					value: candidate.value,
				},
			}
		}),
		connectivity.rpcQuorum,
	)
	if (!transactionIsStrictNonceCancellation(transaction, intent)) {
		throw new Error('Nonce cancellation must be a zero-value, empty-calldata self-transfer from the recovery signer at the exact pending nonce')
	}
	const receiptResult = await finalizedReceiptWithQuorum(environment, cancellationHash)
	if (receiptResult.receipt === undefined) {
		throw new TransactionAwaitingRecovery(intent.label, cancellationHash, 'nonce cancellation is awaiting a canonical finalized receipt')
	}
	return requireSuccessfulReceipt(`Nonce cancellation for ${intent.label}`, receiptResult.receipt)
}

async function resolveQueuedCancellation(environment: ExecutionEnvironment, intent: PendingTransactionIntent) {
	const cancellationHash = intent.cancellationHash
	if (cancellationHash === undefined) return false
	const receipt = await verifyRecoveredCancellation(environment, intent, cancellationHash)
	removeIntent(environment, intent.id)
	const workflow = recoverableWorkflowForIntent(environment.state, intent.workflowId)
	markWorkflowFailed(workflow, intent.stepId, new Error(`Original transaction was superseded by verified nonce cancellation ${receipt.transactionHash}`), 'nonce-cancelled')
	recordActivity(environment.state, {
		hash: receipt.transactionHash,
		message: `Verified nonce cancellation finalized; original workflow closed: ${intent.label}`,
		operationId: intent.operationId,
		status: 'skipped',
		type: 'recovery',
	})
	await persist(environment)
	return true
}

export async function recoverPendingTransactions(environment: ExecutionEnvironment, options: RecoveryOptions = {}) {
	if (environment.state.pendingTransactions.length === 0) return false
	if (environment.state.pendingTransactions.length !== 1) {
		throw new Error('Multiple pending transaction intents require manual reconciliation')
	}
	const intent = environment.state.pendingTransactions[0]
	if (intent === undefined) throw new Error('Pending transaction journal changed during recovery')
	assertIntentIdentity(environment, intent)
	await assertRecoveryChain(environment)
	const receiptResult = await resolveReceipt(environment, intent)
	if (receiptResult.receipt !== undefined) return true
	if (receiptResult.observed) {
		return true
	}
	if (await resolveQueuedCancellation(environment, intent)) return true
	if (await resolveQueuedReplacement(environment, intent)) return true
	const nonce = await agreedPendingNonce(environment, intent)
	const headObservations = await availableHeads(environment, intent)
	const heads = headObservations.map(observation => observation.head)
	const exactTransactionVisible = await exactIntentIsVisible(environment, intent)
	const finalityBlocks = environment.finalityBlocks ?? CHAOS_FINALITY_BLOCKS
	const connectivity = requiredConnectivity(environment.settings)
	const action = pendingIntentRecoveryAction(intent, nonce, heads, finalityBlocks, exactTransactionVisible, connectivity.rpcQuorum)
	if (action === 'manual-reconciliation') {
		await retainManualReconciliation(environment, intent, nonce)
	}
	if (action === 'submission-window-closed') {
		await retainClosedSubmissionWindow(environment, intent)
		return true
	}
	if (action === 'wait-known-pending') {
		if (intent.recoveryBlocker !== undefined) {
			delete intent.recoveryBlocker
			await persist(environment)
		}
		return true
	}
	const resubmit = options.resubmit ?? (environment.settings.runtime.execute && !environment.settings.paused && !environment.state.paused)
	if (!resubmit) {
		return true
	}
	await options.beforeResubmit?.()
	await resubmitIntent(environment, intent)
	return true
}

export async function verifyRecoveredReplacement(environment: ExecutionEnvironment, intent: PendingTransactionIntent, replacementHash: Hex) {
	const connectivity = requiredConnectivity(environment.settings)
	const readers = executionReadClients(environment)
	const transaction = await settledQuorumValue(
		`replacement transaction ${replacementHash}`,
		readers.map(async ({ client, endpoint }) => {
			const candidate = await client.getTransaction({ hash: replacementHash })
			assertRequestedTransactionHash(candidate.hash, replacementHash, `RPC ${endpoint} replacement lookup`)
			return {
				endpoint,
				value: {
					from: candidate.from,
					input: candidate.input,
					nonce: candidate.nonce,
					to: candidate.to,
					value: candidate.value,
				},
			}
		}),
		connectivity.rpcQuorum,
	)
	if (!transactionMatchesIntent(transaction, intent)) {
		throw new Error('Replacement transaction does not match the persisted intent semantics')
	}
	const receiptResult = await finalizedReceiptWithQuorum(environment, replacementHash)
	if (receiptResult.receipt === undefined) {
		throw new TransactionAwaitingRecovery(intent.label, replacementHash, 'replacement is awaiting a canonical finalized receipt')
	}
	let successful: ReturnType<typeof requireSuccessfulReceipt>
	try {
		successful = requireSuccessfulReceipt(intent.label, receiptResult.receipt)
	} catch (error) {
		throw new ReplacementTransactionFailed(`Replacement transaction ${replacementHash} reverted`, error)
	}
	let observations: Awaited<ReturnType<typeof recoveredReceiptObservations>>
	try {
		observations = await recoveredReceiptObservations(environment, intent, successful)
	} catch (error) {
		throw new TransactionAwaitingRecovery(intent.label, replacementHash, `replacement evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`)
	}
	let evidenceDisposition: ReceiptEvidenceDisposition
	try {
		evidenceDisposition = stepReceiptEvidenceDisposition({ evidence: intent.semanticExpectation.evidence, label: intent.label }, successful, observations)
	} catch (error) {
		throw new ReplacementTransactionFailed(`Replacement transaction ${replacementHash} failed semantic validation`, error)
	}
	return { evidenceDisposition, receipt: successful }
}
