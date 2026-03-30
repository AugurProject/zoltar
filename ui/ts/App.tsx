import { useSignal } from '@preact/signals'
import type { Hash } from 'viem'
import { useEffect } from 'preact/hooks'
import { AppRouteContent } from './components/AppRouteContent.js'
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
import { getDeploymentSections } from './lib/deployment.js'
import { isMainnetChain } from './lib/network.js'
import { createInitialTransactionState, markTransactionFinished, markTransactionRequested, markTransactionSubmitted } from './lib/transactionState.js'
import type { TransactionState } from './lib/transactionState.js'
import { DEPLOY_ROUTE, OPEN_ORACLE_ROUTE, SECURITY_POOLS_ROUTE, ZOLTAR_ROUTE } from './lib/routing.js'
import { formatUniverseCollectionLabel } from './lib/universe.js'
import { readSecurityPoolQueryParam, readUniverseQueryParam, writeSecurityPoolQueryParam, writeUniverseQueryParam } from './lib/urlParams.js'

export function App() {
	const transactionState = useSignal<TransactionState>(createInitialTransactionState())
	const locationRevision = useSignal(0)
	const deployNextMissingPending = useSignal(false)
	const onTransaction = (hash: Hash) => {
		transactionState.value = {
			...transactionState.value,
			lastTransactionHash: hash,
		}
	}
	const onTransactionRequested = () => {
		transactionState.value = markTransactionRequested(transactionState.value)
	}
	const onTransactionSubmitted = (hash: Hash) => {
		transactionState.value = markTransactionSubmitted(transactionState.value, hash)
	}
	const onTransactionFinished = () => {
		transactionState.value = markTransactionFinished(transactionState.value)
	}
	const { navigate, route } = useHashRoute()
	const { accountState, connectWallet, deploymentStatuses, errorMessage: walletErrorMessage, hasInjectedWallet, hasLoadedDeploymentStatuses, isLoadingDeploymentStatuses, isRefreshing, refreshState, setDeploymentStatuses, walletBootstrapComplete } = useOnchainState()
	const baseHookConfig = {
		accountAddress: accountState.address,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
	}
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
	const { approveZoltarForkRep, createChildUniverse: createZoltarChildUniverse, createMarket, forkZoltar, loadingZoltarForkAccess, loadingZoltarQuestionCount, loadingZoltarQuestions, loadingZoltarUniverse, loadZoltarQuestions, loadZoltarUniverse, marketCreating, marketError, marketForm, marketResult, setMarketForm, setZoltarForkQuestionId, zoltarChildUniverseError, zoltarForkAllowance, zoltarForkError, zoltarForkPending, zoltarForkQuestionId, zoltarForkRepBalance, zoltarQuestionCount, zoltarQuestions, zoltarUniverse } = useMarketCreation({ ...baseHookConfig, activeUniverseId: readUniverseQueryParam(window.location.search) ?? 0n, accountRepBalance: accountState.repBalance, autoLoadInitialData: walletBootstrapComplete, deploymentStatuses })
	const { checkingDuplicateOriginPool, createPool, duplicateOriginPoolExists, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } = useSecurityPoolCreation({ ...baseHookConfig, deploymentStatuses })
	const { approveRep, depositRep, loadSecurityVault, loadingSecurityVault, redeemFees, redeemRep, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultResult, setSecurityVaultForm, updateVaultFees } = useSecurityVaultOperations(baseHookConfig)
	const { approveToken1, approveToken2, loadOracleManager, loadingOracleManager, onQueueOperation, onRequestPrice, openOracleError, openOracleForm, openOracleResult, oracleManagerDetails, setOpenOracleForm, settleReport, submitInitialReport } = useOpenOracleOperations(baseHookConfig)
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations(baseHookConfig)
	const {
		closeLiquidationModal,
		liquidationAmount,
		liquidationManagerAddress,
		liquidationModalOpen,
		liquidationSecurityPoolAddress,
		liquidationTargetVault,
		loadingSecurityPools,
		loadSecurityPools,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPools,
		setLiquidationAmount,
		setLiquidationTargetVault,
	} = useSecurityPoolsOverview(baseHookConfig)
	const { createCompleteSet, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingError, tradingForm, tradingResult } = useTradingOperations(baseHookConfig)
	const { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, forkAuctionDetails, forkAuctionError, forkAuctionForm, forkAuctionResult, forkUniverse, forkWithOwnEscalation, initiateFork, loadForkAuction, loadingForkAuctionDetails, migrateEscalation, migrateRepToZoltar, migrateVault, refundLosingBids, setForkAuctionForm, startTruthAuction, submitBid, withdrawBids } = useForkAuctionOperations(baseHookConfig)
	const securityPoolAddress = useSignal(readSecurityPoolQueryParam(window.location.search) ?? '')

	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const lastCreatedQuestionId = marketResult?.questionId
	const isMainnet = isMainnetChain(accountState.chainId)
	const wrongNetworkMessage = accountState.address !== undefined && !isMainnet ? 'Switch your wallet to Ethereum mainnet.' : undefined
	const showDeployTab = hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed)
	const activeUniverseId = readUniverseQueryParam(window.location.search) ?? 0n
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const activeSecurityPoolAddress = securityPoolAddress.value
	void locationRevision.value

	useEffect(() => {
		if (!walletBootstrapComplete) return
		void refreshState({ loadDeploymentStatuses: true, loadWalletState: false })
	}, [walletBootstrapComplete])

	useEffect(() => {
		const nextSearch = writeUniverseQueryParam(window.location.search, activeUniverseId)
		window.history.replaceState({}, '', `${ window.location.pathname }${ nextSearch }${ window.location.hash }`)
	}, [activeUniverseId])

	useEffect(() => {
		const nextSearch = writeSecurityPoolQueryParam(window.location.search, activeSecurityPoolAddress === '' ? undefined : activeSecurityPoolAddress)
		window.history.replaceState({}, '', `${ window.location.pathname }${ nextSearch }${ window.location.hash }`)
	}, [activeSecurityPoolAddress])

	useEffect(() => {
		const onPopState = () => {
			locationRevision.value += 1
		}

		window.addEventListener('popstate', onPopState)
		return () => {
			window.removeEventListener('popstate', onPopState)
		}
	}, [])

	useEffect(() => {
		setSecurityVaultForm(current => current.securityPoolAddress === activeSecurityPoolAddress ? current : { ...current, securityPoolAddress: activeSecurityPoolAddress })
		setTradingForm(current => current.securityPoolAddress === activeSecurityPoolAddress ? current : { ...current, securityPoolAddress: activeSecurityPoolAddress })
		setForkAuctionForm(current => current.securityPoolAddress === activeSecurityPoolAddress ? current : { ...current, securityPoolAddress: activeSecurityPoolAddress })
		setReportingForm(current => current.securityPoolAddress === activeSecurityPoolAddress ? current : { ...current, securityPoolAddress: activeSecurityPoolAddress })
		if (!walletBootstrapComplete) return
		if (!activeSecurityPoolAddress.startsWith('0x') || activeSecurityPoolAddress.length !== 42) return
		void loadSecurityPools()
		void loadReporting()
		void loadForkAuction()
	}, [activeSecurityPoolAddress, walletBootstrapComplete])

	useEffect(() => {
		if (securityPoolResult === undefined) return
		void loadSecurityPools()
	}, [securityPoolResult?.deployPoolHash])

	const onDeployNextMissing = async () => {
		if (deployNextMissingPending.value) return
		deployNextMissingPending.value = true
		try {
			await deployNextMissing()
		} finally {
			deployNextMissingPending.value = false
		}
	}

	const onUseQuestionForPool = (questionId: string) => {
		setSecurityPoolForm(current => ({
			...current,
			marketId: questionId,
		}))
		navigate('security-pools')
	}

	return (
		<main>
			<div className='top-shell'>
				<OverviewPanels accountState={accountState} universeLabel={universeLabel} isRefreshing={isRefreshing} onRefresh={() => void refreshState()} onConnect={() => void connectWallet()} />
				<TabNavigation route={route} showDeployTab={showDeployTab} deployRoute={DEPLOY_ROUTE} marketRoute={ZOLTAR_ROUTE} openOracleRoute={OPEN_ORACLE_ROUTE} securityPoolsRoute={SECURITY_POOLS_ROUTE} onRouteChange={navigate} />
			</div>

			{hasInjectedWallet ? undefined : <p className='notice warning'>No injected wallet detected.</p>}
			{errorMessage === undefined ? undefined : <p className='notice error'>{errorMessage}</p>}
			{transactionState.value.transactionInFlightCount > 0 ? (
				<p className='notice success'>
					<span className='spinner' aria-hidden='true' />
					{transactionState.value.transactionSubmitted ? 'Transaction submitted, waiting for confirmation.' : 'Awaiting wallet confirmation.'} <span>{transactionState.value.lastTransactionHash ?? 'Pending wallet signature'}</span>
					{transactionState.value.transactionUrl === undefined ? undefined : <> <a href={transactionState.value.transactionUrl} target='_blank' rel='noreferrer'>View on Etherscan</a></>}
				</p>
			) : transactionState.value.lastTransactionHash === undefined ? undefined : (
				<p className='notice success'>
					Last transaction: <span>{transactionState.value.lastTransactionHash}</span>
					{transactionState.value.transactionUrl === undefined ? undefined : <> <a href={transactionState.value.transactionUrl} target='_blank' rel='noreferrer'>View on Etherscan</a></>}
				</p>
			)}

			{walletBootstrapComplete ? (
				<fieldset className='route-shell' disabled={transactionState.value.transactionInFlightCount > 0}>
					<AppRouteContent
				deployment={{
					accountAddress: accountState.address,
					busyStepId,
					deployNextMissingPending: deployNextMissingPending.value,
					deploymentSections,
					deploymentStatuses,
					isLoadingDeploymentStatuses,
					isMainnet,
					onDeploy: deployStep,
					onDeployNextMissing: () => void onDeployNextMissing(),
				}}
						market={{
							accountState,
							onApproveZoltarForkRep: () => void approveZoltarForkRep(),
							loadingZoltarQuestionCount,
							loadingZoltarQuestions,
							loadingZoltarUniverse,
							onCreateChildUniverse: outcomeIndex => void createZoltarChildUniverse(outcomeIndex),
							onForkZoltar: () => void forkZoltar(),
							onCreateMarket: () => void createMarket(),
							onLoadZoltarQuestions: () => void loadZoltarQuestions(),
							onLoadZoltarUniverse: () => void loadZoltarUniverse(),
							marketCreating,
							marketError,
							marketForm,
							marketResult,
							onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
							onUseQuestionForFork: questionId => setZoltarForkQuestionId(questionId),
							onUseQuestionForPool,
							zoltarQuestionCount,
							zoltarForkAllowance,
							zoltarForkError,
							zoltarChildUniverseError,
							loadingZoltarForkAccess,
							zoltarForkPending,
							zoltarForkQuestionId,
							zoltarForkRepBalance,
							zoltarQuestions,
							zoltarUniverse,
							onZoltarForkQuestionIdChange: questionId => setZoltarForkQuestionId(questionId),
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
						route={route}
						securityPool={{
							accountState,
							checkingDuplicateOriginPool,
							duplicateOriginPoolExists,
							onCreateSecurityPool: () => void createPool(),
							lastCreatedQuestionId,
							onLoadMarket: () => void loadMarket(),
							onLoadMarketById: loadMarketById,
							loadingMarketDetails,
							marketDetails,
							onSecurityPoolFormChange: update => setSecurityPoolForm(current => ({ ...current, ...update })),
							securityPools,
							securityPoolCreating,
							securityPoolError,
							securityPoolForm,
							securityPoolResult,
						}}
						securityPoolWorkflow={{
							accountState,
							closeLiquidationModal: () => closeLiquidationModal(),
							forkAuction: {
								accountState,
								forkAuctionDetails,
								forkAuctionError,
								forkAuctionForm,
								forkAuctionResult,
								loadingForkAuctionDetails,
								onClaimAuctionProceeds: () => void claimAuctionProceeds(),
								onCreateChildUniverse: () => void createChildUniverse(forkAuctionForm.selectedOutcome),
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
							},
							liquidationAmount,
							liquidationManagerAddress,
							liquidationModalOpen,
							liquidationSecurityPoolAddress,
							liquidationTargetVault,
							onLiquidationAmountChange: setLiquidationAmount,
							onLiquidationTargetVaultChange: setLiquidationTargetVault,
							onOpenLiquidationModal: (managerAddress, securityPoolAddress, vaultAddress) => openLiquidationModal(managerAddress, securityPoolAddress, vaultAddress),
							onQueueLiquidation: (managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress),
							onSecurityPoolAddressChange: value => {
								securityPoolAddress.value = value
							},
							reporting: {
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
							},
							securityPoolAddress: activeSecurityPoolAddress,
							securityPools,
							securityVault: {
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
							},
							trading: {
								accountState,
								onCreateCompleteSet: () => void createCompleteSet(),
								onMigrateShares: () => void migrateShares(),
								onRedeemCompleteSet: () => void redeemCompleteSet(),
								onRedeemShares: () => void redeemShares(),
								onTradingFormChange: update => setTradingForm(current => ({ ...current, ...update })),
								tradingError,
								tradingForm,
								tradingResult,
							},
						}}
						securityPoolsOverview={{
							accountState,
							closeLiquidationModal: () => closeLiquidationModal(),
							liquidationAmount,
							liquidationManagerAddress,
							liquidationModalOpen,
							liquidationSecurityPoolAddress,
							liquidationTargetVault,
							loadingSecurityPools,
							onLiquidationAmountChange: setLiquidationAmount,
							onLiquidationTargetVaultChange: setLiquidationTargetVault,
							onOpenLiquidationModal: (managerAddress, securityPoolAddress, vaultAddress) => openLiquidationModal(managerAddress, securityPoolAddress, vaultAddress),
							onLoadSecurityPools: () => void loadSecurityPools(),
							onQueueLiquidation: (managerAddress, securityPoolAddress) => void queueLiquidation(managerAddress, securityPoolAddress),
							securityPoolOverviewError,
							securityPoolOverviewResult,
							securityPools,
						}}
						wrongNetworkMessage={wrongNetworkMessage}
					/>
				</fieldset>
			) : (
				<p className='notice'>
					<span className='spinner' aria-hidden='true' />
					Loading wallet...
				</p>
			)}
		</main>
	)
}
