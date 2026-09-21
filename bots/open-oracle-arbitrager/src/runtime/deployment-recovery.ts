import { type Configuration } from '#config/configuration'
import { verifyCanonicalExecutorDeployed } from '#config/runtime-deployment'
import { type ReadClient } from '#core/operator-types'
import { assertStoredExecutorDeploymentIntent } from '#execution/create2-executor'
import { loadExecutorDeploymentIntentForChain } from '#execution/executor-deployment-store'
import { recordOperation, type OperatorState } from '#state/operator-state'
import { type DeploymentRecoveryReconciliation, type DeploymentRecoveryState } from './signer-operations.ts'

/** Loads the journal left by an interrupted executor deployment and pauses the operator until it is reconciled. */
export async function loadDeploymentRecovery(intentPath: string, config: Configuration, state: Pick<OperatorState, 'operationLog' | 'paused' | 'status'>): Promise<DeploymentRecoveryState> {
	const pendingExecutorDeployment = await loadExecutorDeploymentIntentForChain(intentPath, config.network.chain.id)
	if (pendingExecutorDeployment === undefined) return { pending: false }
	await assertStoredExecutorDeploymentIntent(pendingExecutorDeployment, config.network.chain.id)
	state.paused = true
	state.status = 'paused'
	recordOperation(state, {
		category: 'configuration',
		details: pendingExecutorDeployment.transactionHash,
		level: 'error',
		message: 'Execution paused for pending executor deployment recovery',
		reason: 'Retry the executor deployment to reconcile its durable signed transaction before resuming',
		reportId: undefined,
	})
	return { pending: true, transactionHash: pendingExecutorDeployment.transactionHash }
}

/**
 * A journal reconciled outside this process (the CLI) is accepted once the configured read quorum shows the executor bytecode.
 * The checklist refreshes on the scan that follows, so this check deliberately reads nothing else.
 */
export function createDeploymentRecoveryReconciliation(parameters: { config: Configuration; readClients: () => readonly ReadClient[]; state: Pick<OperatorState, 'operationLog'> }): DeploymentRecoveryReconciliation {
	const { config, state } = parameters
	return {
		onReconciled: transactionHash =>
			recordOperation(state, {
				category: 'configuration',
				details: transactionHash,
				level: 'info',
				message: 'Executor deployment recovery reconciled externally',
				reason: 'The journal is gone and the executor bytecode is verified, so scanning resumes; the operator still resumes execution explicitly',
				reportId: undefined,
			}),
		verifyExecutorDeployed: async () => {
			// An unconfigured operator has only placeholder endpoints; it stays paused for recovery until the chain is configured.
			if (!config.networkConfigured) return false
			return await verifyCanonicalExecutorDeployed(parameters.readClients(), config)
		},
	}
}
