import { acquireExecutorDeploymentIntentLock, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { type ExecutorDeploymentRecoveryStatus } from '#state/executor-deployment-recovery'
import { type Hex } from '@zoltar/bot-shared/ethereum'
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

export async function acquireScanSignerOperation(signerOperationGate: SignerOperationGate, deploymentRecovery: DeploymentRecoveryState, intentPath: string) {
	if (deploymentRecovery.pending) return undefined
	const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
	try {
		const intent = await loadExecutorDeploymentIntent(intentPath)
		if (intent !== undefined) {
			markDeploymentRecoveryPending(deploymentRecovery, intent.transactionHash)
			await intentLock.release()
			return undefined
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
