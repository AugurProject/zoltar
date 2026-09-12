import { useEffect, useRef, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { useForkAuctionOperations } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionOperations.js'
import { useMarketCreation } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useMarketCreation.js'
import { usePriceOracleManager } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/usePriceOracleManager.js'
import { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import { useSecurityPoolCreation } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolCreation.js'
import { useSecurityPoolsOverview } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import { useSecurityVaultOperations } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import { applyReportingFormUpdate } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingForm.js'
import { getCurrentPoolOracleManagerDetails } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolWorkflow.js'
import { isUiOpenOraclePriceUsed, resolveUiRepPerEthPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { shouldAutoLoadUniverseDirectory } from '../lib/universeDirectory.js'
import { readUiPriceOracle } from '../UiPriceOracleSettings.js'
import type { ReportingFormState, WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { SecurityPoolsSectionProps, SecurityPoolsView } from '@zoltar/ui-statoblast-shared/features/types.js'

export function useSecurityPoolsRoute({
	accountState,
	activeEnvironmentNonce,
	activeUniverseId,
	canReadOnchainData,
	currentTimestamp,
	deploymentStatuses,
	marketCreation,
	onViewPendingReport,
	priceOracleManager,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	route,
	securityPoolAddress,
	securityPoolsView,
	selectedPoolRefreshNonce,
	selectedPoolView,
	setActiveUniverseId,
	setSecurityPoolAddress,
	setSecurityPoolQuestionId,
	setSecurityPoolsView,
	setSelectedPoolRefreshNonce,
	setSelectedPoolView,
	uiPriceOracle,
	walletBootstrapComplete,
	walletScopedAccountAddress,
	walletScopedHookConfig,
}: {
	accountState: SecurityPoolsSectionProps['createPool']['accountState']
	activeEnvironmentNonce: number
	activeUniverseId: bigint
	canReadOnchainData: boolean
	currentTimestamp: bigint | undefined
	deploymentStatuses: Parameters<typeof useSecurityPoolCreation>[0]['deploymentStatuses']
	marketCreation: ReturnType<typeof useMarketCreation>
	onViewPendingReport: (reportId: bigint) => void
	priceOracleManager: ReturnType<typeof usePriceOracleManager>
	repPerEthPrice: bigint | undefined
	repPerEthSource: SecurityPoolsSectionProps['createPool']['repPerEthSource']
	repPerEthSourceUrl: string | undefined
	route: string
	securityPoolAddress: string
	securityPoolsView: string
	selectedPoolRefreshNonce: number
	selectedPoolView: SecurityPoolsSectionProps['workflow']['selectedPoolView']
	setActiveUniverseId: (universeId: bigint) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
	setSecurityPoolQuestionId: (questionId: string) => void
	setSecurityPoolsView: (view: SecurityPoolsView) => void
	setSelectedPoolRefreshNonce: (updateNonce: (currentNonce: number) => number) => void
	setSelectedPoolView: SecurityPoolsSectionProps['workflow']['onSelectedPoolViewChange']
	uiPriceOracle: ReturnType<typeof readUiPriceOracle>
	walletBootstrapComplete: boolean
	walletScopedAccountAddress: Address | undefined
	walletScopedHookConfig: WriteOperationsParameters
}) {
	const [combinedCreateStage, setCombinedCreateStage] = useState<'creating-pool' | 'creating-question' | undefined>(undefined)
	const { createMarket, loadZoltarForkAccess, marketCreating, marketError, marketForm, marketResult, resetMarket, setMarketForm, zoltarUniverse } = marketCreation
	const { executePendingPoolOperation, loadingPoolOracleManager, loadPoolOracleManager, poolOracleActiveAction, poolOracleManagerDetails, poolOracleManagerError, poolOracleManagerErrorAddress, poolPriceOracleResult, requestPoolPrice } = priceOracleManager
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
		withdrawAuctionRefund,
	} = useForkAuctionOperations({ ...walletScopedHookConfig, selectedSecurityPoolAddress: securityPoolAddress })
	const combinedCreateScopeKeyRef = useRef('')
	const lastUniverseDirectoryAutoLoadContextKeyRef = useRef<string | undefined>(undefined)
	combinedCreateScopeKeyRef.current = `${walletScopedAccountAddress ?? ''}:${activeUniverseId.toString()}:${activeEnvironmentNonce}:${deploymentStatuses.map(status => `${status.id}:${status.deployed ? '1' : '0'}`).join(',')}`
	const universeDirectoryContextKey = `${activeEnvironmentNonce}:${walletScopedAccountAddress ?? ''}:${activeUniverseId.toString()}`
	const lastSecurityVaultRepRefreshHash = useRef<string | undefined>(undefined)
	const lastStagedVaultRepRefreshHash = useRef<string | undefined>(undefined)
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
	const securityPoolsViews: readonly SecurityPoolsView[] = ['browse', 'create', 'operate', 'universes']
	const derivedSecurityPoolsView = resolveFirstMatchingValue<SecurityPoolsView>(
		[
			[securityPoolAddress !== '', 'operate'],
			[securityPoolForm.marketId !== '' || marketDetails !== undefined || securityPoolResult !== undefined, 'create'],
		],
		'browse',
	)
	const activeSecurityPoolsView = resolveEnumValue<SecurityPoolsView>(securityPoolsView, derivedSecurityPoolsView, securityPoolsViews)
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
				onWithdrawAuctionRefund: (securityPoolAddressOverride, universeIdOverride) => void withdrawAuctionRefund(securityPoolAddressOverride, universeIdOverride),
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
			onViewPendingReport,
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
				onLoadSecurityVault: (vaultAddress?: string) => {
					void loadSecurityVault(vaultAddress)
				},
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
	return {
		activeSecurityPoolsView,
		loadSecurityPools,
		resetSecurityPoolCreation,
		securityPoolResult,
		securityPoolsRouteContentProps,
		selectedPool,
		setForkAuctionForm,
		setSecurityPoolForm,
		setSecurityVaultForm,
		setTradingForm,
		tradingResult,
		uiRepPerEthPrice,
		uiRepPerEthSource,
		uiRepPerEthSourceUrl,
		uiUsesOpenOraclePrice,
		updateReportingForm,
	}
}
