export const loadingNetworks = 'Loading networks'
export const networksUnavailable = 'Networks unavailable'
export const deploymentInProgress = 'Deployment in progress'
export const checkingNetwork = 'Checking network'
export const configurationUnavailable = 'Configuration unavailable'
export const deployTradingContracts = 'Deploy trading contracts'
export const contractFallbackLabel = 'contract'
export const nextContractFallbackLabel = 'the next contract'
export const deployed = 'Deployed'
export const nextToDeploy = 'Next to deploy'
export const notDeployed = 'Not deployed'
export const walletContextChanged = 'Wallet context changed. Reconnect before deploying.'
export const walletContextChangedBeforeDeployment = 'Wallet context changed before deployment; no transaction was submitted'
export const walletContextChangedDuringDeployment = 'Wallet context changed during deployment; verify the transaction before continuing'
export const retryChecks = 'Retry checks'
export const securityPoolFactory = 'SecurityPoolFactory'
export const tradingContracts = 'Trading contracts'
export const deploymentProgress = 'Deployment progress'
export const progressUnavailable = '—'
export const noInjectedWallet = 'No injected wallet was found'
export const walletConnectionServiceUnavailable = 'Wallet connection service is unavailable'
export const walletContextChangedDuringConnection = 'Wallet context changed during connection'
export const walletProviderChangedDuringConnection = 'Wallet provider changed during connection'
export const walletConnectionFailed = 'Wallet connection failed'
export const deploymentServiceUnavailable = 'Trading deployment service is unavailable'
export const coreDeploymentsUnavailable = 'Unable to load canonical core deployments'
export const inspectionFailed = 'Unable to inspect the selected deployment'
export const deploymentSettingsInvalid = 'Deployment settings are invalid'
export const unknownRecoveryFallback = 'Unknown recovery error'

export function deployingContract(label: string) {
	return `Deploying ${label}…`
}

export function deployContract(label: string) {
	return `Deploy ${label}`
}

export function walletMustUseNetwork(networkName: string) {
	return `Wallet must use ${networkName}`
}

export function connectedWalletMustUseNetwork(networkName: string) {
	return `The connected wallet must use ${networkName}. Reconnect to switch networks.`
}

export function contractDeployedContinue(label: string, nextLabel: string) {
	return `${label} deployed. Continue with ${nextLabel}.`
}

export function contractAlreadyInstalledContinue(label: string, nextLabel: string) {
	return `${label} is already installed. Continue with ${nextLabel}.`
}

export function deployFailed(label: string) {
	return `Failed to deploy ${label}`
}

export function deploymentStatusUnverified(detail: string, recoveryDetail: string) {
	return `${detail} Unable to verify deployment status: ${recoveryDetail}`
}

export function broadcastWithoutCompletion(hash: string, detail: string) {
	return `Transaction ${hash} was broadcast but setup did not finish. Verify it in your wallet before retrying. ${detail}`
}
