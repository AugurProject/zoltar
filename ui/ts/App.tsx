import { useSignal } from '@preact/signals'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address, Hash } from '@zoltar/shared/ethereum'
import { AppHeaderShell } from './components/AppHeaderShell.js'
import { AppPageHeading } from './components/AppPageHeading.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { AppStatusNotices } from './components/AppStatusNotices.js'
import { GlobalTransactionTray } from './components/GlobalTransactionTray.js'
import { TransactionActionButtonLockProvider } from './components/TransactionActionButton.js'
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
import { getAppPageTitle } from './lib/appPageTitle.js'
import { ChainBlockNumberContext, ChainTimestampContext } from './lib/chainTimestamp.js'
import { getDeploymentSections } from './lib/deployment.js'
import { resolveLoadableValueState } from './lib/loadState.js'
import { getWrongNetworkMessage, isSupportedAppChain } from './lib/network.js'
import { applyReportingFormUpdate } from './lib/reportingForm.js'
import { createLoadSecurityVaultHandler } from './lib/securityVaultHandlers.js'
import { getUseQuestionForPoolState } from './lib/securityPoolNavigation.js'
import { createInitialTransactionTrayState, getTransactionActionLockReason, markTransactionFailed, markTransactionFinished, markTransactionPrepared, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from './lib/transactionTray.js'
import type { TransactionTrayState } from './lib/transactionTray.js'
import type { TransactionRequestPreview } from './lib/chainBackend.js'
import { ActionSafetyProvider } from './lib/actionSafety/runtime.js'
import { buildRouteHref, DEPLOY_ROUTE, getRouteHashSearch, OPEN_ORACLE_ROUTE, SECURITY_POOLS_ROUTE, ZOLTAR_ROUTE } from './lib/routing.js'
import { writeOpenOracleViewQueryParam, writeSecurityPoolsViewQueryParam, writeZoltarViewQueryParam } from './lib/urlParams.js'
import { getUniversePresentation } from './lib/userCopy.js'
import { formatUniverseCollectionLabel } from './lib/universe.js'
import { resolveEnumValue, resolveFirstMatchingValue } from './lib/viewState.js'
import type { ReportingFormState } from './types/app.js'
import type { DeploymentRouteContentProps, GlobalTransactionPresentation, MarketRouteContentProps, OpenOracleSectionProps, OpenOracleView, SecurityPoolsSectionProps, SecurityPoolsView, TransactionIntent, ZoltarView } from './types/components.js'
export function App() {
	const transactionState = useSignal<TransactionTrayState>(createInitialTransactionTrayState())
	const deployNextMissingPending = useSignal(false)
	const [selectedPoolRefreshNonce, setSelectedPoolRefreshNonce] = useState(0)
	const { activeUniverseId, openOracleReportId: urlOpenOracleReportId, openOracleView, securityPoolsView, securityPoolAddress, selectedPoolView, setActiveUniverseId, setOpenOracleReport, setOpenOracleView, setSecurityPoolsView, setSecurityPoolAddress, setSelectedPoolView, setZoltarView, zoltarView } = useUrlState()
	const activeZoltarView = resolveEnumValue<ZoltarView>(zoltarView, 'questions', ['questions', 'create', 'fork', 'migrate'])
	const onTransactionRequested = (intent: TransactionIntent) => {
		transactionState.value = markTransactionRequested(transactionState.value, intent)
	}
	const onTransactionPrepared = (preview: TransactionRequestPreview) => {
		transactionState.value = markTransactionPrepared(transactionState.value, preview)
	}
	const onTransactionSubmitted = (hash: Hash) => {
		transactionState.value = markTransactionSubmitted(transactionState.value, hash)
	}
	const onTransactionFailed = (message: string) => {
		transactionState.value = markTransactionFailed(transactionState.value, message)
	}
	const onTransactionPresented = (presentation: GlobalTransactionPresentation) => {
		transactionState.value = markTransactionPresented(transactionState.value, presentation)
	}
	const onTransactionFinished = () => {
		transactionState.value = markTransactionFinished(transactionState.value)
	}
	const { navigate, route } = useHashRoute()
	const {
		accountState,
		augurPlaceHolderDeployed,
		connectWallet,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatuses,
		environmentBootstrapError,
		environmentReady,
		errorMessage: walletErrorMessage,
		readBackendMessage,
		readBackendStatus,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isLoadingDeploymentStatuses,
		isRefreshing,
		refreshState,
		setDeploymentStatuses,
		walletBootstrapComplete,
	} = useOnchainState()
	const readBackendReady = readBackendMessage === undefined
	const canReadOnchainData = environmentReady && readBackendReady
	const baseHookConfig = {
		accountAddress: accountState.address,
		onTransactionFailed,
		onTransactionFinished,
		onTransactionPresented,
		onTransactionPrepared,
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
		loadZoltarForkAccess,
		loadingZoltarForkAccess,
		loadingZoltarQuestionCount,
		loadingZoltarQuestions,
		loadingZoltarUniverse,
		loadZoltarQuestionPage,
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
		zoltarQuestionPage,
		zoltarQuestions,
		zoltarUniverse,
		zoltarUniverseMissing,
	} = useMarketCreation({ ...baseHookConfig, activeUniverseId, activeZoltarView, autoLoadInitialData: walletBootstrapComplete && canReadOnchainData, deploymentStatuses })
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
	const { checkingDuplicateOriginPool, createPool, duplicateOriginPoolExists, loadMarket, loadMarketById, loadingMarketDetails, marketDetails, poolCreationMarketDetails, resetSecurityPoolCreation, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } =
		useSecurityPoolCreation({
			...baseHookConfig,
			deploymentStatuses,
			enabled: route === 'security-pools' && canReadOnchainData,
			zoltarUniverseHasForked,
		})
	const {
		approveRep,
		depositRep,
		loadSecurityVault,
		loadingSecurityVault,
		redeemFees,
		redeemRep,
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
	} = useSecurityVaultOperations({ ...baseHookConfig, enabled: route === 'security-pools' && canReadOnchainData, selectedSecurityPoolAddress: securityPoolAddress })
	const {
		approveToken1,
		approveToken2,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		loadingOpenOracleCreate,
		loadingOracleReport,
		openOracleActiveAction,
		openOracleCreateForm,
		openOracleDisputeSubmission,
		openOracleError,
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
	} = useOpenOracleOperations({ ...baseHookConfig, enabled: route === 'open-oracle' && canReadOnchainData })
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingActiveAction, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({ ...baseHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const updateReportingForm = (update: Partial<ReportingFormState>) => {
		setReportingForm(current => applyReportingFormUpdate(current, update))
	}
	const { executePendingPoolOperation, loadingPoolOracleManager, loadPoolOracleManager, poolOracleActiveAction, poolOracleManagerDetails, poolOracleManagerError, poolPriceOracleResult, requestPoolPrice } = usePriceOracleManager(baseHookConfig)
	const {
		checkedSecurityPoolAddress,
		closeLiquidationModal,
		hasLoadedSecurityPools,
		hasLoadedSecurityPoolPage,
		liquidationAmount,
		liquidationMaxAmount,
		liquidationManagerAddress,
		liquidationModalOpen,
		liquidationSecurityPoolAddress,
		liquidationTargetVault,
		liquidationTimeoutMinutes,
		loadingSecurityPools,
		loadingSecurityPoolPage,
		loadBrowseSecurityPoolPage,
		loadSecurityPools,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction,
		securityPoolOverviewError,
		securityPoolLiquidationError,
		securityPoolOverviewResult,
		securityPoolBrowseCount,
		securityPoolPage,
		securityPools,
		setLiquidationAmount,
		setLiquidationTimeoutMinutes,
	} = useSecurityPoolsOverview(baseHookConfig)
	const { createCompleteSet, loadingTradingDetails, loadingTradingForkUniverse, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingActiveAction, tradingDetails, tradingError, tradingForm, tradingForkUniverse, tradingResult } = useTradingOperations({
		...baseHookConfig,
		deploymentStatuses,
		enabled: route === 'security-pools' && canReadOnchainData,
		selectedSecurityPoolAddress: securityPoolAddress,
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
		migrateUnresolvedEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		settleForkedEscalation,
		startTruthAuction,
		submitBid,
	} = useForkAuctionOperations({ ...baseHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const { repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, refreshRepPrices } = useRepPrices()
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
		refreshRepPrices()
	}
	const lastSecurityVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const lastStagedVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessage = deploymentErrorMessage ?? walletErrorMessage
	const isMainnet = isSupportedAppChain(accountState.chainId)
	const wrongNetworkMessage = accountState.address !== undefined && accountState.chainId !== undefined && !isMainnet ? getWrongNetworkMessage() : undefined
	const augurPlaceHolderDeploymentMissing = canReadOnchainData && augurPlaceHolderDeployed === false
	const showDeployTab = augurPlaceHolderDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const showAugurPlaceHolderDeploymentWarning = augurPlaceHolderDeploymentMissing
	const zoltarUniverseState = resolveLoadableValueState({
		isLoading: loadingZoltarUniverse,
		isMissing: zoltarUniverseMissing,
		value: zoltarUniverse,
	})
	const showZoltarUniverseWarning = canReadOnchainData && zoltarUniverseState === 'missing'
	const showZoltarUniverseForkedWarning = zoltarUniverse?.hasForked === true
	const disableRouteContent = route !== 'deploy' && (!readBackendReady || augurPlaceHolderDeploymentMissing || showZoltarUniverseWarning)
	const isRouteContentDisabled = disableRouteContent
	const universeLabel = formatUniverseCollectionLabel([activeUniverseId])
	const universePresentation = showZoltarUniverseWarning ? getUniversePresentation(zoltarUniverseState) : undefined
	const overviewProps = {
		activeUniverseId,
		accountState,
		isConnectingWallet,
		isLoadingRepPrices,
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		onConnect: () => void connectWallet(),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		onRefreshRepPrices: refreshRepPrices,
		parentUniverseId: zoltarUniverse?.parentUniverseId,
		repPerEthPrice,
		repPerEthSource,
		repPerEthSourceUrl,
		repUsdcPrice,
		repUsdcSource,
		repUsdcSourceUrl,
		readBackendStatus,
		universeForkTime: zoltarUniverse?.forkTime,
		universeHasForked: zoltarUniverse?.hasForked,
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
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, activeZoltarView, route })
	const refreshSelectedPoolData = (requestedSecurityPoolAddress?: string) => {
		const nextSecurityPoolAddress = requestedSecurityPoolAddress ?? securityPoolAddress
		if (!walletBootstrapComplete) return
		if (!nextSecurityPoolAddress.startsWith('0x') || nextSecurityPoolAddress.length !== 42) return
		setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1)
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
	useEffect(() => {
		const securityVaultRepRefreshHash = securityVaultResult?.action === 'depositRep' || securityVaultResult?.action === 'redeemRep' || (securityVaultResult?.action === 'queueWithdrawRep' && securityVaultResult.stagedExecution?.success === true) ? securityVaultResult.hash : undefined
		if (securityVaultRepRefreshHash === undefined) {
			lastSecurityVaultRepRefreshHash.current = undefined
			return
		}
		if (lastSecurityVaultRepRefreshHash.current === securityVaultRepRefreshHash) return
		lastSecurityVaultRepRefreshHash.current = securityVaultRepRefreshHash
		void loadZoltarForkAccess()
	}, [loadZoltarForkAccess, securityVaultResult])
	useEffect(() => {
		const stagedVaultRepRefreshHash = poolPriceOracleResult?.action === 'executeStagedOperation' && poolPriceOracleResult.stagedExecution?.success === true && poolPriceOracleResult.stagedExecution.operation === 'withdrawRep' ? poolPriceOracleResult.hash : undefined
		if (stagedVaultRepRefreshHash === undefined) {
			lastStagedVaultRepRefreshHash.current = undefined
			return
		}
		if (lastStagedVaultRepRefreshHash.current === stagedVaultRepRefreshHash) return
		lastStagedVaultRepRefreshHash.current = stagedVaultRepRefreshHash
		void loadZoltarForkAccess()
	}, [loadZoltarForkAccess, poolPriceOracleResult])
	useAppRouteEffects({
		accountAddress: accountState.address,
		augurPlaceHolderDeploymentMissing,
		environmentReady: canReadOnchainData,
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
		setReportingFormSecurityPoolAddress: nextSecurityPoolAddress => updateReportingForm({ securityPoolAddress: nextSecurityPoolAddress }),
		setSecurityVaultFormSelectedVaultAddress: nextSelectedVaultAddress => setSecurityVaultForm(current => (current.selectedVaultAddress === nextSelectedVaultAddress ? current : { ...current, selectedVaultAddress: nextSelectedVaultAddress })),
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
		activeUniverseId,
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
		onLoadZoltarQuestions: loadZoltarQuestions,
		onLoadZoltarQuestionPage: loadZoltarQuestionPage,
		onMigrateInternalRep: () => void migrateInternalRep(),
		onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
		onPrepareRepForMigration: () => void prepareRepForMigration(),
		onResetMarket: resetMarket,
		onUseQuestionForFork: (questionId: string) => setZoltarForkQuestionId(questionId),
		onUseQuestionForPool,
		onZoltarMigrationFormChange: update => setZoltarMigrationForm(current => ({ ...current, ...update })),
		zoltarQuestionCount,
		zoltarQuestionPage,
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
			hasLoadedSecurityPoolPage,
			liquidationAmount,
			liquidationMaxAmount,
			liquidationManagerAddress,
			liquidationModalOpen,
			liquidationSecurityPoolAddress,
			liquidationTargetVault,
			liquidationTimeoutMinutes,
			loadingPoolOracleManager,
			loadingSecurityPoolPage,
			loadingSecurityPools,
			onLoadSecurityPoolPage: (pageIndex: number, pageSize: number) => void loadBrowseSecurityPoolPage(pageIndex, pageSize),
			onLiquidationAmountChange: setLiquidationAmount,
			onLiquidationTimeoutMinutesChange: setLiquidationTimeoutMinutes,
			onLoadPoolOracleManager: (managerAddress: Address) => void loadPoolOracleManager(managerAddress),
			onLoadSecurityPools: () => void loadSecurityPools(),
			onCreateSecurityPool: () => setSecurityPoolsView('create'),
			onOpenLiquidationModal: (managerAddress: Address, selectedSecurityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => openLiquidationModal(managerAddress, selectedSecurityPoolAddress, vaultAddress, maxAmount),
			onQueueLiquidation: (managerAddress: Address, selectedSecurityPoolAddress: Address) => void queueLiquidation(managerAddress, selectedSecurityPoolAddress),
			poolOracleManagerDetails,
			securityPoolBrowseCount,
			securityPoolPage,
			securityPoolOverviewActiveAction,
			securityPoolOverviewError,
			securityPoolLiquidationError,
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
				onClaimAuctionProceeds: (securityPoolAddressOverride, selectedClaimBids, selectedRefundBids) => void claimAuctionProceeds(securityPoolAddressOverride, selectedClaimBids, selectedRefundBids),
				onCreateChildUniverse: () => void createChildUniverse(forkAuctionForm.selectedOutcome),
				onFinalizeTruthAuction: securityPoolAddressOverride => void finalizeTruthAuction(securityPoolAddressOverride),
				onForkAuctionFormChange: update => setForkAuctionForm(current => ({ ...current, ...update })),
				onForkUniverse: () => void forkUniverse(),
				onForkWithOwnEscalation: () => void forkWithOwnEscalation(),
				onInitiateFork: () => void initiateFork(),
				onLoadForkAuction: securityPoolAddressOverride => void loadForkAuction(securityPoolAddressOverride),
				onMigrateEscalationDeposits: (outcome, depositIndexes) =>
					void migrateEscalation({
						outcome,
						...(depositIndexes === undefined ? {} : { depositIndexes }),
					}),
				onMigrateUnresolvedEscalation: selectedChildOutcome => void migrateUnresolvedEscalation(selectedChildOutcome),
				onMigrateRepToZoltar: outcomes => void migrateRepToZoltar(outcomes),
				onMigrateVault: () => void migrateVault(),
				onRefundLosingBids: (securityPoolAddressOverride, selectedBids) => void refundLosingBids(securityPoolAddressOverride, selectedBids),
				onStartTruthAuction: securityPoolAddressOverride => void startTruthAuction(securityPoolAddressOverride),
				onSubmitBid: securityPoolAddressOverride => void submitBid(securityPoolAddressOverride),
				onWithdrawForkedEscalation: (outcome, parentDepositIndexes) => void settleForkedEscalation(outcome, parentDepositIndexes),
			},
			liquidationAmount,
			liquidationMaxAmount,
			liquidationManagerAddress,
			liquidationModalOpen,
			liquidationSecurityPoolAddress,
			liquidationTargetVault,
			liquidationTimeoutMinutes,
			onLiquidationAmountChange: setLiquidationAmount,
			onLiquidationTimeoutMinutesChange: setLiquidationTimeoutMinutes,
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
			securityPoolOverviewError,
			securityPoolLiquidationError,
			securityPoolOverviewResult,
			poolOracleActiveAction,
			poolOracleManagerDetails,
			poolOracleManagerError,
			poolPriceOracleResult,
			selectedPoolRefreshNonce,
			universeForkTime: zoltarUniverse?.forkTime,
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
				onReportingFormChange: update => updateReportingForm(update),
				onWithdrawEscalation: (outcome, depositIndexes) => void withdrawEscalation(outcome, depositIndexes),
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
				onRedeemRep: () => void redeemRep(),
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
		openOracleDisputeSubmission,
		openOracleForm,
		openOracleInitialReportSubmission,
		openOracleInitialReportState,
		openOracleReportDetails,
		openOracleResult,
	}
	let routeSubNavigation: ComponentChildren = undefined
	if (route === 'zoltar') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel='Market views'
				value={activeZoltarView}
				onChange={view => setZoltarView(view)}
				options={[
					{ href: buildRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(getRouteHashSearch(), 'questions')), label: 'Questions & Markets', value: 'questions' },
					{ href: buildRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(getRouteHashSearch(), 'create')), label: 'Create Question', value: 'create' },
					{ href: buildRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(getRouteHashSearch(), 'fork')), label: 'Fork Oracle', value: 'fork' },
					{
						label: 'Migrate REP',
						value: 'migrate',
						disabled: zoltarUniverse?.hasForked !== true,
						...(zoltarUniverse?.hasForked === true ? { href: buildRouteHref(ZOLTAR_ROUTE, writeZoltarViewQueryParam(getRouteHashSearch(), 'migrate')) } : { reason: 'Fork Oracle before migrating REP.' }),
					},
				]}
			/>
		)
	} else if (route === 'security-pools') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel='Security Pools views'
				value={activeSecurityPoolsView}
				onChange={view => setSecurityPoolsView(view)}
				options={[
					{ href: buildRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')), label: 'Browse Pools', value: 'browse' },
					{ href: buildRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'create')), label: 'Create Pool', value: 'create' },
					{ href: buildRouteHref(SECURITY_POOLS_ROUTE, writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'operate')), label: 'Manage Pool', value: 'operate' },
				]}
			/>
		)
	} else if (route === 'open-oracle') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel='Oracle report views'
				value={activeOpenOracleView}
				onChange={view => setOpenOracleView(view)}
				options={[
					{ href: buildRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(getRouteHashSearch(), 'browse')), label: 'Browse', value: 'browse' },
					{ href: buildRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(getRouteHashSearch(), 'create')), label: 'Create Report', value: 'create' },
					{ href: buildRouteHref(OPEN_ORACLE_ROUTE, writeOpenOracleViewQueryParam(getRouteHashSearch(), 'selected-report')), label: 'Report Details', value: 'selected-report' },
				]}
			/>
		)
	}

	return (
		<ChainBlockNumberContext.Provider value={currentBlockNumber}>
			<ChainTimestampContext.Provider value={currentTimestamp}>
				<ActionSafetyProvider>
					<main>
						<AppPageHeading pageTitle={pageTitle} />
						<AppStatusNotices
							errorMessage={errorMessage}
							readBackendMessage={readBackendMessage}
							readBackendStatus={readBackendStatus}
							simulationBootstrapError={environmentBootstrapError}
							showAugurPlaceHolderDeploymentWarning={showAugurPlaceHolderDeploymentWarning}
							showZoltarUniverseForkedWarning={showZoltarUniverseForkedWarning}
							wrongNetworkMessage={wrongNetworkMessage}
							zoltarUniverse={zoltarUniverse}
						/>
						<AppHeaderShell overview={overviewProps} simulationController={simulationController} subNavigation={routeSubNavigation} tabNavigation={tabNavigationProps} onRefresh={refreshSimulationView} />
						<GlobalTransactionTray transaction={transactionState.value.active} />

						<div id='app-content' tabIndex={-1}>
							<TransactionActionButtonLockProvider disabledReason={getTransactionActionLockReason(transactionState.value)}>
								<fieldset className='route-shell' disabled={isRouteContentDisabled}>
									<AppRouteContent deploy={deployRouteContentProps} market={marketRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={route} securityPools={securityPoolsRouteContentProps} wrongNetworkMessage={wrongNetworkMessage} />
								</fieldset>
							</TransactionActionButtonLockProvider>
						</div>
					</main>
				</ActionSafetyProvider>
			</ChainTimestampContext.Provider>
		</ChainBlockNumberContext.Provider>
	)
}
