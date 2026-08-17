const WALLET_STATE_ONLY_REFRESH_OPTIONS = {
    loadChainClock: false,
    loadDeploymentState: false,
};
export async function refreshWalletStateOnly(refreshState) {
    await refreshState(WALLET_STATE_ONLY_REFRESH_OPTIONS);
}
//# sourceMappingURL=refreshState.js.map