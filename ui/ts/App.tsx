import { useState } from 'preact/hooks'
import type { Hash } from 'viem'
import { DeploymentSection } from './components/DeploymentSection.js'
import { HeroSection } from './components/HeroSection.js'
import { MarketSection } from './components/MarketSection.js'
import { OpenOracleSection } from './components/OpenOracleSection.js'
import { ReportingSection } from './components/ReportingSection.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { SecurityPoolSection } from './components/SecurityPoolSection.js'
import { SecurityPoolsOverviewSection } from './components/SecurityPoolsOverviewSection.js'
import { SecurityVaultSection } from './components/SecurityVaultSection.js'
import { TabNavigation } from './components/TabNavigation.js'
import { TradingSection } from './components/TradingSection.js'
import { useDeploymentFlow } from './hooks/useDeploymentFlow.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useMarketCreation } from './hooks/useMarketCreation.js'
import { useOpenOracleOperations } from './hooks/useOpenOracleOperations.js'
import { useOnchainState } from './hooks/useOnchainState.js'
import { useReportingOperations } from './hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from './hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from './hooks/useSecurityPoolsOverview.js'
import { useSecurityVaultOperations } from './hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from './hooks/useTradingOperations.js'
import { getDeploymentSections } from './lib/deployment.js'
import { DEPLOY_ROUTE, MARKET_ROUTE, OPEN_ORACLE_ROUTE, REPORTING_ROUTE, SECURITY_POOLS_OVERVIEW_ROUTE, SECURITY_POOL_ROUTE, SECURITY_VAULT_ROUTE, TRADING_ROUTE } from './lib/routing.js'

export function App() {
	const [lastTransactionHash, setLastTransactionHash] = useState<Hash | undefined>(undefined)
	const { navigate, route } = useHashRoute()
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
	const { createPool, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } = useSecurityPoolCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { approveRep, depositRep, loadSecurityVault, loadingSecurityVault, redeemFees, redeemRep, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult, setSecurityVaultForm, updateVaultFees } = useSecurityVaultOperations({
		accountAddress: accountState.address,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { approveToken1, approveToken2, loadOracleManager, loadingOracleManager, onRequestPrice, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails, setOpenOracleForm, settleReport, submitInitialReport } = useOpenOracleOperations({
		accountAddress: accountState.address,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({
		accountAddress: accountState.address,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { liquidationAmount, liquidationTargetVault, loadingSecurityPools, queueLiquidation, securityPoolOverviewError, securityPoolOverviewResult, securityPools, setLiquidationAmount, setLiquidationTargetVault, loadSecurityPools } = useSecurityPoolsOverview({
		accountAddress: accountState.address,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const { createCompleteSet, redeemCompleteSet, setTradingForm, tradingError, tradingForm, tradingResult } = useTradingOperations({
		accountAddress: accountState.address,
		onTransaction: setLastTransactionHash,
		refreshState,
	})
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const lastCreatedQuestionId = marketResult?.questionId
	const wrongNetworkMessage = accountState.address !== undefined && !accountState.isMainnet ? 'This application requires Ethereum mainnet. Switch your wallet to Ethereum mainnet before using deployment, market, oracle, reporting, vault, pool, or trading actions.' : undefined

	return (
		<main>
			<HeroSection accountAddress={accountState.address} isRefreshing={isRefreshing} onRefresh={() => void refreshState()} onConnect={() => void connectWallet()} />

			{hasInjectedWallet ? null : <p class='notice warning'>No injected wallet detected. Open this page in a browser with MetaMask or another EIP-1193 wallet.</p>}
			{wrongNetworkMessage === undefined ? null : <p class='notice warning'>{wrongNetworkMessage}</p>}
			{errorMessage === undefined ? null : <p class='notice error'>{errorMessage}</p>}
			{lastTransactionHash === undefined ? null : (
				<p class='notice success'>
					Last transaction: <span>{lastTransactionHash}</span>
				</p>
			)}

			<OverviewPanels accountState={accountState} deploymentStatuses={deploymentStatuses} busyStepId={busyStepId} onDeployNextMissing={() => void deployNextMissing()} />

			<TabNavigation route={route} deployRoute={DEPLOY_ROUTE} marketRoute={MARKET_ROUTE} openOracleRoute={OPEN_ORACLE_ROUTE} reportingRoute={REPORTING_ROUTE} securityPoolRoute={SECURITY_POOL_ROUTE} securityPoolsOverviewRoute={SECURITY_POOLS_OVERVIEW_ROUTE} securityVaultRoute={SECURITY_VAULT_ROUTE} tradingRoute={TRADING_ROUTE} onRouteChange={navigate} />

			{route === 'deploy' ? (
				<>
					{deploymentSections.map(section => (
						<DeploymentSection
							key={section.title}
							title={section.title}
							steps={section.steps}
							allSteps={deploymentStatuses}
							accountAddress={accountState.address}
							isMainnet={accountState.isMainnet}
							busyStepId={busyStepId}
							onDeploy={deployStep}
						/>
					))}
				</>
			) : route === 'markets' ? (
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
			) : route === 'security-pools' ? (
				<SecurityPoolSection
					accountState={accountState}
					deploymentStatuses={deploymentStatuses}
					lastCreatedQuestionId={lastCreatedQuestionId}
					marketDetails={marketDetails}
					loadingMarketDetails={loadingMarketDetails}
					securityPoolCreating={securityPoolCreating}
					securityPoolError={securityPoolError}
					securityPoolForm={securityPoolForm}
					securityPoolResult={securityPoolResult}
					onLoadLatestMarket={() => {
						if (lastCreatedQuestionId === undefined) return
						setSecurityPoolForm(current => ({ ...current, marketId: lastCreatedQuestionId }))
						void loadMarketById(lastCreatedQuestionId)
					}}
					onLoadMarket={() => void loadMarket()}
					onSecurityPoolFormChange={update => setSecurityPoolForm(current => ({ ...current, ...update }))}
					onCreateSecurityPool={() => void createPool()}
				/>
			) : route === 'security-pools-overview' ? (
				<SecurityPoolsOverviewSection
					accountState={accountState}
					liquidationAmount={liquidationAmount}
					liquidationTargetVault={liquidationTargetVault}
					loadingSecurityPools={loadingSecurityPools}
					onLiquidationAmountChange={setLiquidationAmount}
					onLiquidationTargetVaultChange={setLiquidationTargetVault}
					onLoadSecurityPools={() => void loadSecurityPools()}
					onQueueLiquidation={(managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress)}
					securityPoolOverviewError={securityPoolOverviewError}
					securityPoolOverviewResult={securityPoolOverviewResult}
					securityPools={securityPools}
				/>
			) : route === 'security-vaults' ? (
				<SecurityVaultSection
					accountState={accountState}
					loadingSecurityVault={loadingSecurityVault}
					onApproveRep={() => void approveRep()}
					onDepositRep={() => void depositRep()}
					onLoadSecurityVault={() => void loadSecurityVault()}
					onRedeemFees={() => void redeemFees()}
					onRedeemRep={() => void redeemRep()}
					onSecurityVaultFormChange={update => setSecurityVaultForm(current => ({ ...current, ...update }))}
					onUpdateVaultFees={() => void updateVaultFees()}
					securityVaultDetails={securityVaultDetails}
					securityVaultError={securityVaultError}
					securityVaultForm={securityVaultForm}
					securityVaultResult={securityVaultResult}
				/>
			) : route === 'open-oracle' ? (
				<OpenOracleSection
					accountState={accountState}
					loadingOracleManager={loadingOracleManager}
					onApproveToken1={() => void approveToken1()}
					onApproveToken2={() => void approveToken2()}
					onLoadOracleManager={() => void loadOracleManager()}
					onOpenOracleFormChange={update => setOpenOracleForm(current => ({ ...current, ...update }))}
					onRequestPrice={() => void onRequestPrice()}
					onSettleReport={() => void settleReport()}
					onSubmitInitialReport={() => void submitInitialReport()}
					openOracleError={openOracleError}
					openOracleForm={openOracleForm}
					openOracleResult={openOracleResult}
					oracleManagerDetails={oracleManagerDetails}
				/>
			) : route === 'reporting' ? (
				<ReportingSection
					accountState={accountState}
					loadingReportingDetails={loadingReportingDetails}
					onLoadReporting={() => void loadReporting()}
					onReportOutcome={() => void onReportOutcome()}
					onReportingFormChange={update => setReportingForm(current => ({ ...current, ...update }))}
					onWithdrawEscalation={() => void withdrawEscalation()}
					reportingDetails={reportingDetails}
					reportingError={reportingError}
					reportingForm={reportingForm}
					reportingResult={reportingResult}
				/>
			) : route === 'trading' ? (
				<TradingSection
					accountState={accountState}
					onCreateCompleteSet={() => void createCompleteSet()}
					onRedeemCompleteSet={() => void redeemCompleteSet()}
					onTradingFormChange={update => setTradingForm(current => ({ ...current, ...update }))}
					tradingError={tradingError}
					tradingForm={tradingForm}
					tradingResult={tradingResult}
				/>
			) : (
				<>
					{deploymentSections.map(section => (
						<DeploymentSection
							key={section.title}
							title={section.title}
							steps={section.steps}
							allSteps={deploymentStatuses}
							accountAddress={accountState.address}
							isMainnet={accountState.isMainnet}
							busyStepId={busyStepId}
							onDeploy={deployStep}
						/>
					))}
				</>
			)}
		</main>
	)
}
