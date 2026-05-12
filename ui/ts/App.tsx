import { useSignal } from '@preact/signals'
import type { Address, Hash } from 'viem'
import { AppHeaderShell } from './components/AppHeaderShell.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { AppStatusNotices } from './components/AppStatusNotices.js'
import { RouteSubNavigation } from './components/RouteSubNavigation.js'
import { useAppRouteEffects } from './hooks/useAppRouteEffects.js'
import { useDeploymentFlow } from './hooks/useDeploymentFlow.js'
import { useForkAuctionOperations } from './hooks/useForkAuctionOperations.js'
import { useHashRoute } from './hooks/useHashRoute.js'
import { useMarketCreation } from './hooks/useMarketCreation.js'
import { useOnchainState } from './hooks/useOnchainState.js'
import { useOpenOracleOperations } from './hooks/useOpenOracleOperations.js'
import { usePriceOracleManager } from './hooks/usePriceOracleManager.js'
import { useReportingOperations } from './hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from './hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from './hooks/useSecurityPoolsOverview.js'
import { useRepPrices } from './hooks/useRepPrices.js'
import { useSecurityVaultOperations } from './hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from './hooks/useTradingOperations.js'
import { useUrlState } from './hooks/useUrlState.js'
import { getActiveSimulationController } from './lib/activeEnvironment.js'
import { getDeploymentSections } from './lib/deployment.js'
import { resolveLoadableValueState } from './lib/loadState.js'
import { getWrongNetworkMessage, isSupportedAppChain } from './lib/network.js'
import { createLoadSecurityVaultHandler } from './lib/securityVaultHandlers.js'
import { getUseQuestionForPoolState } from './lib/securityPoolNavigation.js'
import { createInitialTransactionState, markTransactionFinished, markTransactionRequested, markTransactionSubmitted } from './lib/transactionState.js'
import type { TransactionState } from './lib/transactionState.js'
import { DEPLOY_ROUTE, OPEN_ORACLE_ROUTE, SECURITY_POOLS_ROUTE, ZOLTAR_ROUTE } from './lib/routing.js'
import { writeOpenOracleViewQueryParam, writeSecurityPoolsViewQueryParam, writeZoltarViewQueryParam } from './lib/urlParams.js'
import { getUniversePresentation, getWalletPresentation } from './lib/userCopy.js'
import { formatUniverseCollectionLabel } from './lib/universe.js'
import { resolveEnumValue, resolveFirstMatchingValue } from './lib/viewState.js'
import type { DeploymentRouteContentProps, MarketRouteContentProps, OpenOracleSectionProps, OpenOracleView, SecurityPoolsSectionProps, SecurityPoolsView, ZoltarView } from './types/components.js'

function getRouteHref(routeHash: string, nextSearch: string) {
	return `${window.location.pathname}${nextSearch}${routeHash}`
}

export function App() {
	const transactionState = useSignal<TransactionState>(createInitialTransactionState())
	const deployNextMissingPending = useSignal(false)
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, openOracleView, securityPoolsView, securityPoolAddress, selectedPoolView, setActiveUniverseId, setOpenOracleReport, setOpenOracleView, setSecurityPoolsView, setSecurityPoolAddress, setSelectedPoolView, setZoltarView, zoltarView } = useUrlState()
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', ['questions', 'create', 'fork', 'migrate'])
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
	const {
		accountState,
		augurPlaceHolderDeployed,
		connectWallet,
		deploymentStatuses,
		environmentBootstrapError,
		environmentReady,
		errorMessage: walletErrorMessage,
		hasInjectedWallet,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isLoadingDeploymentStatuses,
		isRefreshing,
		refreshState,
		setDeploymentStatuses,
		walletBootstrapComplete,
	} = useOnchainState()
	const baseHookConfig = {
		accountAddress: accountState.address,
		onTransaction,
		onTransactionFinished,
		onTransactionRequested,
		onTransactionSubmitted,
		refreshState,
	}
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
	const {
		approveZoltarForkRep,
		createChildUniverse: createZoltarChildUniverse,
		createMarket,
		forkZoltar,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		loadingZoltarQuestionCount,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		loadZoltarQuestions,
		marketCreating,
		marketError,
		marketForm,
		marketResult,
		migrateInternalRep,
		prepareRepForMigration,
		resetMarket,
		setMarketForm,
		setZoltarForkQuestionId,
		setZoltarMigrationForm,
		zoltarChildUniverseError,
		zoltarChildUniversePendingOutcomeIndex,
		zoltarForkApproval,
		zoltarForkActiveAction,
		zoltarForkError,
		zoltarForkPending,
		zoltarForkQuestionId,
		zoltarForkRepBalance,
		zoltarMigrationChildRepBalances,
		zoltarMigrationActiveAction,
		zoltarMigrationError,
		zoltarMigrationForm,
		zoltarMigrationPending,
		zoltarMigrationPreparedRepBalance,
		zoltarMigrationResult,
		zoltarQuestionCount,
		zoltarQuestions,
		zoltarUniverse,
		zoltarUniverseMissing,
	} = useMarketCreation({ ...baseHookConfig, activeUniverseId, activeZoltarView, autoLoadInitialData: walletBootstrapComplete && environmentReady, deploymentStatuses })
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
	const { checkingDuplicateOriginPool, createPool, duplicateOriginPoolExists, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, poolCreationMarketDetails, resetSecurityPoolCreation, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } =
		useSecurityPoolCreation({
			...baseHookConfig,
			deploymentStatuses,
			enabled: route === 'security-pools',
			zoltarUniverseHasForked,
		})
	const {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault,
		redeemFees,
		securityVaultActiveAction,
		securityVaultDetails,
		securityVaultError,
		securityVaultForm,
		securityVaultMissing,
		securityVaultRepApproval,
		securityVaultRepBalance,
		securityVaultResult,
		setSecurityBondAllowance,
		setSecurityVaultForm,
		withdrawRep,
	} = useSecurityVaultOperations({ ...baseHookConfig, enabled: route === 'security-pools' })
	const {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		loadingOpenOracleCreate,
		loadingOracleReport,
		openOracleActiveAction,
		openOracleError,
		openOracleCreateForm,
		openOracleForm,
		openOracleInitialReportSubmission,
		openOracleInitialReportState,
		openOracleReportDetails,
		openOracleResult,
		refreshPrice,
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		submitInitialReport,
		wrapWethForInitialReport,
	} = useOpenOracleOperations({ ...baseHookConfig, enabled: route === 'open-oracle' })
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingActiveAction, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations(baseHookConfig)
	const { executePendingPoolOperation, loadingPoolOracleManager, loadPoolOracleManager, poolOracleActiveAction, poolOracleManagerDetails, poolOracleManagerError, poolPriceOracleResult, requestPoolPrice } = usePriceOracleManager(baseHookConfig)
	const {
		checkedSecurityPoolAddress,
		closeLiquidationModal,
		hasLoadedSecurityPools,
		liquidationAmount,
		liquidationMaxAmount,
		liquidationManagerAddress,
		liquidationModalOpen,
		liquidationSecurityPoolAddress,
		liquidationTargetVault,
		loadingSecurityPools,
		loadSecurityPools,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPools,
		setLiquidationAmount,
	} = useSecurityPoolsOverview(baseHookConfig)
	const { createCompleteSet, loadingTradingDetails, loadingTradingForkUniverse, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingActiveAction, tradingDetails, tradingError, tradingForm, tradingForkUniverse, tradingResult } = useTradingOperations({
		...baseHookConfig,
		enabled: route === 'security-pools',
	})
	const {
		claimAuctionProceeds,
		createChildUniverse,
		finalizeTruthAuction,
		forkAuctionActiveAction,
		forkAuctionDetails,
		forkAuctionError,
		forkAuctionForm,
		forkAuctionResult,
		forkUniverse,
		forkWithOwnEscalation,
		initiateFork,
		loadForkAuction,
		loadingForkAuctionDetails,
		migrateEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		startTruthAuction,
		submitBid,
		withdrawBids,
	} = useForkAuctionOperations(baseHookConfig)
	const { repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, refreshRepPrices } = useRepPrices()
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
		refreshRepPrices()
	}
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const isMainnet = isSupportedAppChain(accountState.chainId)
	const wrongNetworkMessage = accountState.address !== undefined && accountState.chainId !== undefined && !isMainnet ? getWrongNetworkMessage() : undefined
	const augurPlaceHolderDeploymentMissing = environmentReady && augurPlaceHolderDeployed === false
	const showDeployTab = augurPlaceHolderDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const showAugurPlaceHolderDeploymentWarning = augurPlaceHolderDeploymentMissing
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = environmentReady && zoltarUniverseState === 'missing'
	const showZoltarUniverseForkedWarning = zoltarUniverse?.hasForked === true
	const disableRouteContent = route !== 'deploy' && (augurPlaceHolderDeploymentMissing || showZoltarUniverseWarning)
	const isRouteContentDisabled = transactionState.value.transactionInFlightCount > 0 || disableRouteContent
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const walletPresentation = getWalletPresentation({ accountAddress: accountState.address, hasWallet: hasInjectedWallet, isSupportedChain: isMainnet })
	const showTransactionSuccessNotice =
		route === 'deploy'
			? true
			: route === 'open-oracle'
				? openOracleResult === undefined
				: route === 'security-pools'
					? securityPoolResult === undefined && securityPoolOverviewResult === undefined && securityVaultResult === undefined && tradingResult === undefined && reportingResult === undefined && forkAuctionResult === undefined && poolPriceOracleResult === undefined
					: true
	const overviewProps = {
		accountState,
		isConnectingWallet,
		isLoadingRepPrices,
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		onConnect: () => void connectWallet(),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		onRefreshRepPrices: refreshRepPrices,
		repPerEthPrice,
		repPerEthSource,
		repPerEthSourceUrl,
		repUsdcPrice,
		repUsdcSource,
		repUsdcSourceUrl,
		universePresentation,
		universeLabel,
		universeRepBalance: zoltarForkRepBalance,
		isRefreshing,
		walletBootstrapComplete,
	}
	const tabNavigationProps = {
		route,
		showDeployTab,
		augurPlaceHolderDeployed: hasLoadedDeploymentStatuses && augurPlaceHolderDeployed === true && !showZoltarUniverseWarning,
		deployRoute: DEPLOY_ROUTE,
		marketRoute: ZOLTAR_ROUTE,
		openOracleRoute: OPEN_ORACLE_ROUTE,
		securityPoolsRoute: SECURITY_POOLS_ROUTE,
		onRouteChange: navigate,
	}
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const derivedSecurityPoolsView = resolveFirstMatchingValue<SecurityPoolsView>(
		[
			[securityPoolAddress !== '', 'operate'],
			[securityPoolForm.marketId !== '' || marketDetails !== undefined || securityPoolResult !== undefined, 'create'],
		],
		'browse',
	)
	const activeSecurityPoolsView = resolveEnumValue<SecurityPoolsView>(securityPoolsView, derivedSecurityPoolsView, ['browse', 'create', 'operate'])
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, ['browse', 'create', 'selected-report'])
	const refreshSelectedPoolData = (requestedSecurityPoolAddress?: string) => {
		const nextSecurityPoolAddress = requestedSecurityPoolAddress ?? securityPoolAddress
		if (!walletBootstrapComplete) return
		if (!nextSecurityPoolAddress.startsWith('0x') || nextSecurityPoolAddress.length !== 42) return
		void loadSecurityPools(nextSecurityPoolAddress)
	}
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
		const { marketId, securityPoolAddress } = getUseQuestionForPoolState(questionId)
		setSecurityPoolForm(current => ({
			...current,
			marketId,
		}))
		setSecurityPoolsView('create')
		setSecurityPoolAddress(securityPoolAddress)
		navigate('security-pools')
	}

	useAppRouteEffects({
		augurPlaceHolderDeploymentMissing,
		environmentReady,
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		loadSecurityPools: async requestedSecurityPoolAddress => await loadSecurityPools(requestedSecurityPoolAddress),
		navigate,
		openOracleFormReportId: openOracleForm.reportId,
		openOracleReportDetailsReportId: openOracleReportDetails?.reportId,
		route,
		securityPoolAddress,
		securityPoolResultHash: securityPoolResult?.deployPoolHash,
		selectedPoolSecurityPoolAddress: selectedPool?.securityPoolAddress,
		setForkAuctionFormSecurityPoolAddress: nextSecurityPoolAddress => setForkAuctionForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setOpenOracleReport,
		setReportingFormSecurityPoolAddress: nextSecurityPoolAddress => setReportingForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setSecurityVaultFormSecurityPoolAddress: nextSecurityPoolAddress => setSecurityVaultForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setTradingFormSecurityPoolAddress: nextSecurityPoolAddress => setTradingForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		tradingResultHash: tradingResult?.hash,
		urlOpenOracleReportId,
		walletBootstrapComplete,
	})

	const deployRouteContentProps: DeploymentRouteContentProps = {
		accountAddress: accountState.address,
		busyStepId,
		deployNextMissingPending: deployNextMissingPending.value,
		deploymentSections,
		deploymentStatuses,
		isLoadingDeploymentStatuses,
		isMainnet,
		onDeploy: deployStep,
		onDeployNextMissing: () => void onDeployNextMissing(),
	}

	const marketRouteContentProps: MarketRouteContentProps = {
		accountState,
		activeView: activeZoltarView,
		hasLoadedZoltarQuestions,
		loadingZoltarForkAccess,
		zoltarForkActiveAction,
		loadingZoltarQuestionCount,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		zoltarUniverseState,
		onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void createZoltarChildUniverse(outcomeIndex),
		marketForm,
		marketCreating,
		marketError,
		marketResult,
		onActiveViewChange: view => setZoltarView(view),
		onApproveZoltarForkRep: amount => void approveZoltarForkRep(amount),
		onCreateMarket: () => void createMarket(),
		onForkZoltar: () => void forkZoltar(),
		onLoadZoltarQuestions: () => void loadZoltarQuestions(),
		onMigrateInternalRep: () => void migrateInternalRep(),
		onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
		onPrepareRepForMigration: () => void prepareRepForMigration(),
		onResetMarket: resetMarket,
		onUseQuestionForFork: (questionId: string) => setZoltarForkQuestionId(questionId),
		onUseQuestionForPool,
		onZoltarMigrationFormChange: update => setZoltarMigrationForm(current => ({ ...current, ...update })),
		zoltarQuestionCount,
		zoltarForkApproval,
		zoltarForkError,
		zoltarChildUniverseError,
		zoltarChildUniversePendingOutcomeIndex,
		zoltarForkPending,
		zoltarForkQuestionId,
		zoltarForkRepBalance,
		zoltarMigrationError,
		zoltarMigrationForm,
		zoltarMigrationChildRepBalances,
		zoltarMigrationActiveAction,
		zoltarMigrationPending,
		zoltarMigrationPreparedRepBalance,
		zoltarMigrationResult,
		zoltarQuestions,
		zoltarUniverse,
		onZoltarForkQuestionIdChange: (questionId: string) => setZoltarForkQuestionId(questionId),
	}

	const securityPoolsRouteContentProps: SecurityPoolsSectionProps = {
		activeView: activeSecurityPoolsView,
		createPool: {
			accountState,
			checkingDuplicateOriginPool,
			duplicateOriginPoolExists,
			poolCreationMarketDetails,
			onCreateSecurityPool: () => void createPool(),
			onLoadMarket: () => void loadMarket(),
			onLoadMarketById: loadMarketById,
			loadingMarketDetails,
			marketDetails,
			onResetSecurityPoolCreation: resetSecurityPoolCreation,
			onSecurityPoolFormChange: update => setSecurityPoolForm(current => ({ ...current, ...update })),
			zoltarUniverseHasForked,
			securityPools,
			securityPoolCreating,
			securityPoolError,
			securityPoolForm,
			securityPoolResult,
			repPerEthPrice,
			repPerEthSource,
			repPerEthSourceUrl,
		},
		onActiveViewChange: view => setSecurityPoolsView(view),
		overview: {
			accountState,
			checkedSecurityPoolAddress,
			closeLiquidationModal: () => closeLiquidationModal(),
			hasLoadedSecurityPools,
			liquidationAmount,
			liquidationMaxAmount,
			liquidationManagerAddress,
			liquidationModalOpen,
			liquidationSecurityPoolAddress,
			liquidationTargetVault,
			loadingPoolOracleManager,
			loadingSecurityPools,
			onLiquidationAmountChange: setLiquidationAmount,
			onLoadPoolOracleManager: (managerAddress: Address) => void loadPoolOracleManager(managerAddress),
			onOpenLiquidationModal: (managerAddress: Address, selectedSecurityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => openLiquidationModal(managerAddress, selectedSecurityPoolAddress, vaultAddress, maxAmount),
			onLoadSecurityPools: () => void loadSecurityPools(),
			onQueueLiquidation: (managerAddress: Address, selectedSecurityPoolAddress: Address) => void queueLiquidation(managerAddress, selectedSecurityPoolAddress),
			poolOracleManagerDetails,
			securityPoolOverviewActiveAction,
			securityPoolOverviewError,
			securityPoolOverviewResult,
			securityPools,
			repPerEthPrice,
			repPerEthSource,
			repPerEthSourceUrl,
		},
		workflow: {
			accountState,
			activeUniverseId,
			checkedSecurityPoolAddress,
			closeLiquidationModal: () => closeLiquidationModal(),
			forkAuction: {
				accountState,
				forkAuctionActiveAction,
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
			liquidationMaxAmount,
			liquidationManagerAddress,
			liquidationModalOpen,
			liquidationSecurityPoolAddress,
			liquidationTargetVault,
			onLiquidationAmountChange: setLiquidationAmount,
			onOpenLiquidationModal: (managerAddress: Address, selectedSecurityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => openLiquidationModal(managerAddress, selectedSecurityPoolAddress, vaultAddress, maxAmount),
			onQueueLiquidation: (managerAddress: Address, selectedSecurityPoolAddress: Address) => void queueLiquidation(managerAddress, selectedSecurityPoolAddress),
			onExecutePendingPoolOperation: (managerAddress: Address, operationId: bigint) => void executePendingPoolOperation(managerAddress, operationId),
			loadingPoolOracleManager,
			loadingSecurityPools,
			onLoadPoolOracleManager: (managerAddress: Address) => void loadPoolOracleManager(managerAddress),
			onRequestPoolPrice: (managerAddress: Address) => void requestPoolPrice(managerAddress),
			onRefreshSelectedPoolData: refreshSelectedPoolData,
			onSelectedPoolViewChange: setSelectedPoolView,
			onViewPendingReport: reportId => {
				setOpenOracleView('selected-report')
				setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
				navigate('open-oracle')
				void loadOracleReport(reportId.toString())
			},
			securityPoolOverviewActiveAction,
			securityPoolOverviewResult,
			poolOracleActiveAction,
			poolOracleManagerDetails,
			poolOracleManagerError,
			poolPriceOracleResult,
			selectedPoolView,
			onSecurityPoolAddressChange: value => {
				setSecurityPoolAddress(value)
			},
			repPerEthPrice,
			repPerEthSource,
			repPerEthSourceUrl,
			reporting: {
				accountState,
				loadingReportingDetails,
				onLoadReporting: () => void loadReporting(),
				onReportOutcome: () => void onReportOutcome(),
				onReportingFormChange: update => setReportingForm(current => ({ ...current, ...update })),
				onWithdrawEscalation: () => void withdrawEscalation(),
				reportingActiveAction,
				reportingDetails,
				reportingError,
				reportingForm,
				reportingResult,
			},
			securityPoolAddress,
			securityPools,
			securityVault: {
				accountState,
				loadingSecurityVault,
				onApproveRep: amount => void approveRep(amount),
				onDepositRep: () => void depositRep(),
				onLoadSecurityVault: createLoadSecurityVaultHandler(loadSecurityVault),
				onRedeemFees: () => void redeemFees(),
				onSetSecurityBondAllowance: () => void setSecurityBondAllowance(),
				onSecurityVaultFormChange: update => setSecurityVaultForm(current => ({ ...current, ...update })),
				onWithdrawRep: () => void withdrawRep(),
				securityVaultActiveAction,
				securityVaultDetails,
				securityVaultError,
				securityVaultForm,
				securityVaultMissing,
				securityVaultRepApproval,
				securityVaultRepBalance,
				securityVaultResult,
				selectedPoolSecurityMultiplier: selectedPool?.securityMultiplier,
				repPerEthPrice,
				repPerEthSource,
				repPerEthSourceUrl,
				securityPoolVaults: selectedPool?.vaults,
			},
			trading: {
				accountState,
				loadingTradingForkUniverse,
				loadingTradingDetails,
				onCreateCompleteSet: () => void createCompleteSet(),
				onMigrateShares: () => void migrateShares(),
				onRedeemCompleteSet: () => void redeemCompleteSet(),
				onRedeemShares: () => void redeemShares(),
				onTradingFormChange: update => setTradingForm(current => ({ ...current, ...update })),
				repPerEthPrice,
				repPerEthSource,
				repPerEthSourceUrl,
				selectedPool,
				tradingActiveAction,
				tradingDetails,
				tradingError,
				tradingForm,
				tradingForkUniverse,
				tradingResult,
			},
		},
	}

	const openOracleRouteContentProps: OpenOracleSectionProps = {
		activeView: activeOpenOracleView,
		accountState,
		loadingOracleReport,
		onApproveToken1: amount => void approveToken1(amount),
		onApproveToken2: amount => void approveToken2(amount),
		onCreateOpenOracleGame: () => void createOpenOracleGame(),
		onDisputeReport: () => void disputeReport(),
		onLoadOracleReport: reportId => {
			if (reportId === undefined) return
			void loadOracleReport(reportId)
		},
		onRefreshPrice: refreshPrice,
		onActiveViewChange: view => setOpenOracleView(view),
		onOpenOracleCreateFormChange: update => setOpenOracleCreateForm(current => ({ ...current, ...update })),
		onOpenOracleFormChange: update => setOpenOracleForm(current => ({ ...current, ...update })),
		onSettleReport: () => void settleReport(),
		onSubmitInitialReport: () => void submitInitialReport(),
		onWrapWethForInitialReport: () => void wrapWethForInitialReport(),
		loadingOpenOracleCreate,
		openOracleActiveAction,
		openOracleError,
		openOracleCreateForm,
		openOracleForm,
		openOracleInitialReportSubmission,
		openOracleInitialReportState,
		openOracleReportDetails,
		openOracleResult,
	}

	const routeSubNavigation =
		route === 'zoltar' ? (
			<RouteSubNavigation
				ariaLabel='Zoltar views'
				value={activeZoltarView}
				onChange={view => setZoltarView(view)}
				options={[
					{ href: getRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(window.location.search, 'questions')), label: 'Questions', value: 'questions' },
					{ href: getRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(window.location.search, 'create')), label: 'Create Question', value: 'create' },
					{ href: getRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(window.location.search, 'fork')), label: 'Fork Zoltar', value: 'fork' },
					{
						label: 'Migrate REP',
						value: 'migrate',
						disabled: zoltarUniverse?.hasForked !== true,
						...(zoltarUniverse?.hasForked === true ? { href: getRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(window.location.search, 'migrate')) } : { reason: 'Fork Zoltar before migrating REP.' }),
					},
				]}
			/>
		) : route === 'security-pools' ? (
			<RouteSubNavigation
				ariaLabel='Security Pools views'
				value={activeSecurityPoolsView}
				onChange={view => setSecurityPoolsView(view)}
				options={[
					{ href: getRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(window.location.search, 'browse')), label: 'Browse', value: 'browse' },
					{ href: getRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(window.location.search, 'create')), label: 'Create', value: 'create' },
					{ href: getRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(window.location.search, 'operate')), label: 'Operate', value: 'operate' },
				]}
			/>
		) : route === 'open-oracle' ? (
			<RouteSubNavigation
				ariaLabel='Open Oracle views'
				value={activeOpenOracleView}
				onChange={view => setOpenOracleView(view)}
				options={[
					{ href: getRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(window.location.search, 'browse')), label: 'Browse', value: 'browse' },
					{ href: getRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(window.location.search, 'create')), label: 'Create', value: 'create' },
					{ href: getRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(window.location.search, 'selected-report')), label: 'Selected Report', value: 'selected-report' },
				]}
			/>
		) : undefined

	return (
		<main>
			<AppStatusNotices
				errorMessage={errorMessage}
				hasInjectedWallet={hasInjectedWallet}
				simulationBootstrapError={environmentBootstrapError}
				showAugurPlaceHolderDeploymentWarning={showAugurPlaceHolderDeploymentWarning}
				showTransactionSuccessNotice={showTransactionSuccessNotice}
				showZoltarUniverseForkedWarning={showZoltarUniverseForkedWarning}
				transactionState={transactionState.value}
				walletPresentation={walletPresentation}
				zoltarUniverse={zoltarUniverse}
			/>
			<AppHeaderShell overview={overviewProps} simulationController={simulationController} subNavigation={routeSubNavigation} tabNavigation={tabNavigationProps} onRefresh={refreshSimulationView} />

			<fieldset className='route-shell' disabled={isRouteContentDisabled}>
				<AppRouteContent deploy={deployRouteContentProps} market={marketRouteContentProps} openOracle={openOracleRouteContentProps} route={route} securityPools={securityPoolsRouteContentProps} wrongNetworkMessage={wrongNetworkMessage} />
			</fieldset>
		</main>
	)
}
