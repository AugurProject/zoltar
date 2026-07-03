import type { RefreshStateOptions, WriteOperationsParameters } from '../types/app.js'

const WALLET_STATE_ONLY_REFRESH_OPTIONS = {
	loadChainClock: false,
	loadDeploymentState: false,
} satisfies RefreshStateOptions

export async function refreshWalletStateOnly(refreshState: WriteOperationsParameters['refreshState']) {
	await refreshState(WALLET_STATE_ONLY_REFRESH_OPTIONS)
}
