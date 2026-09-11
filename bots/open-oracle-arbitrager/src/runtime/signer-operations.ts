import { acquireExecutorDeploymentIntentLock, loadExecutorDeploymentIntent, saveExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { type SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'

export type DeploymentRecoveryState = { pending: boolean }

export async function acquireScanSignerOperation(signerOperationGate: SignerOperationGate, deploymentRecovery: DeploymentRecoveryState, intentPath: string) {
	if (deploymentRecovery.pending) return undefined
	const intentLock = await acquireExecutorDeploymentIntentLock(intentPath)
	try {
		if ((await loadExecutorDeploymentIntent(intentPath)) !== undefined) {
			deploymentRecovery.pending = true
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
	deploymentRecovery.pending = true
	await saveExecutorDeploymentIntent(path, intent)
}
