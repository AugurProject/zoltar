import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { createTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import * as appCopy from '../copy/app.js'
import * as deploymentCopy from '../copy/deployment.js'

/** Status labels, per-contract action availability, and the placeholder action of the trading deployment setup. */
export type DeploymentStatus = Readonly<{ factory: boolean; router: boolean }>

export function deploymentProgress(status: DeploymentStatus | undefined) {
	if (status === undefined) return commonCopy.metricUnavailablePlaceholder
	return `${Number(status.factory) + Number(status.router)} / 2`
}

export function inspectionPresentation(
	state: 'blocked' | 'idle' | 'loading' | 'ready' | 'error',
	{ busy, deploymentComplete, inputError, plan, registryError, registryLoading }: Readonly<{ busy: boolean; deploymentComplete: boolean; inputError: boolean; plan: boolean; registryError: boolean; registryLoading: boolean }>,
) {
	if (registryLoading) return { label: deploymentCopy.loadingNetworks, tone: 'muted' as const }
	if (registryError) return { label: deploymentCopy.networksUnavailable, tone: 'warning' as const }
	if (inputError) return { label: appCopy.deploymentConfigurationInvalid, tone: 'warning' as const }
	if (busy) return { label: coreAppCopy.deploymentInProgress, tone: 'muted' as const }
	if (deploymentComplete) return { label: appCopy.deploymentComplete, tone: 'ok' as const }
	if (state === 'loading') return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	if (state === 'ready') return undefined
	if (state === 'blocked') return { label: appCopy.securityPoolFactoryNotDeployed, tone: 'warning' as const }
	if (state === 'error') return { label: deploymentCopy.configurationUnavailable, tone: 'warning' as const }
	if (plan) return { label: deploymentCopy.checkingNetwork, tone: 'muted' as const }
	return { label: appCopy.deploymentNotConfigured, tone: 'muted' as const }
}

// A deployment still pending after the setup route was left keeps the deploy action locked when the route returns.
export const tradingDeploymentScope = createTransactionScope('trading-deployment', 'factory')

/**
 * Why one contract's deploy action is unavailable, so each disabled control explains itself instead of silently ignoring
 * clicks. The shared checks mirror `inspectionPresentation`, so the badge and the actions never disagree; then the
 * contract's own state (already deployed, or waiting for the contract it depends on), then the wallet.
 */
export function deploymentActionAvailability({
	busy,
	inputError,
	inspectionIsCurrent,
	inspectionState,
	prerequisiteLabel,
	registryError,
	registryLoading,
	selectedCoreChainName,
	settingsIncomplete,
	stepDeployed,
	walletConnected,
	walletReady,
}: Readonly<{
	busy: boolean
	inputError: boolean
	inspectionIsCurrent: boolean
	inspectionState: 'blocked' | 'idle' | 'loading' | 'ready' | 'error'
	/** The contract this one needs first, while it is still missing. */
	prerequisiteLabel: string | undefined
	registryError: boolean
	registryLoading: boolean
	selectedCoreChainName: string | undefined
	settingsIncomplete: boolean
	stepDeployed: boolean
	walletConnected: boolean
	walletReady: boolean
}>): ActionAvailability {
	if (registryLoading) return { disabled: true, loading: true, reason: deploymentCopy.loadingNetworks }
	if (registryError) return { disabled: true, reason: deploymentCopy.networksUnavailable }
	if (inputError) return { disabled: true, reason: appCopy.deploymentConfigurationInvalid }
	// Inspection parks in idle while the settings are incomplete; that is a settings problem, not a check in flight.
	if (settingsIncomplete) return { disabled: true, reason: appCopy.deploymentNotConfigured }
	// A settled inspection states its result even when it never recorded a revision, as a failed read does.
	if (inspectionState === 'blocked') return { disabled: true, reason: appCopy.securityPoolFactoryNotDeployed }
	if (inspectionState === 'error') return { disabled: true, reason: deploymentCopy.configurationUnavailable }
	if (!inspectionIsCurrent || inspectionState === 'loading' || inspectionState === 'idle') return { disabled: true, loading: true, reason: deploymentCopy.checkingNetwork }
	if (stepDeployed) return { disabled: true, reason: commonCopy.deployed }
	if (busy) return { disabled: true, reason: coreAppCopy.deploymentInProgress }
	if (prerequisiteLabel !== undefined) return { disabled: true, reason: deploymentCopy.deployPrerequisiteFirst(prerequisiteLabel) }
	if (!walletConnected) return { disabled: true, reason: commonCopy.walletConnectionRequired }
	if (!walletReady) return { disabled: true, reason: selectedCoreChainName === undefined ? deploymentCopy.configurationUnavailable : deploymentCopy.walletMustUseNetwork(selectedCoreChainName) }
	return { disabled: false, reason: undefined }
}

export function contractStatusPresentation(deployed: boolean | undefined, isNext: boolean, inspectionFailed = false) {
	if (deployed === undefined) return { label: inspectionFailed ? deploymentCopy.contractStatusUnavailable : appCopy.checkingContract, tone: 'muted' as const }
	if (deployed) return { label: commonCopy.deployed, tone: 'ok' as const }
	if (isNext) return { label: deploymentCopy.nextToDeploy, tone: 'muted' as const }
	return { label: commonCopy.notDeployed, tone: 'warning' as const }
}

export function PlaceholderDeployAction({ availability, externalReasonId }: { availability: ActionAvailability; externalReasonId: string | undefined }) {
	return (
		<TransactionActionButton
			scope={tradingDeploymentScope}
			availability={availability.disabled ? availability : { disabled: true, loading: true, reason: deploymentCopy.checkingNetwork }}
			disabledReasonElementId={externalReasonId}
			idleLabel={deploymentCopy.deployTradingContracts}
			pendingLabel={deploymentCopy.deployTradingContracts}
			onClick={() => undefined}
			showDisabledReason={externalReasonId === undefined}
		/>
	)
}
