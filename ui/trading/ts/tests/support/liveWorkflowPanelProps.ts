import type { LiveWorkflowContext, LiveWorkflowPanelProps } from '../../features/live/liveTradingTypes.js'

/** Controller wiring that runs every wallet action and guarded write directly and ignores receipts and lock changes. */
export const passthroughWorkflowContext: Pick<LiveWorkflowContext, 'externallyLocked' | 'onKnownReceipt' | 'executeWithCurrentWalletContext' | 'createGuardedWalletWrite' | 'onWorkflowLockChange'> = {
	externallyLocked: false,
	onKnownReceipt: () => undefined,
	executeWithCurrentWalletContext: async (_account, _networkFailure, _accountFailure, action) => await action(),
	createGuardedWalletWrite: () => async write => await write(),
	onWorkflowLockChange: () => undefined,
}

/** Liquidity and settlement panel props for a wallet on the deployment chain with no balance error; panels render the passthrough controller wiring. */
export const passthroughWorkflowPanelProps: Pick<LiveWorkflowPanelProps, keyof typeof passthroughWorkflowContext | 'balanceError' | 'networkMismatchReason' | 'wallet' | 'retryBalances'> = {
	...passthroughWorkflowContext,
	balanceError: undefined,
	networkMismatchReason: undefined,
	wallet: { actionLabel: 'Connect wallet', connect: async () => undefined },
	retryBalances: async () => undefined,
}
