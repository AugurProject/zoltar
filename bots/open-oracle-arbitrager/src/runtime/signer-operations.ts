import { acquireExecutorDeploymentIntentLock, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { type ExecutorDeploymentRecoveryStatus } from '#state/executor-deployment-recovery'
import { type Hex } from '@zoltar/bot-shared/ethereum'
import { ProcessLockHeldError } from '@zoltar/bot-shared/execution/process-lock'
import { type SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'

/**
 * Mirrors the durable executor deployment journal so the scan can skip signing and the dashboard can name the pending transaction.
 * The object is shared by reference between the scan loop and the control plane, so transitions assign in place.
 */
export type DeploymentRecoveryState = { pending: false; transactionHash?: undefined } | { pending: true; transactionHash: Hex }

function markDeploymentRecoveryPending(deploymentRecovery: DeploymentRecoveryState, transactionHash: Hex) {
	Object.assign(deploymentRecovery, { pending: true, transactionHash })
}

export function clearDeploymentRecovery(deploymentRecovery: DeploymentRecoveryState) {
	Object.assign(deploymentRecovery, { pending: false, transactionHash: undefined })
}

export function executorDeploymentRecoveryStatus(deploymentRecovery: DeploymentRecoveryState): ExecutorDeploymentRecoveryStatus | undefined {
	return deploymentRecovery.pending ? { transactionHash: deploymentRecovery.transactionHash } : undefined
}

/** How the scan proves an externally reconciled journal is settled: verified executor bytecode is the only evidence it accepts. */
export type DeploymentRecoveryReconciliation = {
	onReconciled: (transactionHash: Hex) => void
	verifyExecutorDeployed: () => Promise<boolean>
}

/**
 * Takes the scan's turn on the signer unless an executor deployment recovery is pending. A journal on disk always keeps the
 * scan out. A pending state without a journal means another process (the CLI) reconciled it or the journal write itself was
 * uncertain; the scan resumes only once the reconciliation check verifies the executor bytecode, because until then the
 * signed transaction could still be broadcast against the nonce the scan would use. That check is an RPC round-trip, so it
 * runs before the journal lock is taken: the CLI and the dashboard acquire that lock without retrying.
 */
export async function acquireScanSignerOperation(signerOperationGate: SignerOperationGate, deploymentRecovery: DeploymentRecoveryState, intentPath: string, reconciliation?: DeploymentRecoveryReconciliation) {
	if (deploymentRecovery.pending) {
		if (reconciliation === undefined) return undefined
		const journaled = await loadExecutorDeploymentIntent(intentPath)
		if (journaled !== undefined) {
			markDeploymentRecoveryPending(deploymentRecovery, journaled.transactionHash)
			return undefined
		}
		if (!(await reconciliation.verifyExecutorDeployed())) return undefined
	}
	let intentLock: Awaited<ReturnType<typeof acquireExecutorDeploymentIntentLock>>
	try {
		intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
	} catch (error) {
		// A deployment in progress owns the journal; a pending recovery stays deferred until it finishes instead of failing the poll.
		if (deploymentRecovery.pending && error instanceof ProcessLockHeldError) return undefined
		throw error
	}
	try {
		const intent = await loadExecutorDeploymentIntent(intentPath)
		if (intent !== undefined) {
			markDeploymentRecoveryPending(deploymentRecovery, intent.transactionHash)
			await intentLock.release()
			return undefined
		}
		if (deploymentRecovery.pending) {
			const reconciledTransactionHash = deploymentRecovery.transactionHash
			clearDeploymentRecovery(deploymentRecovery)
			reconciliation?.onReconciled(reconciledTransactionHash)
		}
		if (!signerOperationGate.acquire('scan')) {
			await intentLock.release()
			return undefined
		}
		return intentLock
	} catch (error) {
		await intentLock.release()
		throw error
	}
}

export async function acquireConfigurationSignerOperation(signerOperationGate: SignerOperationGate) {
	while (!signerOperationGate.acquire('configuration')) await Bun.sleep(10)
}

export async function runConfigurationSignerOperation<T>(signerOperationGate: SignerOperationGate, operation: () => Promise<T>) {
	await acquireConfigurationSignerOperation(signerOperationGate)
	try {
		return await operation()
	} finally {
		signerOperationGate.release('configuration')
	}
}

export async function persistExecutorDeploymentIntentForRecovery(path: string, intent: Parameters<typeof saveExecutorDeploymentIntent>[1], deploymentRecovery: DeploymentRecoveryState) {
	markDeploymentRecoveryPending(deploymentRecovery, intent.transactionHash)
	await saveExecutorDeploymentIntent(path, intent)
}
