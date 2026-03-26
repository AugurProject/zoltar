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
import { isMainnetChain } from './lib/network.js'
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
	const transactionInFlightCount = useSignal(0)
	const transactionSubmitted = useSignal(false)
	const transactionUrl = useSignal<string | undefined>(undefined)
	const markTransactionRequested = () => {
		transactionInFlightCount.value += 1
		transactionSubmitted.value = false
	}
	const markTransactionSubmitted = (hash: Hash) => {
		lastTransactionHash.value = hash
		transactionInFlightCount.value += 1
		transactionSubmitted.value = true
		transactionUrl.value = `https://etherscan.io/tx/${ hash }`
	}
	const markTransactionFinished = () => {
		transactionInFlightCount.value = Math.max(0, transactionInFlightCount.value - 1)
	}
	const { navigate, route } = useHashRoute()
	const { accountState, connectWallet, deploymentStatuses, errorMessage: walletErrorMessage, hasInjectedWallet, isRefreshing, refreshState } = useOnchainState()
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { createMarket, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm } = useMarketCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { createPool, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } = useSecurityPoolCreation({
		accountAddress: accountState.address,
		deploymentStatuses,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { approveRep, depositRep, loadSecurityVault, loadingSecurityVault, redeemFees, redeemRep, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult, setSecurityVaultForm, updateVaultFees } = useSecurityVaultOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { approveToken1, approveToken2, loadOracleManager, loadingOracleManager, onQueueOperation, onRequestPrice, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails, setOpenOracleForm, settleReport, submitInitialReport } = useOpenOracleOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { liquidationAmount, liquidationTargetVault, loadingSecurityPools, queueLiquidation, securityPoolOverviewError, securityPoolOverviewResult, securityPools, setLiquidationAmount, setLiquidationTargetVault, loadSecurityPools } = useSecurityPoolsOverview({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { createCompleteSet, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingError, tradingForm, tradingResult } = useTradingOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})
	const { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, forkAuctionDetails, forkAuctionError, forkAuctionForm, forkAuctionResult, forkUniverse, forkWithOwnEscalation, initiateFork, loadForkAuction, loadingForkAuctionDetails, migrateEscalation, migrateRepToZoltar, migrateVault, refundLosingBids, setForkAuctionForm, startTruthAuction, submitBid, withdrawBids } = useForkAuctionOperations({
		accountAddress: accountState.address,
		onTransaction: hash => {
			lastTransactionHash.value = hash
		},
		onTransactionFinished: markTransactionFinished,
		onTransactionRequested: markTransactionRequested,
		onTransactionSubmitted: markTransactionSubmitted,
		refreshState,
	})

	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const lastCreatedQuestionId = marketResult?.questionId
	const isMainnet = isMainnetChain(accountState.chainId)
	const wrongNetworkMessage = accountState.address !== undefined && !isMainnet ? 'This application requires Ethereum mainnet. Switch your wallet to Ethereum mainnet before using deployment, market, oracle, reporting, vault, pool, or trading actions.' : undefined
	const universeLabel = getUniverseLabel(route, securityPools.map(pool => pool.universeId), reportingDetails?.universeId, securityVaultDetails?.universeId, tradingResult?.universeId, forkAuctionDetails?.universeId)

	return (
		<main>
			<HeroSection accountAddress={accountState.address} isRefreshing={isRefreshing} onRefresh={() => void refreshState()} onConnect={() => void connectWallet()} />

			{hasInjectedWallet ? undefined : <p className='notice warning'>No injected wallet detected. Open this page in a browser with MetaMask or another EIP-1193 wallet.</p>}
			{errorMessage === undefined ? undefined : <p className='notice error'>{errorMessage}</p>}
			{transactionInFlightCount.value > 0 ? (
				<p className='notice success'>
					<span className='spinner' aria-hidden='true' />
					{transactionSubmitted.value ? 'Transaction submitted, waiting for confirmation.' : 'Awaiting wallet confirmation.'} <span>{lastTransactionHash.value ?? 'Pending wallet signature'}</span>
					{transactionUrl.value === undefined ? undefined : <> <a href={transactionUrl.value} target='_blank' rel='noreferrer'>View on Etherscan</a></>}
				</p>
			) : lastTransactionHash.value === undefined ? undefined : (
				<p className='notice success'>
					Last transaction: <span>{lastTransactionHash.value}</span>
					{transactionUrl.value === undefined ? undefined : <> <a href={transactionUrl.value} target='_blank' rel='noreferrer'>View on Etherscan</a></>}
				</p>
			)}

			<OverviewPanels accountState={accountState} deploymentStatuses={deploymentStatuses} busyStepId={busyStepId} onDeployNextMissing={() => void deployNextMissing()} universeLabel={universeLabel} />

			<TabNavigation route={route} deployRoute={DEPLOY_ROUTE} forkAuctionRoute={FORK_AUCTION_ROUTE} marketRoute={MARKET_ROUTE} openOracleRoute={OPEN_ORACLE_ROUTE} reportingRoute={REPORTING_ROUTE} securityPoolRoute={SECURITY_POOL_ROUTE} securityPoolsOverviewRoute={SECURITY_POOLS_OVERVIEW_ROUTE} securityVaultRoute={SECURITY_VAULT_ROUTE} tradingRoute={TRADING_ROUTE} onRouteChange={navigate} />

			<fieldset className='route-shell' disabled={transactionInFlightCount.value > 0}>
					<AppRouteContent
						deployment={{
							accountAddress: accountState.address,
							busyStepId,
							deploymentSections,
							deploymentStatuses,
							isMainnet,
							onDeploy: deployStep,
							onDeployNextMissing: () => void deployNextMissing(),
						}}
						forkAuction={{
							accountState,
							forkAuctionDetails,
							forkAuctionError,
							forkAuctionForm,
							forkAuctionResult,
							loadingForkAuctionDetails,
							onClaimAuctionProceeds: () => void claimAuctionProceeds(),
							onCreateChildUniverse: () => void createChildUniverse(),
							onFinalizeTruthAuction: () => void finalizeTruthAuction(),
							onForkAuctionFormChange: update => setForkAuctionForm(current => ({ ...current, ...update })),
							onForkUniverse: () => void forkUniverse(),
							onForkWithOwnEscalation: () => void forkWithOwnEscalation(),
							onInitiateFork: () => void initiateFork(),
							onLoadForkAuction: () => void loadForkAuction(),
							onMigrateEscalationDeposits: () => void migrateEscalation(),
							onMigrateRepToZoltar: () => void migrateRepToZoltar(),
							onMigrateVault: () => void migrateVault(),
							onRefundLosingBids: () => void refundLosingBids(),
							onStartTruthAuction: () => void startTruthAuction(),
							onSubmitBid: () => void submitBid(),
							onWithdrawBids: () => void withdrawBids(),
						}}
						market={{
							accountState,
							createMarket: () => void createMarket(),
							deploymentStatuses,
							marketCreating,
							marketError,
							marketForm,
							marketResult,
							onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
							onResetMarket: resetMarket,
						}}
						openOracle={{
							accountState,
							loadingOracleManager,
							onApproveToken1: () => void approveToken1(),
							onApproveToken2: () => void approveToken2(),
							onLoadOracleManager: () => void loadOracleManager(),
							onOpenOracleFormChange: update => setOpenOracleForm(current => ({ ...current, ...update })),
							onQueueOperation: () => void onQueueOperation(),
							onRequestPrice: () => void onRequestPrice(),
							onSettleReport: () => void settleReport(),
							onSubmitInitialReport: () => void submitInitialReport(),
							openOracleError,
							openOracleForm,
							openOracleResult,
							oracleManagerDetails,
						}}
						reporting={{
							accountState,
							loadingReportingDetails,
							onLoadReporting: () => void loadReporting(),
							onReportOutcome: () => void onReportOutcome(),
							onReportingFormChange: update => setReportingForm(current => ({ ...current, ...update })),
							onWithdrawEscalation: () => void withdrawEscalation(),
							reportingDetails,
							reportingError,
							reportingForm,
							reportingResult,
						}}
						route={route}
						securityPool={{
							accountState,
							createPool: () => void createPool(),
							deploymentStatuses,
							lastCreatedQuestionId,
							loadMarket: () => void loadMarket(),
							loadMarketById,
							loadingMarketDetails,
							marketDetails,
							onSecurityPoolFormChange: update => setSecurityPoolForm(current => ({ ...current, ...update })),
							securityPoolCreating,
							securityPoolError,
							securityPoolForm,
							securityPoolResult,
						}}
						securityPoolsOverview={{
							accountState,
							liquidationAmount,
							liquidationTargetVault,
							loadingSecurityPools,
							onLiquidationAmountChange: setLiquidationAmount,
							onLiquidationTargetVaultChange: setLiquidationTargetVault,
							onLoadSecurityPools: () => void loadSecurityPools(),
							onQueueLiquidation: (managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress),
							securityPoolOverviewError,
							securityPoolOverviewResult,
							securityPools,
						}}
						securityVault={{
							accountState,
							loadingSecurityVault,
							onApproveRep: () => void approveRep(),
							onDepositRep: () => void depositRep(),
							onLoadSecurityVault: () => void loadSecurityVault(),
							onRedeemFees: () => void redeemFees(),
							onRedeemRep: () => void redeemRep(),
							onSecurityVaultFormChange: update => setSecurityVaultForm(current => ({ ...current, ...update })),
							onUpdateVaultFees: () => void updateVaultFees(),
							securityVaultDetails,
							securityVaultError,
							securityVaultForm,
							securityVaultResult,
						}}
						trading={{
							accountState,
							onCreateCompleteSet: () => void createCompleteSet(),
							onMigrateShares: () => void migrateShares(),
							onRedeemCompleteSet: () => void redeemCompleteSet(),
							onRedeemShares: () => void redeemShares(),
							onTradingFormChange: update => setTradingForm(current => ({ ...current, ...update })),
							tradingError,
							tradingForm,
							tradingResult,
						}}
						wrongNetworkMessage={wrongNetworkMessage}
					/>
				</fieldset>
		</main>
	)
}
