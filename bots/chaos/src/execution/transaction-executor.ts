import { assertIncludedTransactionsCanonical } from './inclusion-journal.ts'
import { commitReceiptDisposition } from './receipt-disposition.ts'
import { assertSubmissionWindowOpen, prepareSignedTransaction, submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import type { OperationPlan, OperationStep } from '../operations/types.ts'
import { recordActivity, type PendingTransactionIntent } from '../state/operator-state.ts'
import { observePendingTransaction } from '../state/pending-transaction-observation.ts'
import { persist, retainUnreadableReceiptEvidence } from './recovery-journal.ts'
import { recordPreflightFailure } from './preflight-failure.ts'
import {
	captureWorkflowIntentSubmissionJournal,
	recoverableWorkflowForIntent,
	markWorkflowFailed,
	markWorkflowForRediscovery,
	markWorkflowStepConfirmed,
	markWorkflowStepWaitingCanonical,
	markWorkflowIntentBroadcastAttempt,
	markWorkflowStepSigned,
	markWorkflowStepSubmitted,
	requireWorkflowStep,
	restoreWorkflowIntentSubmissionJournal,
	retainWorkflow,
	startWorkflow,
	assertTerminalSubmissionBoundary,
} from '../runtime/workflows.ts'
import { TransactionAwaitingRecovery, receiptVisibilityDisposition, requireSuccessfulReceipt, stepReceiptEvidenceDisposition, type ReceiptEvidenceDisposition } from './receipt-validation.ts'
import { assertOperationEthFunding, assertOperationPlanFresh, assertOperationPrincipalCaps, assertStepSafety, operationStepSubmissionLastValidBlock, unsignedQuantity } from './safety.ts'
import { type ExecutionEnvironment, type CanonicalExecutionAnchor, assertExecutionActive, requiredExecutionWallet, OperationRediscoveryRequired } from './execution-context.ts'
import { agreedLatestBlock, sameCanonicalExecutionAnchor, agreedPendingNonce, exactAttestedEthBalance, agreedConfirmedNonce, assertNoUnmanagedPendingNonce, requiredConnectivity } from './execution-quorum.ts'
import { assertFreshWalletAssetDebits, assertStepPreflightCalls, rediscoverableSimulationAndGas } from './execution-preflight.ts'
import { captureBalanceEvidence, captureStorageEvidence, durableBalanceBaselines, durableStorageBaselines, balanceObservations, storageObservations } from './execution-evidence.ts'
import { includedReceiptWithQuorum } from './execution-receipts.ts'

export { TransactionAwaitingRecovery }

async function assertSignedIntentBroadcastReadiness(environment: ExecutionEnvironment, intent: PendingTransactionIntent, signingAnchor: CanonicalExecutionAnchor) {
	const anchor = await agreedLatestBlock(environment, `${intent.label} pre-broadcast block`)
	try {
		assertSubmissionWindowOpen(intent.maxBlockNumber, anchor.number)
	} catch (error) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, `signed submission window closed before broadcast: ${error instanceof Error ? error.message : String(error)}`)
	}
	if (!sameCanonicalExecutionAnchor(anchor, signingAnchor)) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, 'canonical signing anchor or its attester set changed after signed intent journaling')
	}
	const pendingNonce = await agreedPendingNonce(environment, intent.sender, anchor.attestingRpcUrls)
	if (pendingNonce !== intent.nonce) {
		throw new TransactionAwaitingRecovery(intent.label, intent.hash, pendingNonce > intent.nonce ? `signer nonce ${intent.nonce.toString()} was consumed before broadcast` : `signer pending nonce moved backward to ${pendingNonce.toString()} before broadcast`)
	}
}

function createIntent(
	environment: ExecutionEnvironment,
	plan: OperationPlan,
	workflowId: string,
	step: OperationStep,
	signed: Awaited<ReturnType<typeof prepareSignedTransaction>>,
	balanceBaselines: PendingTransactionIntent['semanticExpectation']['balanceBaselines'],
	storageBaselines: PendingTransactionIntent['semanticExpectation']['storageBaselines'],
): PendingTransactionIntent {
	return {
		data: step.data,
		hash: signed.hash,
		id: `intent:${signed.hash.slice(2)}`,
		label: step.label,
		maxBlockNumber: signed.maxBlockNumber,
		mode: environment.settings.submission.mode,
		nonce: signed.transaction.nonce,
		operationId: plan.definitionId,
		semanticExpectation: {
			balanceBaselines,
			evidence: step.evidence,
			postconditions: plan.postconditions,
			storageBaselines,
		},
		sender: environment.sender,
		serializedTransaction: signed.serializedTransaction,
		signedAt: new Date().toISOString(),
		status: 'signed',
		stepId: step.id,
		to: step.to,
		value: signed.transaction.value,
		workflowId,
	}
}

async function executeStep(environment: ExecutionEnvironment, plan: OperationPlan, workflowId: string, step: OperationStep) {
	await assertIncludedTransactionsCanonical(environment)
	assertExecutionActive(environment)
	const wallet = requiredExecutionWallet(environment)
	const account = wallet.account
	const workflow = recoverableWorkflowForIntent(environment.state, workflowId)
	if (account.signTransaction === undefined || account.signMessage === undefined) {
		throw new Error('Execution signer cannot sign and authenticate transactions')
	}
	const block = await agreedLatestBlock(environment, `${step.label} signing block`)
	try {
		assertOperationPlanFresh(plan, block.number, environment.settings.strategy.workflowValidForBlocks, new Set(workflow.steps.filter(candidate => candidate.status === 'confirmed').map(candidate => candidate.id)))
	} catch (error) {
		if (error instanceof Error && error.message.includes('expired before execution')) {
			throw new OperationRediscoveryRequired(error.message, error)
		}
		throw error
	}
	const ethBalanceAttoEth = await exactAttestedEthBalance(environment, account.address, block)
	await assertFreshWalletAssetDebits(environment, step, block)
	const beforeBalances = await captureBalanceEvidence(environment, step.evidence, block.number)
	const beforeStorage = await captureStorageEvidence(environment, step.evidence, block.number)
	await assertStepPreflightCalls(environment, step, block)
	const gasEstimate = await rediscoverableSimulationAndGas(environment, step, block)
	try {
		assertStepSafety({
			baseFeePerGas: block.baseFeePerGas,
			ethBalanceAttoEth,
			gasEstimate,
			step,
			strategy: environment.settings.strategy,
		})
	} catch (error) {
		if (error instanceof Error && (error.message.includes('estimated gas ceiling exceeds') || error.message.includes('would breach the wallet ETH reserve'))) {
			throw new OperationRediscoveryRequired(error.message, error)
		}
		throw error
	}
	assertExecutionActive(environment)
	await environment.beforeSign?.()
	assertExecutionActive(environment)
	const confirmedNonce = await agreedConfirmedNonce(environment, account.address, block.number)
	const pendingNonce = await agreedPendingNonce(environment, account.address)
	assertExecutionActive(environment)
	const nonce = assertNoUnmanagedPendingNonce(confirmedNonce, pendingNonce)
	const signingAnchor = await agreedLatestBlock(environment, `${step.label} signing block`)
	if (!sameCanonicalExecutionAnchor(signingAnchor, block)) {
		throw new OperationRediscoveryRequired(`${step.label} canonical signing anchor or its attester set changed during pre-signing checks`)
	}
	assertExecutionActive(environment)
	let lastValidBlockNumber: bigint | undefined
	try {
		lastValidBlockNumber = operationStepSubmissionLastValidBlock({
			baseFeePerGas: signingAnchor.baseFeePerGas,
			currentBlock: signingAnchor.number,
			currentTimestamp: signingAnchor.timestamp,
			maximumBlockIntervalSeconds: environment.settings.network.maximumBlockIntervalSeconds,
			mode: environment.settings.submission.mode,
			plan,
			step,
		})
	} catch (error) {
		throw new OperationRediscoveryRequired(error instanceof Error ? error.message : String(error), error)
	}
	assertExecutionActive(environment)
	environment.assertSubmissionReady?.()
	const signed = await prepareSignedTransaction({
		baseFeePerGas: signingAnchor.baseFeePerGas,
		blockNumber: signingAnchor.number,
		chainId: environment.settings.network.chainId,
		data: step.data,
		from: account.address,
		gasEstimate,
		lastValidBlockNumber,
		nonce,
		signTransaction: account.signTransaction,
		to: step.to,
		value: unsignedQuantity(step.value, `${step.label} value`),
	})
	const intent = createIntent(environment, plan, workflowId, step, signed, durableBalanceBaselines(step.evidence, beforeBalances), durableStorageBaselines(step.evidence, beforeStorage))
	environment.state.pendingTransactions.push(intent)
	markWorkflowStepSigned(workflow, step.id, intent.id, intent.hash)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		hash: intent.hash,
		message: `Signed intent persisted: ${step.label}`,
		operationId: plan.definitionId,
		status: 'pending',
		type: 'transaction',
	})
	await persist(environment)
	assertExecutionActive(environment)
	await assertSignedIntentBroadcastReadiness(environment, intent, block)
	assertExecutionActive(environment)
	const broadcastJournal = captureWorkflowIntentSubmissionJournal(workflow, intent)
	markWorkflowIntentBroadcastAttempt(workflow, intent, block.number)
	await persist(environment)
	assertExecutionActive(environment)
	try {
		await environment.beforeBroadcast?.()
		assertExecutionActive(environment)
		await assertSignedIntentBroadcastReadiness(environment, intent, block)
		assertExecutionActive(environment)
		environment.assertSubmissionReady?.()
	} catch (error) {
		restoreWorkflowIntentSubmissionJournal(workflow, intent, broadcastJournal)
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Submission deferred before network broadcast: ${step.label}`,
			operationId: plan.definitionId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
		if (error instanceof TransactionAwaitingRecovery) throw error
		throw new TransactionAwaitingRecovery(step.label, intent.hash, error instanceof Error ? error.message : String(error))
	}
	try {
		await submitSignedTransaction({
			address: account.address,
			hash: signed.hash,
			maxBlockNumber: signed.maxBlockNumber,
			publicRpcUrls: requiredConnectivity(environment.settings).publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: signed.serializedTransaction,
			settings: environment.settings.submission,
			signMessage: account.signMessage,
		})
	} catch (error) {
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: intent.hash,
			message: `Submission outcome unknown: ${step.label}`,
			operationId: plan.definitionId,
			status: 'pending',
			type: 'recovery',
		})
		await persist(environment)
		throw new TransactionAwaitingRecovery(step.label, intent.hash, error instanceof Error ? error.message : String(error))
	}
	intent.status = 'submitted'
	intent.submissionBlock = block.number
	intent.submittedAt = new Date().toISOString()
	markWorkflowStepSubmitted(workflow, step.id)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		hash: intent.hash,
		message: `Submitted: ${step.label}`,
		operationId: plan.definitionId,
		status: 'pending',
		type: 'transaction',
	})
	await persist(environment)
	const included = await includedReceiptWithQuorum(environment, intent.hash)
	if (included.receipt === undefined) {
		intent.status = 'confirmation-unknown'
		// Mempool visibility is only checked by recovery, so an absent receipt is left for that pass to explain.
		if (included.observed) observePendingTransaction(intent, { head: included.head, includedBlock: included.includedBlock, kind: 'awaiting-finality' })
		await persist(environment)
		throw new TransactionAwaitingRecovery(step.label, intent.hash, ...receiptVisibilityDisposition(included.observed, intent.submittedAt))
	}
	let receipt
	try {
		receipt = requireSuccessfulReceipt(step.label, included.receipt)
	} catch (error) {
		await commitReceiptDisposition(environment, intent, workflow, included.receipt, () => {
			environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
			markWorkflowFailed(workflow, step.id, error, 'receipt-reverted')
			recordActivity(environment.state, {
				ecosystem: plan.ecosystem,
				hash: intent.hash,
				message: `Confirmed transaction reverted: ${step.label}`,
				operationId: plan.definitionId,
				status: 'failed',
				type: 'transaction',
			})
		})
		throw error
	}
	let afterBalances: Awaited<ReturnType<typeof captureBalanceEvidence>>
	let afterStorage: Awaited<ReturnType<typeof captureStorageEvidence>>
	try {
		afterBalances = await captureBalanceEvidence(environment, step.evidence, receipt.blockNumber)
		afterStorage = await captureStorageEvidence(environment, step.evidence, receipt.blockNumber)
	} catch (error) {
		throw await retainUnreadableReceiptEvidence(environment, intent, included.head, receipt.blockNumber, error)
	}
	let evidenceDisposition: ReceiptEvidenceDisposition
	try {
		evidenceDisposition = stepReceiptEvidenceDisposition(step, receipt, {
			balances: balanceObservations(step.evidence, beforeBalances, afterBalances),
			storage: storageObservations(step.evidence, beforeStorage, afterStorage),
		})
	} catch (error) {
		await commitReceiptDisposition(environment, intent, workflow, included.receipt, () => {
			environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
			markWorkflowFailed(workflow, step.id, error, 'semantic-failure')
			recordActivity(environment.state, {
				ecosystem: plan.ecosystem,
				hash: intent.hash,
				message: `Confirmed transaction failed semantic validation: ${step.label}`,
				operationId: plan.definitionId,
				status: 'failed',
				type: 'transaction',
			})
		})
		throw error
	}
	await commitReceiptDisposition(environment, intent, workflow, included.receipt, () => {
		environment.state.pendingTransactions = environment.state.pendingTransactions.filter(candidate => candidate.id !== intent.id)
		if (evidenceDisposition === 'waiting-canonical') markWorkflowStepWaitingCanonical(workflow, step.id, receipt.transactionHash)
		else markWorkflowStepConfirmed(workflow, step.id, receipt.transactionHash)
		recordActivity(environment.state, {
			ecosystem: plan.ecosystem,
			hash: receipt.transactionHash,
			message: evidenceDisposition === 'waiting-canonical' ? `${step.label}; waiting for canonical lifecycle confirmation` : step.label,
			operationId: plan.definitionId,
			status: evidenceDisposition === 'waiting-canonical' ? 'pending' : 'confirmed',
			type: 'transaction',
		})
	})
}

async function assertRemainingWorkflowEthFunding(environment: ExecutionEnvironment, plan: OperationPlan, workflowId: string) {
	assertExecutionActive(environment)
	const wallet = requiredExecutionWallet(environment)
	const workflow = recoverableWorkflowForIntent(environment.state, workflowId)
	const remainingSteps = plan.steps.filter(step => requireWorkflowStep(workflow, step.id).status !== 'confirmed')
	if (remainingSteps.length === 0) return
	const anchor = await agreedLatestBlock(environment, `${plan.label} workflow funding block`)
	const ethBalanceAttoEth = await exactAttestedEthBalance(environment, wallet.account.address, anchor)
	try {
		assertOperationEthFunding(
			{
				id: plan.id,
				...(plan.maximumCleanupTransactionCount === undefined ? {} : { maximumCleanupTransactionCount: plan.maximumCleanupTransactionCount }),
				steps: remainingSteps,
			},
			ethBalanceAttoEth,
			environment.settings.strategy,
		)
	} catch (error) {
		throw new OperationRediscoveryRequired(error instanceof Error ? error.message : String(error), error)
	}
}

export async function executeOperationPlan(environment: ExecutionEnvironment, plan: OperationPlan) {
	await assertIncludedTransactionsCanonical(environment)
	assertTerminalSubmissionBoundary(plan)
	if (plan.terminalSubmission !== undefined && environment.settings.submission.mode !== 'private') {
		throw new Error(`${plan.id} requires private submission before its terminal next-block constraint can be executed`)
	}
	if (environment.state.pendingTransactions.length !== 0) {
		throw new Error('Pending transaction recovery must complete before a new operation')
	}
	assertOperationPrincipalCaps(plan, environment.settings.strategy)
	const workflow = retainWorkflow(environment.state, plan)
	startWorkflow(workflow)
	recordActivity(environment.state, {
		ecosystem: plan.ecosystem,
		message: `Starting operation: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'info',
		type: 'operation',
	})
	await persist(environment)
	try {
		await assertRemainingWorkflowEthFunding(environment, plan, workflow.id)
		for (const step of plan.steps) {
			if (requireWorkflowStep(workflow, step.id).status === 'confirmed') continue
			await executeStep(environment, plan, workflow.id, step)
		}
		return workflow
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		const pending = environment.state.pendingTransactions.find(intent => intent.workflowId === workflow.id)
		if (pending !== undefined) {
			throw new TransactionAwaitingRecovery(pending.label, pending.hash, error instanceof Error ? error.message : String(error))
		}
		if (workflow.status !== 'failed') {
			markWorkflowForRediscovery(workflow, error)
			recordPreflightFailure(environment.state, plan, error, `Operation preflight stopped: ${plan.label}`)
			await persist(environment)
		}
		throw error
	}
}
