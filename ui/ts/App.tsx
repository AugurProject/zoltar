import { useSignal } from '@preact/signals'
import type { Hash } from 'viem'
import { AppRouteContent } from './components/AppRouteContent.js'
import { HeroSection } from './components/HeroSection.js'
import { OverviewPanels } from './components/OverviewPanels.js'
import { TabNavigation } from './components/TabNavigation.js'
import { useDeploymentFlow } from './hooks/useDeploymentFlow.js'
import { useForkAuctionOperations } from './hooks/useForkAuctionOperations.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useMarketCreation } from './hooks/useMarketCreation.js'
import { useOnchainState } from './hooks/useOnchainState.js'
import { useOpenOracleOperations } from './hooks/useOpenOracleOperations.js'
import { useReportingOperations } from './hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from './hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from './hooks/useSecurityPoolsOverview.js'
import { useSecurityVaultOperations } from './hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from './hooks/useTradingOperations.js'
import { assertNever } from './lib/assert.js'
import { getDeploymentSections } from './lib/deployment.js'
import { DEPLOY_ROUTE, FORK_AUCTION_ROUTE, MARKET_ROUTE, OPEN_ORACLE_ROUTE, REPORTING_ROUTE, SECURITY_POOLS_OVERVIEW_ROUTE, SECURITY_POOL_ROUTE, SECURITY_VAULT_ROUTE, TRADING_ROUTE } from './lib/routing.js'
import { formatUniverseCollectionLabel } from './lib/universe.js'
import type { Route } from './types/app.js'

function getUniverseLabel(route: Route, securityPoolsUniverseIds: bigint[], reportingUniverseId: bigint | undefined, securityVaultUniverseId: bigint | undefined, tradingUniverseId: bigint | undefined, forkAuctionUniverseId: bigint | undefined) {
	switch (route) {
		case 'deploy':
		case 'markets':
		case 'security-pools':
		case 'open-oracle':
			return formatUniverseCollectionLabel([0n])
		case 'security-pools-overview':
			return formatUniverseCollectionLabel(securityPoolsUniverseIds)
		case 'security-vaults':
			return formatUniverseCollectionLabel(securityVaultUniverseId === undefined ? [] : [securityVaultUniverseId])
		case 'reporting':
			return formatUniverseCollectionLabel(reportingUniverseId === undefined ? [] : [reportingUniverseId])
		case 'trading':
			return formatUniverseCollectionLabel(tradingUniverseId === undefined ? [] : [tradingUniverseId])
		case 'fork-auctions':
			return formatUniverseCollectionLabel(forkAuctionUniverseId === undefined ? [] : [forkAuctionUniverseId])
		default:
			return assertNever(route)
	}
}

export function App() {
	const lastTransactionHash = useSignal<Hash | undefined>(undefined)
	const { navigate, route } = useHashRoute()
	const { accountState, connectWallet, deploymentStatuses, errorMessage: walletErrorMessage, hasInjectedWallet, isRefreshing, refreshState } = useOnchainState()
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { createMarket, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm } = useMarketCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { createPool, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } = useSecurityPoolCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { approveRep, depositRep, loadSecurityVault, loadingSecurityVault, redeemFees, redeemRep, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult, setSecurityVaultForm, updateVaultFees } = useSecurityVaultOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { approveToken1, approveToken2, loadOracleManager, loadingOracleManager, onQueueOperation, onRequestPrice, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails, setOpenOracleForm, settleReport, submitInitialReport } = useOpenOracleOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { liquidationAmount, liquidationTargetVault, loadingSecurityPools, queueLiquidation, securityPoolOverviewError, securityPoolOverviewResult, securityPools, setLiquidationAmount, setLiquidationTargetVault, loadSecurityPools } = useSecurityPoolsOverview({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { createCompleteSet, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingError, tradingForm, tradingResult } = useTradingOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})
	const { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, forkAuctionDetails, forkAuctionError, forkAuctionForm, forkAuctionResult, forkUniverse, forkWithOwnEscalation, initiateFork, loadForkAuction, loadingForkAuctionDetails, migrateEscalation, migrateRepToZoltar, migrateVault, refundLosingBids, setForkAuctionForm, startTruthAuction, submitBid, withdrawBids } = useForkAuctionOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		refreshState,
	})

	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const lastCreatedQuestionId = marketResult?.questionId
	const wrongNetworkMessage = accountState.address !== undefined && !accountState.isMainnet ? 'This application requires Ethereum mainnet. Switch your wallet to Ethereum mainnet before using deployment, market, oracle, reporting, vault, pool, or trading actions.' : undefined
	const universeLabel = getUniverseLabel(route, securityPools.map(pool => pool.universeId), reportingDetails?.universeId, securityVaultDetails?.universeId, tradingResult?.universeId, forkAuctionDetails?.universeId)

	return (
		<main>
			<HeroSection accountAddress={accountState.address} isRefreshing={isRefreshing} onRefresh={() => void refreshState()} onConnect={() => void connectWallet()} />

			{hasInjectedWallet ? undefined : <p class='notice warning'>No injected wallet detected. Open this page in a browser with MetaMask or another EIP-1193 wallet.</p>}
			{errorMessage === undefined ? undefined : <p class='notice error'>{errorMessage}</p>}
			{lastTransactionHash.value === undefined ? undefined : (
				<p class='notice success'>
					Last transaction: <span>{lastTransactionHash.value}</span>
				</p>
			)}

			<OverviewPanels accountState={accountState} deploymentStatuses={deploymentStatuses} busyStepId={busyStepId} onDeployNextMissing={() => void deployNextMissing()} universeLabel={universeLabel} />

			<TabNavigation route={route} deployRoute={DEPLOY_ROUTE} forkAuctionRoute={FORK_AUCTION_ROUTE} marketRoute={MARKET_ROUTE} openOracleRoute={OPEN_ORACLE_ROUTE} reportingRoute={REPORTING_ROUTE} securityPoolRoute={SECURITY_POOL_ROUTE} securityPoolsOverviewRoute={SECURITY_POOLS_OVERVIEW_ROUTE} securityVaultRoute={SECURITY_VAULT_ROUTE} tradingRoute={TRADING_ROUTE} onRouteChange={navigate} />

			<AppRouteContent
				accountState={accountState}
				createMarket={() => void createMarket()}
				createPool={() => void createPool()}
				deployNextMissing={() => void deployNextMissing()}
				deployStep={deployStep}
				deploymentSections={deploymentSections}
				deploymentStatuses={deploymentStatuses}
				lastCreatedQuestionId={lastCreatedQuestionId}
				liquidationAmount={liquidationAmount}
				liquidationTargetVault={liquidationTargetVault}
				loadForkAuction={() => void loadForkAuction()}
				loadMarket={() => void loadMarket()}
				loadMarketById={loadMarketById}
				loadOracleManager={() => void loadOracleManager()}
				loadReporting={() => void loadReporting()}
				loadSecurityPools={() => void loadSecurityPools()}
				loadSecurityVault={() => void loadSecurityVault()}
				loadingMarketDetails={loadingMarketDetails}
				loadingForkAuctionDetails={loadingForkAuctionDetails}
				loadingOracleManager={loadingOracleManager}
				loadingReportingDetails={loadingReportingDetails}
				loadingSecurityPools={loadingSecurityPools}
				loadingSecurityVault={loadingSecurityVault}
				marketCreating={marketCreating}
				marketDetails={marketDetails}
				marketError={marketError}
				marketForm={marketForm}
				marketResult={marketResult}
				onApproveRep={() => void approveRep()}
				onApproveToken1={() => void approveToken1()}
				onApproveToken2={() => void approveToken2()}
				onCreateCompleteSet={() => void createCompleteSet()}
				onForkUniverse={() => void forkUniverse()}
				onClaimAuctionProceeds={() => void claimAuctionProceeds()}
				onCreateChildUniverse={() => void createChildUniverse()}
				onDeployNextMissing={() => void deployNextMissing()}
				onDepositRep={() => void depositRep()}
				onFinalizeTruthAuction={() => void finalizeTruthAuction()}
				onForkAuctionFormChange={update => setForkAuctionForm(current => ({ ...current, ...update }))}
				onForkWithOwnEscalation={() => void forkWithOwnEscalation()}
				onInitiateFork={() => void initiateFork()}
				onLiquidationAmountChange={setLiquidationAmount}
				onLiquidationTargetVaultChange={setLiquidationTargetVault}
				onQueueLiquidation={(managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress)}
				onRedeemCompleteSet={() => void redeemCompleteSet()}
				onRedeemShares={() => void redeemShares()}
				onRedeemFees={() => void redeemFees()}
				onRedeemRep={() => void redeemRep()}
				onQueueOperation={() => void onQueueOperation()}
				onReportOutcome={() => void onReportOutcome()}
				onRequestPrice={() => void onRequestPrice()}
				onResetMarket={resetMarket}
				onRouteChange={navigate}
				onSecurityPoolFormChange={update => setSecurityPoolForm(current => ({ ...current, ...update }))}
				onSecurityVaultFormChange={update => setSecurityVaultForm(current => ({ ...current, ...update }))}
				onMarketFormChange={update => setMarketForm(current => ({ ...current, ...update }))}
				onOpenOracleFormChange={update => setOpenOracleForm(current => ({ ...current, ...update }))}
				onReportingFormChange={update => setReportingForm(current => ({ ...current, ...update }))}
				onTradingFormChange={update => setTradingForm(current => ({ ...current, ...update }))}
				onStartTruthAuction={() => void startTruthAuction()}
				onSubmitBid={() => void submitBid()}
				onSettleReport={() => void settleReport()}
				onSubmitInitialReport={() => void submitInitialReport()}
				onUpdateVaultFees={() => void updateVaultFees()}
				onWithdrawEscalation={() => void withdrawEscalation()}
				onWithdrawBids={() => void withdrawBids()}
				onMigrateEscalationDeposits={() => void migrateEscalation()}
				onMigrateShares={() => void migrateShares()}
				onMigrateRepToZoltar={() => void migrateRepToZoltar()}
				onMigrateVault={() => void migrateVault()}
				onRefundLosingBids={() => void refundLosingBids()}
				forkAuctionDetails={forkAuctionDetails}
				forkAuctionError={forkAuctionError}
				forkAuctionForm={forkAuctionForm}
				forkAuctionResult={forkAuctionResult}
				openOracleError={openOracleError}
				openOracleForm={openOracleForm}
				openOracleResult={openOracleResult}
				oracleManagerDetails={oracleManagerDetails}
				reportingDetails={reportingDetails}
				reportingError={reportingError}
				reportingForm={reportingForm}
				reportingResult={reportingResult}
				route={route}
				securityPoolCreating={securityPoolCreating}
				securityPoolError={securityPoolError}
				securityPoolForm={securityPoolForm}
				securityPoolOverviewError={securityPoolOverviewError}
				securityPoolOverviewResult={securityPoolOverviewResult}
				securityPoolResult={securityPoolResult}
				securityPools={securityPools}
				securityVaultDetails={securityVaultDetails}
				securityVaultError={securityVaultError}
				securityVaultForm={securityVaultForm}
				securityVaultResult={securityVaultResult}
				tradingError={tradingError}
				tradingForm={tradingForm}
				tradingResult={tradingResult}
				busyStepId={busyStepId}
				wrongNetworkMessage={wrongNetworkMessage}
			/>
		</main>
	)
}
