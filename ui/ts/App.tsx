import { useState } from 'preact/hooks'
import type { Hash } from 'viem'
import { DeploymentSection } from './components/DeploymentSection.js'
import { HeroSection } from './components/HeroSection.js'
import { MarketSection } from './components/MarketSection.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { TabNavigation } from './components/TabNavigation.js'
import { useDeploymentFlow } from './hooks/useDeploymentFlow.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useMarketCreation } from './hooks/useMarketCreation.js'
import { useOnchainState } from './hooks/useOnchainState.js'
import { getDeploymentSections } from './lib/deployment.js'
import { DEPLOY_ROUTE, MARKET_ROUTE } from './lib/routing.js'

export function App() {
	const [lastTransactionHash, setLastTransactionHash] = useState<Hash | null>(null)
	const { route, setRoute } = useHashRoute()
	const { accountState, connectWallet, deploymentStatuses, errorMessage: walletErrorMessage, hasInjectedWallet, isRefreshing, refreshState } = useOnchainState()
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { createMarket, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm } = useMarketCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage

	return (
		<main>
			<HeroSection accountAddress={accountState.address} isRefreshing={isRefreshing} onRefresh={() => void refreshState()} onConnect={() => void connectWallet()} />

			{hasInjectedWallet ? null : <p class='notice warning'>No injected wallet detected. Open this page in a browser with MetaMask or another EIP-1193 wallet.</p>}
			{errorMessage === null ? null : <p class='notice error'>{errorMessage}</p>}
			{lastTransactionHash === null ? null : (
				<p class='notice success'>
					Last transaction: <span>{lastTransactionHash}</span>
				</p>
			)}

			<OverviewPanels accountState={accountState} deploymentStatuses={deploymentStatuses} busyStepId={busyStepId} onDeployNextMissing={() => void deployNextMissing()} />

			<TabNavigation route={route} deployRoute={DEPLOY_ROUTE} marketRoute={MARKET_ROUTE} onRouteChange={setRoute} />

			{route === 'deploy' ? (
				<>
					{deploymentSections.map(section => (
						<DeploymentSection
							key={section.title}
							title={section.title}
							steps={section.steps}
							allSteps={deploymentStatuses}
							accountAddress={accountState.address}
							busyStepId={busyStepId}
							onDeploy={deployStep}
						/>
					))}
				</>
			) : (
				<MarketSection
					accountState={accountState}
					deploymentStatuses={deploymentStatuses}
					marketForm={marketForm}
					marketCreating={marketCreating}
					marketResult={marketResult}
					marketError={marketError}
					onMarketFormChange={update => setMarketForm(current => ({ ...current, ...update }))}
					onCreateMarket={() => void createMarket()}
					onResetMarket={resetMarket}
				/>
			)}
		</main>
	)
}
