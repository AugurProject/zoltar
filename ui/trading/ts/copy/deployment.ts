import { endSentence } from '../lib/format.js'

export const loadingNetworks = 'Loading networks…'
export const networksUnavailable = 'Networks unavailable'
export const walletNetworkUnavailableReason = 'Available once the deployment network list loads.'
export const checkingNetwork = 'Checking network…'
export const configurationUnavailable = 'Configuration unavailable'
export const deployTradingContracts = 'Deploy trading contracts'
export const nextContractFallbackLabel = 'the next contract'
export const nextToDeploy = 'Next to deploy'
export const walletChanged = 'Your wallet account or network changed. Reconnect before deploying.'
export const walletChangedBeforeDeployment = 'Your wallet account or network changed before deployment. No transaction was submitted.'
export const walletChangedDuringDeployment = 'Your wallet account or network changed during deployment. Verify the transaction before continuing.'
export const retryChecks = 'Retry checks'
export const securityPoolFactory = 'Security pool factory'
export const tradingContracts = 'Trading contracts'
export const deploymentProgress = 'Deployment progress'
export const walletNotFound = 'No browser wallet was found.'
export const walletConnectionUnavailable = 'Wallet connection is unavailable.'
export const walletChangedDuringConnection = 'Your wallet account or network changed while connecting. Try again.'
export const activeWalletChangedDuringConnection = 'The active wallet changed while connecting. Try again.'
export const walletConnectionFailed = 'Wallet connection failed.'
export const deploymentUnavailable = 'Trading deployment is unavailable.'
export const supportedNetworksUnavailable = 'Unable to load the supported networks.'
export const inspectionFailed = 'Unable to check the selected deployment.'
export const deploymentConfigurationInvalid = 'Deployment configuration is invalid.'
export const statusCheckFailed = 'The status check failed.'
export const contractStatusUnavailable = 'Status unavailable'
export const deploymentGuide = 'Deployment guide'

/** The blocked state's next step: Trading's contracts derive from Statoblast's, which another app deploys first. */
export function statoblastRequired(networkName: string) {
	return `Trading needs the Statoblast contracts on ${networkName}. Deploy Statoblast there first; this page continues once it finds them.`
}

/** A contract that depends on another waits for it, such as the router for the factory. */
export function deployPrerequisiteFirst(label: string) {
	return `Deploy the ${inSentence(label)} first.`
}

/** Step labels are capitalized for lists; inside a button or sentence they continue in lower case. */
function inSentence(label: string) {
	return `${label.charAt(0).toLowerCase()}${label.slice(1)}`
}

export function walletMustUseNetwork(networkName: string) {
	return `Wallet must use ${networkName}.`
}

export function connectedWalletMustUseNetwork(networkName: string) {
	return `The connected wallet must use ${networkName}.`
}

export function switchingToNetwork(networkName: string) {
	return `Switching to ${networkName}…`
}

export const deployingTo = 'Deploying to'

export function formatDeployStep(label: string) {
	return `Deploy ${inSentence(label)}`
}

export function formatDeployingStep(label: string) {
	return `Deploying ${inSentence(label)}…`
}

export function deploymentSequence(firstLabel: string, secondLabel: string) {
	return `Deployment takes two wallet transactions: the ${inSentence(firstLabel)}, then the ${inSentence(secondLabel)}.`
}

export function networkFallback(requestedNetwork: string, deploymentNetwork: string) {
	return `${requestedNetwork} is not a supported network, so this deploys to ${deploymentNetwork} instead.`
}

export function chainLabel(chainId: string) {
	return `Chain ${chainId}`
}

export function contractDeployedContinue(label: string, nextLabel: string) {
	return `${label} deployed. Continue with ${inSentence(nextLabel)}.`
}

export function contractAlreadyInstalledContinue(label: string, nextLabel: string) {
	return `${label} is already deployed. Continue with ${inSentence(nextLabel)}.`
}

export function deployFailed(label: string) {
	return `Failed to deploy the ${inSentence(label)}.`
}

export function deploymentStatusUnverified(detail: string, recoveryDetail: string) {
	return `${endSentence(detail)} Unable to verify deployment status: ${endSentence(recoveryDetail)}`
}

export function broadcastWithoutCompletion(hash: string, detail: string) {
	return `Transaction ${hash} was broadcast but setup did not finish. Verify it in your wallet before retrying. ${endSentence(detail)}`
}
