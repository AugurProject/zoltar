import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { WalletConnectionControl } from '@zoltar/ui-core-shared/components/WalletConnectionControl.js'

import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DeploymentStepList } from '@zoltar/ui-core-shared/components/DeploymentStepList.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'

import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'

import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as appCopy from '../copy/app.js'
import * as deploymentCopy from '../copy/deployment.js'
import { deployContractsGuideHref } from '../lib/docsLinks.js'
import { deploymentProgress, PlaceholderDeployAction, tradingDeploymentScope } from './tradingDeploymentPresentation.js'

import { useTradingDeploymentSetup, type TradingDeploymentSetupOptions } from './useTradingDeploymentSetup.js'

export function TradingDeploymentSetup(options: TradingDeploymentSetupOptions) {
	const { walletControlRequestNonce } = options
	const {
		busy,
		busyStepId,
		walletAccount,
		walletConnecting,
		walletConnectionMessage,
		registryLoading,
		registryError,
		coreDeployments,
		selectedCore,
		fallbackNotice,
		inputError,
		plan,
		deploymentComplete,
		deploymentSteps,
		deploymentStatus,
		inspectionState,
		inspectionError,
		inspection,
		inspectionBadgeId,
		networkNoticeId,
		wrongNetworkNotice,
		actionMessage,
		actionError,
		retryChecks,
		stepAvailability,
		connectDeploymentWallet,
		disconnectDeploymentWallet,
		deployStepNow,
		retryInspection,
	} = useTradingDeploymentSetup(options)
	let standaloneWalletButton
	if (walletControlRequestNonce === undefined)
		standaloneWalletButton =
			walletAccount !== undefined ? (
				<WalletConnectionControl disabled={busy} ariaLabel={appCopy.disconnectWalletLabel(walletAccount)} title={appCopy.disconnectWallet} onClick={disconnectDeploymentWallet} label={<ReadOnlyAddressValue address={walletAccount} responsiveAbbreviation />} />
			) : (
				<WalletConnectionControl disabled={busy || registryLoading || coreDeployments.length === 0} pending={walletConnecting} onClick={() => void connectDeploymentWallet()} pendingLabel={appCopy.connectingWallet} label={appCopy.connectWallet} />
			)
	let retryAction
	if (retryChecks)
		retryAction = (
			<button className='secondary' type='button' disabled={busy || registryLoading || inspectionState === 'loading'} onClick={retryInspection}>
				{deploymentCopy.retryChecks}
			</button>
		)
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.deploy} description={appCopy.deployRouteDescription} actions={standaloneWalletButton} />
			<SectionBlock className='deployment-setup' title={deploymentCopy.tradingContracts}>
				<ErrorNotice message={registryError} />
				<ErrorNotice message={inputError} />
				{selectedCore === undefined ? null : (
					<DataGrid dense>
						<MetricField label={deploymentCopy.deployingTo}>{selectedCore.chainName}</MetricField>
						<MetricField label={deploymentCopy.securityPoolFactory}>
							<ReadOnlyAddressValue address={selectedCore.securityPoolFactory} responsiveAbbreviation />
						</MetricField>
					</DataGrid>
				)}
				{fallbackNotice === undefined ? null : <UserMessage className='detail' tone='warning' detail={fallbackNotice} />}
				{plan === undefined || deploymentComplete ? null : <UserMessage className='detail' detail={deploymentCopy.deploymentSequence(plan.factory.label, plan.router.label)} />}
				{plan === undefined ? null : (
					<DeploymentStepList
						steps={deploymentSteps.map(({ step, presentation }) => {
							const { availability, externalReasonId } = stepAvailability(step)
							return {
								// Every contract keeps its own deploy action in place; a deployed one stays, disabled, and says so.
								action: (
									<TransactionActionButton
										scope={tradingDeploymentScope}
										availability={availability}
										disabledReasonElementId={externalReasonId}
										idleLabel={deploymentCopy.formatDeployStep(step.label)}
										pendingLabel={deploymentCopy.formatDeployingStep(step.label)}
										pending={busyStepId === step.id}
										onClick={() => void deployStepNow(step)}
										showDisabledReason={externalReasonId === undefined}
									/>
								),
								address: step.address,
								badge: presentation,
								key: step.id,
								label: step.label,
							}
						})}
					/>
				)}
				<div className='deployment-setup__status' role='status' aria-live='polite'>
					<DataGrid dense>
						<MetricField label={deploymentCopy.deploymentProgress}>{deploymentProgress(deploymentStatus)}</MetricField>
					</DataGrid>
					{inspection === undefined ? null : (
						<Badge id={inspectionBadgeId} tone={inspection.tone}>
							{inspection.label}
						</Badge>
					)}
				</div>
				{inspectionState === 'blocked' && selectedCore !== undefined ? (
					<UserMessage
						placement='section'
						tone='warning'
						className='deployment-setup__prerequisite'
						detail={deploymentCopy.statoblastRequired(selectedCore.chainName)}
						actions={
							<a className='button-link secondary-link' href={deployContractsGuideHref} target='_blank' rel='noreferrer'>
								{deploymentCopy.deploymentGuide}
							</a>
						}
					/>
				) : null}
				<ErrorNotice id={networkNoticeId} message={wrongNetworkNotice} />
				{wrongNetworkNotice === undefined || selectedCore === undefined ? null : (
					<div className='actions'>
						<button type='button' className='secondary' disabled={busy || walletConnecting} aria-busy={walletConnecting} onClick={() => void connectDeploymentWallet()}>
							{walletConnecting ? deploymentCopy.switchingToNetwork(selectedCore.chainName) : coreAppCopy.formatSwitchToNetwork(selectedCore.chainName)}
						</button>
					</div>
				)}
				<ErrorNotice message={walletConnectionMessage} />
				<ErrorNotice message={inspectionError} />
				{actionMessage === undefined || actionError ? null : <UserMessage className='detail' announcement='polite' detail={actionMessage} />}
				<ErrorNotice message={actionError ? actionMessage : undefined} />
				{plan === undefined || retryAction !== undefined ? (
					<div className='actions'>
						{/* Until the network is known there are no contract rows; one disabled action keeps the place and explains what is missing. */}
						{plan === undefined ? <PlaceholderDeployAction {...stepAvailability(undefined)} /> : null}
						{retryAction}
					</div>
				) : null}
			</SectionBlock>
		</div>
	)
}
