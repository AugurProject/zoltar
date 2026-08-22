import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useSignal } from '@preact/signals'
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
import { getDeploymentSections } from '@zoltar/ui-zoltar/features/deployment/lib/deployment.js'
import { formatUniverseCollectionLabel } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMarketCreation } from '../features/markets/hooks/useMarketCreation.js'
import { useOnchainState } from '@zoltar/ui-core-shared/app/hooks/useOnchainState.js'
import { buildProtocolHookConfigs, useProtocolAppRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolAppRuntime.js'
import { useOpenOracleOperations } from '@zoltar/ui-zoltar/features/open-oracle/hooks/useOpenOracleOperations.js'
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
import { getWalletScopedAccountAddress, isSupportedAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { applyReportingFormUpdate } from '@zoltar/ui-zoltar/features/reporting/lib/reportingForm.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/lib/routing.js'
import { writeOpenOracleViewQueryParam, writeSecurityPoolsViewQueryParam } from '@zoltar/ui-core-shared/lib/urlParams.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/lib/viewState.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import type { ReportingFormState } from '@zoltar/ui-zoltar/types/app.js'
import type { DeploymentRouteContentProps, OpenOracleSectionProps, OpenOracleView } from '@zoltar/ui-zoltar/features/types.js'
import type { Route } from '../types/app.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '../features/types.js'
import type { RouteTabDefinition } from '@zoltar/ui-core-shared/types/components.js'

const getRouteHashForRoute = (route: 'deploy' | 'open-oracle' | 'security-pools') => {
	if (route === 'deploy') return '#/deploy'
	if (route === 'open-oracle') return '#/open-oracle'
	return '#/security-pools'
}

export function App() {
	const deployNextMissingPending = useSignal(false)
	const [selectedPoolRefreshNonce, setSelectedPoolRefreshNonce] = useState(0)
	const { activeEnvironmentNonce, followSupportedWalletNetwork, setActiveEnvironmentNonce, supportedNetworkChangeCoordinator, transactionTray } = useProtocolAppRuntime({
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
	const activeRoute = resolveEnumValue<Route>(route, 'not-found', ['deploy', 'security-pools', 'open-oracle', 'not-found'])
	const {
		accountState,
		applicationDeploymentComplete,
		changeWallet,
		chainClockError,
		connectWallet,
		currentBlockNumber,
		currentTimestamp,
		deploymentStatusError,
		deploymentStatuses,
		environmentBootstrapError,
		environmentReady,
		errorMessages: onchainErrorMessages,
		readBackendMessage,
		readBackendValidated,
		readBackendStatus,
		hasLoadedDeploymentStatuses,
		isConnectingWallet,
		isManagingWallet,
		isLoadingDeploymentStatuses,
		isRefreshing,
		refreshState,
		setDeploymentStatuses,
		disconnectWallet,
		switchNetwork,
		walletBootstrapComplete,
	} = useOnchainState(
		{
			activeEnvironmentNonce,
			enableChainClock: route !== 'deploy',
			...(followSupportedWalletNetwork ? { onSupportedNetworkChange: () => void supportedNetworkChangeCoordinator.handleSupportedNetworkChange() } : {}),
		},
		onchainStateDependencies,
	)
	const readBackendReady = readBackendValidated && readBackendMessage === undefined
	const canReadOnchainData = environmentReady && readBackendReady && hasLoadedDeploymentStatuses
	const isOnActiveAppChain = isSupportedAppChain(accountState.chainId)
	const walletScopedAccountAddress = getWalletScopedAccountAddress(accountState.address, accountState.chainId)
	const { baseHookConfig, walletScopedHookConfig } = buildProtocolHookConfigs({ accountAddress: accountState.address, walletScopedAccountAddress, refreshState, transactionTray })
	const { busyStepId, deployNextMissing, deployStep, errorMessage: deploymentErrorMessage } = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, setDeploymentStatuses })
	const { hasLoadedZoltarQuestions, loadZoltarForkAccess, loadingZoltarForkAccess, loadingZoltarQuestions, loadZoltarQuestions, zoltarQuestions, zoltarUniverse, zoltarUniverseError } = useMarketCreation({
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
	const {
		approveToken1,
		approveToken2,
		cancelWithdrawalBalanceCheck,
		createOpenOracleGame,
		disputeReport,
		loadOracleReport,
		loadingOpenOracleCreate,
		openOracleActiveAction,
		openOracleActiveWithdrawalBalance,
		openOracleCreateForm,
		openOracleCreateFieldErrors,
		openOracleDisputeSubmission,
		openOracleError,
		openOracleForm,
		openOracleReportLookupState,
		openOracleTokenAccessState,
		openOracleReportDetails,
		openOracleResult,
		openOracleWithdrawalBalanceChecking,
		openOracleWithdrawalReviewMessage,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		openOracleWithdrawableBalancesLoading,
		setOpenOracleCreateForm,
		setOpenOracleForm,
		settleReport,
		withdrawBalance,
	} = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: route === 'open-oracle' && canReadOnchainData,
		onReportSettled: async () => {
			if (poolOracleManagerDetails?.managerAddress !== undefined) await loadPoolOracleManager(poolOracleManagerDetails.managerAddress)
		},
	})
	const { loadingReportingDetails, loadReporting, onReportOutcome, reportingActiveAction, reportingDetails, reportingError, reportingForm, reportingResult, setReportingForm, withdrawEscalation } = useReportingOperations({ ...walletScopedHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const updateReportingForm = (update: Partial<ReportingFormState>) => {
		setReportingForm((current: ReportingFormState) => applyReportingFormUpdate(current, update))
	}
	const {
		checkedSecurityPoolAddress,
		closeLiquidationModal,
		hasLoadedSecurityPoolPage,
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
		loadBrowseSecurityPoolPage,
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
	const deploymentSections = getDeploymentSections(deploymentStatuses)
	const errorMessages = [deploymentErrorMessage, ...onchainErrorMessages.filter(message => message !== deploymentStatusError), chainClockError].filter((message): message is string => message !== undefined)
	const applicationDeploymentMissing = canReadOnchainData && applicationDeploymentComplete === false
	const showApplicationDeploymentWarning = applicationDeploymentMissing
	const disableRouteContent = route !== 'deploy' && (!readBackendReady || applicationDeploymentMissing)
	const isRouteContentDisabled = disableRouteContent
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
		repPerEthPrice,
		repPerEthSource,
		repPerEthSourceUrl,
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
	const tabs: RouteTabDefinition[] = [
		{ hash: getRouteHashForRoute('security-pools'), label: commonCopy.securityPools, route: 'security-pools' },
		{ hash: getRouteHashForRoute('open-oracle'), label: appCopy.oracleReports, route: 'open-oracle' },
		{ hash: getRouteHashForRoute('deploy'), label: commonCopy.deploy, route: 'deploy' },
	]
	const tabNavigationProps = {
		route,
		tabs,
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
	const pageTitle = getAppPageTitle({ activeOpenOracleView, activeSecurityPoolsView, route: activeRoute })
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
	const deployRouteContentProps: DeploymentRouteContentProps = {
		accountAddress: accountState.address,
		busyStepId,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deployNextMissingPending: deployNextMissingPending.value,
		deploymentSections,
		deploymentStatuses,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		deploymentCompleteHref: buildRouteHref(getRouteHashForRoute('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')),
		onDeploy: deployStep,
		onDeployNextMissing: () => void onDeployNextMissing(),
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
	}
	const securityPoolsRouteContentProps: SecurityPoolsSectionProps = {
		activeView: activeSecurityPoolsView,
		onActiveUniverseChange: setActiveUniverseId,
		createPool: {
			accountState,
			availableQuestionsContextKey: `${activeEnvironmentNonce}:${activeUniverseId.toString()}`,
			availableQuestions: zoltarQuestions,
			checkingDuplicateOriginPool,
			duplicateOriginPoolExists,
			hasLoadedAvailableQuestions: hasLoadedZoltarQuestions,
			loadingAvailableQuestions: loadingZoltarQuestions,
			poolCreationMarketDetails,
			onCreateSecurityPool: () => void createPool(),
			onLoadAvailableQuestions: loadZoltarQuestions,
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
			repPerEthPrice,
			repPerEthSource,
			repPerEthSourceUrl,
		},
		onActiveViewChange: view => setSecurityPoolsView(view),
		overview: {
			accountState,
			activeUniverseId,
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
		},
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
		accountState,
		activeView: activeOpenOracleView,
		environmentReady: canReadOnchainData,
		environmentRefreshKey: activeEnvironmentNonce,
		loadingOpenOracleCreate,
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
		openOracleActiveAction,
		openOracleActiveWithdrawalBalance,
		openOracleCreateForm,
		openOracleCreateFieldErrors,
		openOracleError,
		openOracleDisputeSubmission,
		openOracleForm,
		openOracleReportLookupState,
		openOracleTokenAccessState,
		openOracleReportDetails,
		openOracleResult,
		openOracleWithdrawalBalanceChecking,
		openOracleWithdrawalReviewMessage,
		openOracleWithdrawableBalances,
		openOracleWithdrawableBalancesError,
		openOracleWithdrawableBalancesLoading,
	}
	let routeSubNavigation: ComponentChildren = undefined
	if (route === 'security-pools') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.securityPoolsViews}
				value={activeSecurityPoolsView}
				onChange={view => setSecurityPoolsView(view)}
				options={[
					{ href: buildRouteHref(getRouteHashForRoute('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'browse')), label: commonCopy.browsePools, value: 'browse' },
					{ href: buildRouteHref(getRouteHashForRoute('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'create')), label: commonCopy.createPool, value: 'create' },
					{ href: buildRouteHref(getRouteHashForRoute('security-pools'), writeSecurityPoolsViewQueryParam(getRouteHashSearch(), 'operate')), label: commonCopy.managePool, value: 'operate' },
				]}
			/>
		)
	} else if (route === 'open-oracle') {
		routeSubNavigation = (
			<RouteSubNavigation
				ariaLabel={appCopy.oracleReportViews}
				value={activeOpenOracleView}
				onChange={view => setOpenOracleView(view)}
				options={[
					{ href: buildRouteHref(getRouteHashForRoute('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'browse')), label: appCopy.browseReports, value: 'browse' },
					{ href: buildRouteHref(getRouteHashForRoute('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'create')), label: appCopy.createReport, value: 'create' },
					{ href: buildRouteHref(getRouteHashForRoute('open-oracle'), writeOpenOracleViewQueryParam(getRouteHashSearch(), 'selected-report')), label: appCopy.viewReport, value: 'selected-report' },
				]}
			/>
		)
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
			header={<AppHeaderShell overview={<OverviewPanels {...overviewProps} applicationTitle={applicationTitle} />} simulationController={simulationController} subNavigation={routeSubNavigation} tabNavigation={tabNavigationProps} onEnvironmentChanged={refreshActiveEnvironment} onRefresh={refreshSimulationView} />}
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
