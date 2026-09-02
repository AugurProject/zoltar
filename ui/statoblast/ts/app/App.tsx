import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as statoblastAppCopy from '../copy/app.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { RouteSubNavigation } from '@zoltar/ui-core-shared/app/components/RouteSubNavigation.js'
import { AppRouteContent } from './components/AppRouteContent.js'
import { OverviewPanels } from '@zoltar/ui-zoltar/app/components/OverviewPanels.js'
import { useAppRouteEffects } from './useAppRouteEffects.js'
import { useDeploymentFlow } from '@zoltar/ui-zoltar/features/deployment/hooks/useDeploymentFlow.js'
import { buildDeploymentRouteContentProps } from '@zoltar/ui-zoltar/features/deployment/lib/deploymentRoute.js'
import { formatUniverseCollectionLabel } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '../features/markets/hooks/useMarketCreation.js'
import { useProtocolOnchainRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js'
import { useOpenOracleOperations } from '@zoltar/ui-zoltar/features/open-oracle/hooks/useOpenOracleOperations.js'
import { getOpenOracleViewOptions } from '@zoltar/ui-zoltar/features/open-oracle/lib/openOracleNavigation.js'
import { usePriceOracleManager } from '@zoltar/ui-zoltar/features/open-oracle/hooks/usePriceOracleManager.js'
import { useRepPrices } from '@zoltar/ui-zoltar/features/open-oracle/hooks/useRepPrices.js'
import { useReportingOperations } from '@zoltar/ui-zoltar/features/reporting/hooks/useReportingOperations.js'
import { useForkAuctionOperations } from '../features/truth-auctions/hooks/useForkAuctionOperations.js'
import { useSecurityPoolCreation } from '../features/security-pools/hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from '../features/security-pools/hooks/useSecurityPoolsOverview.js'
import { createLoadSecurityVaultHandler } from '../features/security-pools/lib/securityVaultHandlers.js'
import { useSecurityVaultOperations } from '../features/security-pools/hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from '../features/markets/hooks/useTradingOperations.js'
import { useUrlState } from '@zoltar/ui-core-shared/app/hooks/useUrlState.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { initializeStatoblastActiveEnvironment } from './activeEnvironment.js'
import { applicationTitle, formatAppDocumentTitle, getAppPageTitle } from './appPageTitle.js'
import { applyReportingFormUpdate } from '@zoltar/ui-zoltar/features/reporting/lib/reportingForm.js'
import { buildRouteHref, getRouteHashSearch, parseRouteHash } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeSecurityPoolsViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/lib/viewState.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import type { ReportingFormState } from '@zoltar/ui-zoltar/types/app.js'
import type { OpenOracleSectionProps, OpenOracleView } from '@zoltar/ui-zoltar/features/types.js'
import type { Route } from '../types/app.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../features/types.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'
import { statoblastRouting } from '../lib/routing.js'
import { getStatoblastDeploymentSections } from '../features/deployment/deploymentSections.js'
import { getInvalidStatoblastRouteState } from './lib/routeValidation.js'
import { shouldAutoLoadUniverseDirectory } from './lib/universeDirectory.js'
import { readUiPriceOracle, UiPriceOracleSettings } from './UiPriceOracleSettings.js'
import { isUiOpenOraclePriceUsed, resolveUiRepPerEthPrice } from '../features/security-pools/lib/uiPriceOracle.js'
import { getCurrentPoolOracleManagerDetails } from '../features/security-pools/lib/securityPoolWorkflow.js'

export function App() {
	const [uiPriceOracle, setUiPriceOracle] = useState(readUiPriceOracle)
	const [selectedPoolRefreshNonce, setSelectedPoolRefreshNonce] = useState(0)
	const [combinedCreateStage, setCombinedCreateStage] = useState<'creating-pool' | 'creating-question' | undefined>(undefined)
	const {
		activeUniverseId,
		openOracleReportId: urlOpenOracleReportId,
		openOracleView,
		securityPoolsView,
		securityPoolAddress,
		securityPoolQuestionId,
		selectedPoolView,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
		setSelectedPoolView,
	} = useUrlState()
	const { navigate, route } = useHashRoute()
	const resolvedRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'security-pools', 'open-oracle', 'not-found'])
	const {
		accountState,
		activeEnvironmentNonce,
		applicationDeploymentComplete,
		baseHookConfig,
		canReadOnchainData,
		changeWallet,
		chainClockError,
		connectWallet,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatusError,
		deploymentStatuses,
		disconnectWallet,
		environmentBootstrapError,
		environmentReady,
		errorMessages: onchainErrorMessages,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isLoadingDeploymentStatuses,
		isManagingWallet,
		isOnActiveAppChain,
		isRefreshing,
		readBackendMessage,
		readBackendReady,
		readBackendStatus,
		refreshState,
		setActiveEnvironmentNonce,
		setDeploymentStatuses,
		switchNetwork,
		transactionTray,
		walletBootstrapComplete,
		walletScopedAccountAddress,
		walletScopedHookConfig,
	} = useProtocolOnchainRuntime({
		enableChainClock: route !== 'deploy',
		onchainStateDependencies,
		replaceEnvironment: async canCommit => {
			let commitAllowed = false
			await initializeStatoblastActiveEnvironment(window.location, {
				shouldCommit: () => {
					commitAllowed = canCommit()
					return commitAllowed
				},
			})
			return commitAllowed
		},
		onEnvironmentCommitted: () => setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1),
	})
	const { transactionState } = transactionTray
	const deploymentFlow = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce, setDeploymentStatuses })
	const { errorMessage: deploymentErrorMessage } = deploymentFlow
	const { createMarket, loadZoltarForkAccess, loadingZoltarForkAccess, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm, zoltarUniverse, zoltarUniverseError } = useMarketCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		activeZoltarView: 'questions',
		autoLoadInitialData: walletBootstrapComplete && canReadOnchainData,
		deploymentStatuses,
		environmentRefreshKey: activeEnvironmentNonce,
	})
	const zoltarUniverseHasForked = zoltarUniverse?.hasForked === true
	const { checkingDuplicateOriginPool, createPool, duplicateOriginPoolExists, loadingMarketDetails, marketDetails, poolCreationMarketDetails, resetSecurityPoolCreation, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, setSecurityPoolForm } = useSecurityPoolCreation({
		...walletScopedHookConfig,
		activeUniverseId,
		deploymentStatuses,
		enabled: route === 'security-pools' && canReadOnchainData,
		zoltarUniverseHasForked,
	})
	const {
		approveRep,
		depositRepToVault,
		loadSecurityVault,
		loadingSecurityVault,
		redeemFees,
		redeemRepFromVault,
		securityVaultActiveAction,
		securityVaultDetails,
		securityVaultError,
		securityVaultForm,
		securityVaultMissing,
		securityVaultRepApproval,
		walletRepBalanceAttoRep,
		walletRepBalanceError,
		walletRepBalanceLoading,
		securityVaultResult,
		setSecurityVaultForm,
		withdrawRep,
	} = useSecurityVaultOperations({ ...walletScopedHookConfig, enabled: route === 'security-pools' && canReadOnchainData, selectedSecurityPoolAddress: securityPoolAddress })
	const { executePendingPoolOperation, loadingPoolOracleManager, loadPoolOracleManager, poolOracleActiveAction, poolOracleManagerDetails, poolOracleManagerError, poolOracleManagerErrorAddress, poolPriceOracleResult, requestPoolPrice } = usePriceOracleManager(walletScopedHookConfig)
	const { approveToken1, approveToken2, cancelWithdrawalBalanceCheck, createOpenOracleGame, disputeReport, loadOracleReport, openOracleSectionState, openOracleForm, setOpenOracleCreateForm, setOpenOracleForm, settleReport, withdrawBalance } = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: route === 'open-oracle' && canReadOnchainData,
		onReportSettled: async () => {
			if (poolOracleManagerDetails?.managerAddress !== undefined) await loadPoolOracleManager(poolOracleManagerDetails.managerAddress)
		},
	})
	const { loadingReportingDetails, loadReporting, onApproveReportingRep, onReportOutcome, reportingActiveAction, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({
		...walletScopedHookConfig,
		selectedSecurityPoolAddress: securityPoolAddress,
	})
	const updateReportingForm = (update: Partial<ReportingFormState>) => {
		setReportingForm((current: ReportingFormState) => applyReportingFormUpdate(current, update))
	}
	const {
		checkedSecurityPoolAddress,
		closeLiquidationModal,
		hasLoadedSecurityPoolPage,
		hasLoadedUniverseDirectoryPools,
		liquidationDebtEthAmount,
		maximumLiquidationDebtAttoEth,
		liquidationManagerAddress,
		liquidationFundingPreview,
		liquidationFundingPreviewError,
		liquidationModalOpen,
		liquidationSecurityPoolAddress,
		liquidationTargetVault,
		liquidationReceiverVault,
		liquidationApprovalId,
		liquidationApprovalDetails,
		liquidationApprovalError,
		liquidationReceiverVaultSummary,
		liquidationReceiverVaultSummaryError,
		liquidationReceiverVaultSummaryResolved,
		liquidationTimeoutMinutes,
		loadingSecurityPools,
		loadingLiquidationFundingPreview,
		loadingLiquidationApproval,
		loadingLiquidationReceiverVaultSummary,
		loadingSecurityPoolPage,
		loadingUniverseDirectoryPools,
		loadBrowseSecurityPoolPage,
		loadUniverseDirectoryPools,
		loadSecurityPools,
		loadLiquidationFundingPreview,
		loadLiquidationApproval,
		loadLiquidationReceiverVaultSummary,
		openLiquidationModal,
		queueLiquidation,
		securityPoolOverviewActiveAction,
		securityPoolOverviewError,
		securityPoolLiquidationError,
		securityPoolOverviewResult,
		securityPoolBrowseCount,
		securityPoolPage,
		securityPools,
		securityPoolUniverseDirectoryError,
		universeDirectoryPools,
		setLiquidationAmount,
		setLiquidationReceiverVault,
		setLiquidationApprovalId,
		setLiquidationTimeoutMinutes,
	} = useSecurityPoolsOverview({ ...walletScopedHookConfig, environmentRefreshKey: activeEnvironmentNonce })
	const { createCompleteSet, loadingTradingDetails, loadingTradingForkUniverse, migrateShares, redeemCompleteSet, redeemShares, setTradingForm, tradingActiveAction, tradingDetails, tradingError, tradingForm, tradingForkUniverse, tradingResult } = useTradingOperations({
		...walletScopedHookConfig,
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
		claimParentEscalation,
		migrateUnresolvedEscalation,
		migrateRepToZoltar,
		migrateVault,
		refundLosingBids,
		setForkAuctionForm,
		settleForkedEscalation,
		startTruthAuction,
		submitBid,
	} = useForkAuctionOperations({ ...walletScopedHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const { repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl, isLoadingRepPrices, isRefreshingRepPrices, refreshRepPrices } = useRepPrices()
	const simulationController = getActiveSimulationController()
	const combinedCreateScopeKeyRef = useRef('')
	const lastUniverseDirectoryAutoLoadContextKeyRef = useRef<string | undefined>(undefined)
	combinedCreateScopeKeyRef.current = `${walletScopedAccountAddress ?? ''}:${activeUniverseId.toString()}:${activeEnvironmentNonce}:${deploymentStatuses.map(status => `${status.id}:${status.deployed ? '1' : '0'}`).join(',')}`
	const universeDirectoryContextKey = `${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}:${activeUniverseId.toString()}`
	const refreshSimulationView = async () => {
		await refreshState()
		refreshRepPrices()
	}
	const refreshActiveEnvironment = async () => {
		await initializeStatoblastActiveEnvironment()
		setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
		setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1)
		await refreshSimulationView()
	}
	const lastSecurityVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const lastStagedVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const errorMessages = [deploymentErrorMessage, ...onchainErrorMessages.filter(message => message !== deploymentStatusError), chainClockError].filter((message): message is string => message !== undefined)
	const applicationDeploymentMissing = canReadOnchainData && applicationDeploymentComplete === false
	const showApplicationDeploymentWarning = applicationDeploymentMissing
	const disableRouteContent = route !== 'deploy' && (!readBackendReady || applicationDeploymentMissing)
	const isRouteContentDisabled = disableRouteContent
	const selectedPool = securityPools.find(pool => pool.securityPoolAddress.toLowerCase() === securityPoolAddress.toLowerCase())
	const selectedPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress: selectedPool?.managerAddress })
	const uiRepPerEthPrice = resolveUiRepPerEthPrice({
		currentTimestamp,
		openOraclePrice: selectedPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice,
		openOracleSettlementTimestamp: selectedPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp,
		openOracleValid: selectedPoolOracleManagerDetails?.isPriceValid,
		priceOracle: uiPriceOracle,
		uniswapPrice: repPerEthPrice,
	})
	const uiUsesOpenOraclePrice = isUiOpenOraclePriceUsed({
		currentTimestamp,
		openOraclePrice: selectedPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice,
		openOracleSettlementTimestamp: selectedPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp,
		openOracleValid: selectedPoolOracleManagerDetails?.isPriceValid,
		priceOracle: uiPriceOracle,
	})
	const uiRepPerEthSource = (() => {
		if (uiRepPerEthPrice === undefined) return undefined
		if (uiUsesOpenOraclePrice) return 'open-oracle' as const
		return repPerEthSource
	})()
	const uiRepPerEthSourceUrl = uiRepPerEthSource === 'open-oracle' ? undefined : repPerEthSourceUrl
	const overviewProps = {
		activeUniverseId,
		accountState,
		isConnectingWallet,
		isManagingWallet,
		isLoadingRepPrices,
		isRefreshingRepPrices,
		isLoadingUniverseRepBalance: loadingZoltarForkAccess,
		onConnect: () => void connectWallet(),
		onChangeWallet: () => void changeWallet(),
		onDisconnectWallet: () => void disconnectWallet(),
		onGoToGenesisUniverse: () => setActiveUniverseId(0n),
		onRefreshRepPrices: refreshRepPrices,
		onSwitchNetwork: () => void switchNetwork(),
		parentUniverseId: zoltarUniverse?.parentUniverseId,
		repPerEthFailure,
		repPerEthPrice: uiRepPerEthPrice,
		repPerEthSource: uiRepPerEthSource,
		repPerEthSourceUrl: uiRepPerEthSourceUrl,
		repUsdcFailure,
		repUsdcPrice,
		repUsdcSource,
		repUsdcSourceUrl,
		readBackendStatus,
		universeForkTime: zoltarUniverse?.forkTime,
		universeHasForked: zoltarUniverse?.hasForked,
		universePresentation: undefined,
		universeLabel: formatUniverseCollectionLabel([activeUniverseId]),
		universeRepBalanceAttoRep: zoltarUniverse?.totalTheoreticalSupplyAttoRep,
		isRefreshing,
		walletBootstrapComplete,
	}
	const securityPoolsViews: readonly SecurityPoolsView[] = ['browse', 'create', 'operate', 'universes']
	const derivedSecurityPoolsView = resolveFirstMatchingValue<SecurityPoolsView>(
		[
			[securityPoolAddress !== '', 'operate'],
			[securityPoolForm.marketId !== '' || marketDetails !== undefined || securityPoolResult !== undefined, 'create'],
		],
		'browse',
	)
	const activeSecurityPoolsView = resolveEnumValue<SecurityPoolsView>(securityPoolsView, derivedSecurityPoolsView, securityPoolsViews)
	const openOracleViews: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']
	const invalidRouteState = getInvalidStatoblastRouteState({
		activeSecurityPoolsView,
		openOracleView,
		resolvedRoute,
		search: parseRouteHash(window.location.hash).search,
		securityPoolsView,
		selectedPoolView,
	})
	const activeRoute = invalidRouteState.hasInvalidSecurityPoolsView || invalidRouteState.hasInvalidSelectedPoolView || invalidRouteState.hasInvalidOpenOracleView ? 'not-found' : resolvedRoute
	const showDeployTab = deploymentStatusError !== undefined || applicationDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
	const tabs: RouteTabDefinition[] = [
		...(showDeployTab ? [{ hash: statoblastRouting.getHash('deploy'), label: commonCopy.deploy, route: 'deploy' as const }] : []),
		{ hash: statoblastRouting.getHash('security-pools'), label: commonCopy.securityPools, route: 'security-pools' },
		{ hash: statoblastRouting.getHash('open-oracle'), label: statoblastAppCopy.oracleReports, route: 'open-oracle' },
	]
	const tabNavigationProps = {
		route,
		tabs,
		onRouteChange: navigate,
	}
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, openOracleViews)
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute })
	const refreshSelectedPoolData = (requestedSecurityPoolAddress?: string) => {
		const nextSecurityPoolAddress = requestedSecurityPoolAddress ?? securityPoolAddress
		if (!walletBootstrapComplete) return
		if (!nextSecurityPoolAddress.startsWith('0x') || nextSecurityPoolAddress.length !== 42) return
		setSelectedPoolRefreshNonce(currentNonce => currentNonce + 1)
		void loadSecurityPools(nextSecurityPoolAddress)
	}
	useEffect(() => {
		const securityVaultRepRefreshHash = securityVaultResult?.action === 'depositRepToVault' || securityVaultResult?.action === 'redeemRepFromVault' || (securityVaultResult?.action === 'queueWithdrawRep' && securityVaultResult.stagedExecution?.success === true) ? securityVaultResult.hash : undefined
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
		accountAddress: walletScopedAccountAddress,
		applicationDeploymentMissing,
		environmentReady: canReadOnchainData,
		activeEnvironmentNonce,
		loadOracleReport: async reportId => await loadOracleReport(reportId),
		loadSecurityPools: async requestedSecurityPoolAddress => await loadSecurityPools(requestedSecurityPoolAddress),
		navigate,
		resetSecurityPoolCreation,
		route: activeRoute,
		securityPoolAddress,
		securityPoolQuestionId,
		securityPoolResultHash: securityPoolResult?.deployPoolHash,
		selectedPoolSecurityPoolAddress: selectedPool?.securityPoolAddress,
		setForkAuctionFormSecurityPoolAddress: nextSecurityPoolAddress => setForkAuctionForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setOpenOracleFormReportId: reportId => setOpenOracleForm(current => ({ ...current, reportId })),
		setReportingFormSecurityPoolAddress: nextSecurityPoolAddress => updateReportingForm({ securityPoolAddress: nextSecurityPoolAddress }),
		setSecurityVaultFormSelectedVaultOwner: nextSelectedVaultOwner => setSecurityVaultForm(current => (current.selectedVaultOwner === nextSelectedVaultOwner ? current : { ...current, selectedVaultOwner: nextSelectedVaultOwner })),
		setSecurityVaultFormSecurityPoolAddress: nextSecurityPoolAddress => setSecurityVaultForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		setSecurityPoolFormMarketId: marketId => setSecurityPoolForm(current => (current.marketId === marketId ? current : { ...current, marketId })),
		setTradingFormSecurityPoolAddress: nextSecurityPoolAddress => setTradingForm(current => (current.securityPoolAddress === nextSecurityPoolAddress ? current : { ...current, securityPoolAddress: nextSecurityPoolAddress })),
		tradingResultHash: tradingResult?.hash,
		urlOpenOracleReportId,
		walletBootstrapComplete,
	})
	const deployRouteContentProps = buildDeploymentRouteContentProps({
		accountAddress: accountState.address,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deploymentStatuses,
		flow: deploymentFlow,
		getSections: getStatoblastDeploymentSections,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		deploymentCompleteHref: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')),
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
	})
	const createQuestionAndSecurityPool = async () => {
		if (combinedCreateStage !== undefined) return
		if (marketForm.marketType !== 'binary') return
		const submittedCombinedCreateScopeKey = combinedCreateScopeKeyRef.current
		const submittedSecurityPoolForm = securityPoolForm
		setCombinedCreateStage('creating-question')
		try {
			const result = await createMarket({ refreshQuestionList: false })
			if (result === undefined || combinedCreateScopeKeyRef.current !== submittedCombinedCreateScopeKey) return
			setSecurityPoolForm(current => ({ ...current, marketId: result.questionId }))
			setSecurityPoolQuestionId(result.questionId)
			setCombinedCreateStage('creating-pool')
			await createPool(result.questionId, submittedSecurityPoolForm)
		} finally {
			setCombinedCreateStage(undefined)
		}
	}
	useEffect(() => {
		if (
			!shouldAutoLoadUniverseDirectory({
				activeSecurityPoolsView,
				canReadOnchainData,
				currentContextKey: universeDirectoryContextKey,
				hasLoadedUniverseDirectoryPools,
				lastAutoLoadContextKey: lastUniverseDirectoryAutoLoadContextKeyRef.current,
				loadingUniverseDirectoryPools,
				securityPoolUniverseDirectoryError,
			})
		)
			return
		lastUniverseDirectoryAutoLoadContextKeyRef.current = universeDirectoryContextKey
		void loadUniverseDirectoryPools()
	}, [activeSecurityPoolsView, canReadOnchainData, hasLoadedUniverseDirectoryPools, loadingUniverseDirectoryPools, securityPoolUniverseDirectoryError, universeDirectoryContextKey])
	const securityPoolsRouteContentProps: SecurityPoolsSectionProps = {
		activeView: activeSecurityPoolsView,
		onActiveUniverseChange: setActiveUniverseId,
		loadingUniverseDirectoryPools,
		createPool: {
			accountState,
			checkingDuplicateOriginPool,
			questionAndPoolCreating: combinedCreateStage !== undefined,
			duplicateOriginPoolExists,
			onCreateQuestionAndSecurityPool: () => void createQuestionAndSecurityPool(),
			poolCreationMarketDetails,
			onCreateSecurityPool: questionIdOverride => void createPool(questionIdOverride),
			loadingMarketDetails,
			marketDetails,
			onResetSecurityPoolCreation: resetSecurityPoolCreation,
			onSecurityPoolFormChange: update => {
				setSecurityPoolForm(current => ({ ...current, ...update }))
				if (update.marketId !== undefined) setSecurityPoolQuestionId(update.marketId)
			},
			zoltarUniverseHasForked,
			securityPools,
			securityPoolCreating,
			securityPoolError,
			securityPoolForm,
			securityPoolResult,
			marketCreating,
			marketError,
			marketForm,
			marketResult,
			onCreateMarket: () => void createMarket(),
			onMarketFormChange: update => setMarketForm(current => ({ ...current, ...update })),
			onResetMarket: resetMarket,
			repPerEthPrice: uiRepPerEthPrice,
			repPerEthSource: uiRepPerEthSource,
			repPerEthSourceUrl: uiRepPerEthSourceUrl,
		},
		onActiveViewChange: view => setSecurityPoolsView(view),
		onLoadUniverseDirectoryPools: () => void loadUniverseDirectoryPools(),
		overview: {
			accountState,
			activeUniverseId,
			currentTimestamp,
			environmentRefreshKey: activeEnvironmentNonce,
			hasLoadedSecurityPoolPage,
			loadingSecurityPoolPage,
			onLoadSecurityPoolPage: (pageIndex: number, pageSize: number, requestKey: string) => void loadBrowseSecurityPoolPage(pageIndex, pageSize, requestKey),
			onCreateSecurityPool: () => setSecurityPoolsView('create'),
			securityPoolBrowseCount,
			securityPoolPage,
			securityPoolOverviewError,
			securityPools,
			repPerEthPrice,
			uiPriceOracle,
		},
		securityPools,
		securityPoolUniverseDirectoryError,
		universeDirectoryPools,
		workflow: {
			accountState,
			activeUniverseId,
			checkedSecurityPoolAddress,
			closeLiquidationModal: () => closeLiquidationModal(),
			onBrowsePools: () => setSecurityPoolsView('browse'),
			onCreatePool: () => setSecurityPoolsView('create'),
			forkAuction: {
				accountState,
				forkAuctionActiveAction,
				forkAuctionDetails,
				forkAuctionError,
				forkAuctionForm,
				forkAuctionResult,
				loadingForkAuctionDetails,
				onClaimAuctionProceeds: (securityPoolAddressOverride, selectedClaimBids, selectedRefundBids, universeIdOverride) => void claimAuctionProceeds(securityPoolAddressOverride, selectedClaimBids, selectedRefundBids, universeIdOverride),
				onCreateChildUniverse: () => void createChildUniverse(forkAuctionForm.selectedOutcome),
				onFinalizeTruthAuction: (securityPoolAddressOverride, universeIdOverride) => void finalizeTruthAuction(securityPoolAddressOverride, universeIdOverride),
				onForkAuctionFormChange: update => setForkAuctionForm(current => ({ ...current, ...update })),
				onForkUniverse: () => void forkUniverse(),
				onForkWithOwnEscalation: () => void forkWithOwnEscalation(),
				onInitiateFork: () => void initiateFork(),
				onLoadForkAuction: securityPoolAddressOverride => void loadForkAuction(securityPoolAddressOverride),
				onClaimParentEscalationDeposits: (outcome, depositIndexes) =>
					void claimParentEscalation({
						outcome,
						...(depositIndexes === undefined ? {} : { depositIndexes }),
					}),
				onMigrateUnresolvedEscalation: selectedChildOutcome => void migrateUnresolvedEscalation(selectedChildOutcome),
				onMigrateRepToZoltar: outcomes => void migrateRepToZoltar(outcomes),
				onMigrateVault: () => void migrateVault(),
				onRefundLosingBids: (securityPoolAddressOverride, selectedBids, universeIdOverride) => void refundLosingBids(securityPoolAddressOverride, selectedBids, universeIdOverride),
				onStartTruthAuction: (securityPoolAddressOverride, universeIdOverride) => void startTruthAuction(securityPoolAddressOverride, universeIdOverride),
				onSubmitBid: (securityPoolAddressOverride, universeIdOverride) => void submitBid(securityPoolAddressOverride, universeIdOverride),
				onWithdrawForkedEscalation: (outcome, parentDepositIndexes) => void settleForkedEscalation(outcome, parentDepositIndexes),
			},
			liquidationDebtEthAmount,
			maximumLiquidationDebtAttoEth,
			liquidationManagerAddress,
			liquidationFundingPreview,
			liquidationFundingPreviewError,
			liquidationModalOpen,
			liquidationSecurityPoolAddress,
			liquidationTargetVault,
			liquidationReceiverVault,
			liquidationApprovalId,
			liquidationApprovalDetails,
			liquidationApprovalError,
			liquidationReceiverVaultSummary,
			liquidationReceiverVaultSummaryError,
			liquidationReceiverVaultSummaryResolved,
			liquidationTimeoutMinutes,
			loadingLiquidationApproval,
			loadingLiquidationReceiverVaultSummary,
			onLiquidationAmountChange: setLiquidationAmount,
			onLiquidationReceiverVaultChange: setLiquidationReceiverVault,
			onLiquidationApprovalIdChange: setLiquidationApprovalId,
			onLoadLiquidationApproval: () => void loadLiquidationApproval(),
			onLoadLiquidationReceiverVaultSummary: () => void loadLiquidationReceiverVaultSummary(),
			onLiquidationTimeoutMinutesChange: setLiquidationTimeoutMinutes,
			onLoadLiquidationFundingPreview: (managerAddress: Address) => void loadLiquidationFundingPreview(managerAddress),
			onOpenLiquidationModal: (managerAddress: Address, selectedSecurityPoolAddress: Address, vaultAddress: Address, maxAmount: bigint | undefined) => openLiquidationModal(managerAddress, selectedSecurityPoolAddress, vaultAddress, maxAmount),
			onReturnToCurrentUniverse: () => setSecurityPoolsView('browse'),
			onSwitchToPoolUniverse: (universeId, selectedSecurityPoolAddress) => {
				setActiveUniverseId(universeId)
				setSecurityPoolAddress(selectedSecurityPoolAddress)
				refreshSelectedPoolData(selectedSecurityPoolAddress)
			},
			onQueueLiquidation: (managerAddress: Address, selectedSecurityPoolAddress: Address) => void queueLiquidation(managerAddress, selectedSecurityPoolAddress),
			onExecutePendingPoolOperation: (managerAddress: Address, operationId: bigint, securityPoolAddress: Address, universeId: bigint) => void executePendingPoolOperation(managerAddress, operationId, securityPoolAddress, universeId),
			loadingPoolOracleManager,
			loadingLiquidationFundingPreview,
			loadingSecurityPools,
			onLoadPoolOracleManager: (managerAddress: Address) => void loadPoolOracleManager(managerAddress),
			onRequestPoolPrice: (managerAddress: Address, securityPoolAddress: Address, reviewedRequestValueAttoEth: bigint, universeId: bigint) => void requestPoolPrice(managerAddress, securityPoolAddress, reviewedRequestValueAttoEth, universeId),
			onRefreshSelectedPoolData: refreshSelectedPoolData,
			onSelectedPoolViewChange: setSelectedPoolView,
			onViewPendingReport: reportId => {
				setOpenOracleReport(reportId.toString())
				setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
				navigate('open-oracle', new Set(['securityPool', 'securityPoolsView', 'selectedPoolView']))
				void loadOracleReport(reportId.toString())
			},
			securityPoolOverviewActiveAction,
			securityPoolOverviewError,
			securityPoolLiquidationError,
			securityPoolOverviewResult,
			poolOracleActiveAction,
			poolOracleManagerDetails,
			poolOracleManagerError,
			poolOracleManagerErrorAddress,
			poolPriceOracleResult,
			uiPriceOracle,
			selectedPoolRefreshNonce,
			universeForkTime: zoltarUniverse?.forkTime,
			selectedPoolView,
			onSecurityPoolAddressChange: value => {
				setSecurityPoolAddress(value)
			},
			repPerEthPrice: uiRepPerEthPrice,
			repPerEthSource: uiRepPerEthSource,
			repPerEthSourceUrl: uiRepPerEthSourceUrl,
			reporting: {
				accountState,
				loadingReportingDetails,
				onApproveReportingRep: () => void onApproveReportingRep(),
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
				onDepositRepToVault: () => void depositRepToVault(),
				onLoadSecurityVault: createLoadSecurityVaultHandler(loadSecurityVault),
				onRedeemFees: () => void redeemFees(),
				onRedeemRepFromVault: () => void redeemRepFromVault(),
				onSecurityVaultFormChange: update => setSecurityVaultForm(current => ({ ...current, ...update })),
				onWithdrawRep: () => void withdrawRep(),
				securityVaultActiveAction,
				securityVaultDetails,
				securityVaultError,
				securityVaultForm,
				securityVaultMissing,
				securityVaultRepApproval,
				walletRepBalanceAttoRep,
				walletRepBalanceError,
				walletRepBalanceLoading,
				securityVaultResult,
				selectedPoolStatoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
				repPerEthPrice: uiRepPerEthPrice,
				repPerEthSource: uiRepPerEthSource,
				repPerEthSourceUrl: uiRepPerEthSourceUrl,
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
				repPerEthPrice: uiRepPerEthPrice,
				repPerEthSource: uiRepPerEthSource,
				repPerEthSourceUrl: uiRepPerEthSourceUrl,
				selectedPool,
				tradingActiveAction,
				tradingDetails,
				tradingError,
				tradingForm,
				tradingForkUniverse,
				tradingResult,
			},
		},
		zoltarUniverse,
	}
	const openOracleRouteContentProps: OpenOracleSectionProps = {
		...openOracleSectionState,
		accountState,
		activeView: activeOpenOracleView,
		environmentReady: canReadOnchainData,
		environmentRefreshKey: activeEnvironmentNonce,
		onActiveViewChange: view => setOpenOracleView(view),
		onApproveToken1: amount => void approveToken1(amount),
		onApproveToken2: amount => void approveToken2(amount),
		onCancelOpenOracleWithdrawalBalanceCheck: () => cancelWithdrawalBalanceCheck(),
		onCreateOpenOracleGame: () => void createOpenOracleGame(),
		onDisputeReport: () => void disputeReport(),
		onLoadOracleReport: reportId => void loadOracleReport(reportId),
		onOpenOracleFormChange: update => setOpenOracleForm(current => ({ ...current, ...update })),
		onOpenOracleCreateFormChange: update => setOpenOracleCreateForm(current => ({ ...current, ...update })),
		onSettleReport: () => void settleReport(),
		onWithdrawOpenOracleBalance: (balance, reviewedAmount) => void withdrawBalance(balance, reviewedAmount),
		openOracleForm,
	}
	let routeSubNavigation: ComponentChildren = undefined
	if (route === 'deploy' || route === 'security-pools') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.securityPoolsViews}
				value={activeSecurityPoolsView}
				onChange={view => setSecurityPoolsView(view)}
				options={[
					{ href: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')), label: commonCopy.browsePools, value: 'browse' },
					{ href: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'create')), label: commonCopy.createPool, value: 'create' },
					{ href: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'operate')), label: commonCopy.managePool, value: 'operate' },
					{ href: buildRouteHref(statoblastRouting.getHash('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'universes')), label: commonCopy.universe, value: 'universes' },
				]}
			/>
		)
	} else if (route === 'open-oracle') {
		routeSubNavigation = <RouteSubNavigation ariaLabel={statoblastAppCopy.oracleReportViews} value={activeOpenOracleView} onChange={view => setOpenOracleView(view)} options={getOpenOracleViewOptions(statoblastRouting.getHash('open-oracle'), getRouteHashSearch())} />
	}
	const transactionRouteKey = (() => {
		if (route === 'security-pools') return `${route}:${activeSecurityPoolsView}`
		if (route === 'open-oracle') return `${route}:${activeOpenOracleView}`
		return route
	})()

	return (
		<ProtocolAppFrame
			activeUniverseId={activeUniverseId}
			currentBlockNumber={currentBlockNumber}
			currentTimestamp={currentTimestamp}
			header={
				<AppHeaderShell
					overview={<OverviewPanels {...overviewProps} applicationTitle={applicationTitle} />}
					simulationController={simulationController}
					subNavigation={routeSubNavigation}
					tabNavigation={tabNavigationProps}
					onEnvironmentChanged={refreshActiveEnvironment}
					onRefresh={refreshSimulationView}
					settingsContent={<UiPriceOracleSettings priceOracle={uiPriceOracle} onPriceOracleChange={setUiPriceOracle} />}
				/>
			}
			heading={<AppPageHeading formatDocumentTitle={formatAppDocumentTitle} pageTitle={pageTitle} />}
			notices={<AppStatusNotices errorMessages={errorMessages} readBackendMessage={readBackendMessage} readBackendStatus={readBackendStatus} simulationBootstrapError={environmentBootstrapError} showApplicationDeploymentWarning={showApplicationDeploymentWarning} zoltarUniverseError={zoltarUniverseError} />}
			routeContentDisabled={isRouteContentDisabled}
			transactionRouteKey={transactionRouteKey}
			transactionState={transactionState.value}
		>
			<AppRouteContent deploy={deployRouteContentProps} openOracle={openOracleRouteContentProps} readBackendMessage={readBackendMessage} route={activeRoute} securityPools={securityPoolsRouteContentProps} />
		</ProtocolAppFrame>
	)
}
