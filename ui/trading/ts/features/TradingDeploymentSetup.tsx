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
import { deploymentProgress, PlaceholderDeployAction } from './tradingDeploymentPresentation.js'

import { useTradingDeploymentSetup, type TradingDeploymentSetupOptions } from './useTradingDeploymentSetup.js'

export function TradingDeploymentSetup(options: TradingDeploymentSetupOptions) {
	const { walletControlRequestNonce } = options
	const { network, wallet, inspection, actions } = useTradingDeploymentSetup(options)
	let standaloneWalletButton
	if (walletControlRequestNonce === undefined)
		standaloneWalletButton =
			wallet.account !== undefined ? (
				<WalletConnectionControl disabled={actions.busy} ariaLabel={appCopy.disconnectWalletLabel(wallet.account)} title={appCopy.disconnectWallet} onClick={actions.disconnectWallet} label={<ReadOnlyAddressValue address={wallet.account} />} />
			) : (
				<WalletConnectionControl disabled={!wallet.canConnect} pending={wallet.connecting} onClick={() => void actions.connectWallet()} pendingLabel={appCopy.connectingWallet} label={appCopy.connectWallet} />
			)
	let retryAction
	if (inspection.canRetry)
		retryAction = (
			<button className='secondary' type='button' disabled={actions.busy || network.loading || inspection.phase === 'loading'} onClick={actions.retryInspection}>
				{deploymentCopy.retryChecks}
			</button>
		)
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.deploy} description={appCopy.deployRouteDescription} actions={standaloneWalletButton} />
			<SectionBlock className='deployment-setup' title={deploymentCopy.tradingContracts}>
				<ErrorNotice message={network.error} />
				<ErrorNotice message={network.configurationError} />
				{network.core === undefined ? null : (
					<DataGrid dense>
						<MetricField label={deploymentCopy.deployingTo}>{network.core.chainName}</MetricField>
						<MetricField label={deploymentCopy.securityPoolFactory}>
							<ReadOnlyAddressValue address={network.core.securityPoolFactory} />
						</MetricField>
					</DataGrid>
				)}
				{network.fallbackNotice === undefined ? null : <UserMessage className='detail' tone='warning' detail={network.fallbackNotice} />}
				{inspection.plan === undefined || inspection.complete ? null : <UserMessage className='detail' detail={deploymentCopy.deploymentSequence(inspection.plan.factory.label, inspection.plan.router.label)} />}
				{inspection.plan === undefined ? null : (
					<DeploymentStepList
						steps={inspection.steps.map(({ step, presentation }) => {
							const { availability, externalReasonId } = actions.availabilityFor(step)
							return {
								// Every contract keeps its own deploy action in place; a deployed one stays, disabled, and says so.
								action: (
									<TransactionActionButton
										scope={actions.scope}
										availability={availability}
										disabledReasonElementId={externalReasonId}
										idleLabel={deploymentCopy.formatDeployStep(step.label)}
										pendingLabel={deploymentCopy.formatDeployingStep(step.label)}
										pending={actions.pendingStepId === step.id}
										onClick={() => void actions.deployStep(step)}
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
						<MetricField label={deploymentCopy.deploymentProgress}>{deploymentProgress(inspection.status)}</MetricField>
					</DataGrid>
					{inspection.badge === undefined ? null : (
						<Badge id={inspection.badgeId} tone={inspection.badge.tone}>
							{inspection.badge.label}
						</Badge>
					)}
				</div>
				{inspection.phase === 'blocked' && network.core !== undefined ? (
					<UserMessage
						placement='section'
						tone='warning'
						className='deployment-setup__prerequisite'
						detail={deploymentCopy.statoblastRequired(network.core.chainName)}
						actions={
							<a className='button-link secondary-link' href={deployContractsGuideHref} target='_blank' rel='noreferrer'>
								{deploymentCopy.deploymentGuide}
							</a>
						}
					/>
				) : null}
				<ErrorNotice id={wallet.networkNoticeId} message={wallet.networkNotice} />
				{wallet.networkNotice === undefined || network.core === undefined ? null : (
					<div className='actions'>
						<button type='button' className='secondary' disabled={actions.busy || wallet.connecting} aria-busy={wallet.connecting} onClick={() => void actions.connectWallet()}>
							{wallet.connecting ? deploymentCopy.switchingToNetwork(network.core.chainName) : coreAppCopy.formatSwitchToNetwork(network.core.chainName)}
						</button>
					</div>
				)}
				<ErrorNotice message={wallet.connectionMessage} />
				<ErrorNotice message={inspection.message} />
				{actions.feedback === undefined || actions.feedback.failed ? null : <UserMessage className='detail' announcement='polite' detail={actions.feedback.message} />}
				<ErrorNotice message={actions.feedback?.failed ? actions.feedback.message : undefined} />
				{inspection.plan === undefined || retryAction !== undefined ? (
					<div className='actions'>
						{/* Until the network is known there are no contract rows; one disabled action keeps the place and explains what is missing. */}
						{inspection.plan === undefined ? <PlaceholderDeployAction {...actions.availabilityFor(undefined)} /> : null}
						{retryAction}
					</div>
				) : null}
			</SectionBlock>
		</div>
	)
}
