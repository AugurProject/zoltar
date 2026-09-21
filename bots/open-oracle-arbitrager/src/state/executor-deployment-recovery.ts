import type { Hex } from '@zoltar/bot-shared/ethereum'

/** A signed executor deployment whose durable journal has not been reconciled yet; resuming stays blocked until it is. */
export type ExecutorDeploymentRecoveryStatus = { transactionHash: Hex }

/**
 * Executor deployment refusals the dashboard forwards verbatim because each names the operator step that unblocks it.
 * The runtime throws these exact strings; the server allow-list and the browser match against the same constants.
 */
export const EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED = 'Recover the pending executor deployment before resuming execution'
export const RESUME_REQUIRES_CONFIGURED_CHAIN = 'Configure the chain and RPC endpoints before resuming'
export const EXECUTOR_DEPLOYMENT_MESSAGES = {
	intentMismatch: 'Pending executor deployment intent does not match the active signer, chain, address, and salt',
	notIncludedBeforeDeadline: 'Executor deployment was not included in a block before the confirmation deadline',
	pauseBeforeDeploying: 'Pause execution before deploying with the active signer',
	publicRpcRequired: 'Configure a public submission RPC before deploying the executor',
	quorumReceiptMissing: 'Stored executor deployment transaction has no quorum-visible receipt; recovery remains pending',
	readEndpointsRequired: 'Executor deployment requires three independently configured read RPC endpoints',
	signerOperationBusy: 'Wait for the active signer operation to finish before deploying the executor',
	signerRequired: 'Set an execution signer before deploying the executor',
	waitForSavedNetwork: 'Wait for the saved network to apply at the next scan boundary before deploying the executor',
	waitForSavedRpcQuorum: 'Wait for the saved RPC agreement requirement to apply at the next scan boundary before deploying the executor',
} as const
