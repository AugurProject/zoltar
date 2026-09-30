import type { useForkAuctionOperations } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionOperations.js'
import type { useOpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOraclePriceCoordinator.js'
import type { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import type { useSecurityPoolCreation } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolCreation.js'
import type { useSecurityPoolsOverview } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { useSecurityVaultOperations } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import type { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import type { ForkAuctionRouteContentProps, RepPerEthPriceProps, SecurityPoolsSectionProps, SecurityPoolWorkflowRouteContentProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { ReportingRouteContentProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { AccountState, ReportingFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'

// Each builder names every section prop it sets instead of spreading a hook result, so undeclared hook fields never reach a section and a renamed prop fails to compile.

/** The hook fields a builder reads: those sharing a section prop name plus the named handlers. */
type SectionSource<Hook, Props, Handler extends keyof Hook> = Pick<Hook, Extract<keyof Hook, keyof Props> | Handler>

type SectionAccount = { accountState: AccountState }

type VaultOperations = ReturnType<typeof useSecurityVaultOperations>
type VaultSource = SectionSource<VaultOperations, SecurityVaultRouteContentProps, 'adjustBackingFactor' | 'approveRep' | 'depositRepToVault' | 'loadSecurityVault' | 'redeemFees' | 'redeemRepFromVault' | 'setSecurityVaultForm' | 'withdrawRep'>

export function buildSecurityVaultSectionProps(vault: VaultSource, shared: SectionAccount & RepPerEthPriceProps, selectedPool: ListedSecurityPool | undefined, setVaultAddress: (address: string | undefined) => void): SecurityVaultRouteContentProps {
	return {
		accountState: shared.accountState,
		loadingSecurityVault: vault.loadingSecurityVault,
		onApproveRep: vault.approveRep,
		onSetVaultUnderwritingLimit: vault.adjustBackingFactor,
		onDepositRepToVault: vault.depositRepToVault,
		onLoadSecurityVault: vault.loadSecurityVault,
		onRedeemFees: vault.redeemFees,
		onRedeemRepFromVault: vault.redeemRepFromVault,
		onSecurityVaultFormChange: update => {
			if (update.selectedVaultOwner !== undefined && (update.selectedVaultOwner.trim() === '' || isHexAddressInput(update.selectedVaultOwner))) setVaultAddress(update.selectedVaultOwner)
			vault.setSecurityVaultForm(current => ({ ...current, ...update }))
		},
		onWithdrawRep: vault.withdrawRep,
		repPerEthPrice: shared.repPerEthPrice,
		repPerEthSource: shared.repPerEthSource,
		repPerEthSourceUrl: shared.repPerEthSourceUrl,
		securityPoolVaults: selectedPool?.vaults,
		securityVaultActiveAction: vault.securityVaultActiveAction,
		securityVaultDetails: vault.securityVaultDetails,
		securityVaultError: vault.securityVaultError,
		securityVaultForm: vault.securityVaultForm,
		securityVaultMissing: vault.securityVaultMissing,
		securityVaultQueuedOperations: vault.securityVaultQueuedOperations,
		securityVaultRepApproval: vault.securityVaultRepApproval,
		securityVaultResult: vault.securityVaultResult,
		selectedPoolStatoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		walletRepBalanceAttoRep: vault.walletRepBalanceAttoRep,
		walletRepBalanceError: vault.walletRepBalanceError,
		walletRepBalanceLoading: vault.walletRepBalanceLoading,
	}
}

type ReportingOperations = ReturnType<typeof useReportingOperations>
type ReportingSource = SectionSource<ReportingOperations, ReportingRouteContentProps, 'loadReporting' | 'withdrawEscalation'>

export function buildReportingSectionProps(reporting: ReportingSource, shared: SectionAccount, updateReportingForm: (update: Partial<ReportingFormState>) => void): ReportingRouteContentProps {
	return {
		accountState: shared.accountState,
		loadingReportingDetails: reporting.loadingReportingDetails,
		onApproveReportingRep: reporting.onApproveReportingRep,
		onLoadReporting: reporting.loadReporting,
		onReportOutcome: reporting.onReportOutcome,
		onReportingFormChange: updateReportingForm,
		onWithdrawEscalation: reporting.withdrawEscalation,
		reportingActiveAction: reporting.reportingActiveAction,
		reportingDetails: reporting.reportingDetails,
		reportingError: reporting.reportingError,
		reportingForm: reporting.reportingForm,
		reportingResult: reporting.reportingResult,
	}
}

type TradingOperations = ReturnType<typeof useTradingOperations>
type TradingSource = SectionSource<TradingOperations, TradingRouteContentProps, 'createCompleteSet' | 'migrateShares' | 'redeemCompleteSet' | 'redeemShares' | 'setTradingForm'>

export function buildTradingSectionProps(trading: TradingSource, shared: SectionAccount & RepPerEthPriceProps, selectedPool: ListedSecurityPool | undefined): TradingRouteContentProps {
	return {
		accountState: shared.accountState,
		loadingTradingDetails: trading.loadingTradingDetails,
		loadingTradingForkUniverse: trading.loadingTradingForkUniverse,
		onCreateCompleteSet: trading.createCompleteSet,
		onMigrateShares: trading.migrateShares,
		onRedeemCompleteSet: trading.redeemCompleteSet,
		onRedeemShares: trading.redeemShares,
		onTradingFormChange: update => trading.setTradingForm(current => ({ ...current, ...update })),
		repPerEthPrice: shared.repPerEthPrice,
		repPerEthSource: shared.repPerEthSource,
		repPerEthSourceUrl: shared.repPerEthSourceUrl,
		selectedPool,
		tradingActiveAction: trading.tradingActiveAction,
		tradingDetails: trading.tradingDetails,
		tradingError: trading.tradingError,
		tradingForkUniverse: trading.tradingForkUniverse,
		tradingForm: trading.tradingForm,
		tradingResult: trading.tradingResult,
	}
}

type ForkAuctionOperations = ReturnType<typeof useForkAuctionOperations>
type ForkAuctionSource = SectionSource<
	ForkAuctionOperations,
	ForkAuctionRouteContentProps,
	| 'claimAuctionProceeds'
	| 'claimParentEscalation'
	| 'createChildUniverse'
	| 'finalizeTruthAuction'
	| 'forkUniverse'
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'loadForkAuction'
	| 'migrateRepToZoltar'
	| 'migrateUnresolvedEscalation'
	| 'migrateVault'
	| 'refundLosingBids'
	| 'setForkAuctionForm'
	| 'settleForkedEscalation'
	| 'startTruthAuction'
	| 'submitBid'
	| 'withdrawAuctionRefund'
>

export function buildForkAuctionSectionProps(forkAuction: ForkAuctionSource, shared: SectionAccount): ForkAuctionRouteContentProps {
	return {
		accountState: shared.accountState,
		forkAuctionActiveAction: forkAuction.forkAuctionActiveAction,
		forkAuctionDetails: forkAuction.forkAuctionDetails,
		forkAuctionError: forkAuction.forkAuctionError,
		forkAuctionForm: forkAuction.forkAuctionForm,
		forkAuctionResult: forkAuction.forkAuctionResult,
		loadingForkAuctionDetails: forkAuction.loadingForkAuctionDetails,
		onClaimAuctionProceeds: forkAuction.claimAuctionProceeds,
		onCreateChildUniverse: () => void forkAuction.createChildUniverse(forkAuction.forkAuctionForm.selectedOutcome),
		onFinalizeTruthAuction: forkAuction.finalizeTruthAuction,
		onForkAuctionFormChange: update => forkAuction.setForkAuctionForm(current => ({ ...current, ...update })),
		onForkUniverse: forkAuction.forkUniverse,
		onForkWithOwnEscalation: forkAuction.forkWithOwnEscalation,
		onInitiateFork: forkAuction.initiateFork,
		onLoadForkAuction: forkAuction.loadForkAuction,
		onClaimParentEscalationDeposits: (outcome, depositIndexes) => void forkAuction.claimParentEscalation({ outcome, ...(depositIndexes === undefined ? {} : { depositIndexes }) }),
		onMigrateUnresolvedEscalation: forkAuction.migrateUnresolvedEscalation,
		onMigrateRepToZoltar: forkAuction.migrateRepToZoltar,
		onMigrateVault: forkAuction.migrateVault,
		onRefundLosingBids: forkAuction.refundLosingBids,
		onWithdrawAuctionRefund: forkAuction.withdrawAuctionRefund,
		onStartTruthAuction: forkAuction.startTruthAuction,
		onSubmitBid: forkAuction.submitBid,
		onWithdrawForkedEscalation: forkAuction.settleForkedEscalation,
	}
}

type CreatePoolProps = SecurityPoolsSectionProps['createPool']
type PoolCreation = ReturnType<typeof useSecurityPoolCreation>
type PoolCreationSource = SectionSource<PoolCreation, CreatePoolProps, 'dismissSecurityPoolReview' | 'resetSecurityPoolCreation' | 'retryExistingQuestionCheck'>

/** The Create Pool props owned by the pool creation hook; the route adds the question, market, and pool list props. */
export function buildPoolCreationSectionProps(poolCreation: PoolCreationSource) {
	return {
		checkingDuplicateOriginPool: poolCreation.checkingDuplicateOriginPool,
		duplicateOriginPoolAddress: poolCreation.duplicateOriginPoolAddress,
		duplicateOriginPoolExists: poolCreation.duplicateOriginPoolExists,
		existingQuestionCheck: poolCreation.existingQuestionCheck,
		loadingMarketDetails: poolCreation.loadingMarketDetails,
		marketDetails: poolCreation.marketDetails,
		onDismissSecurityPoolReview: poolCreation.dismissSecurityPoolReview,
		onResetSecurityPoolCreation: poolCreation.resetSecurityPoolCreation,
		onRetryExistingQuestionCheck: poolCreation.retryExistingQuestionCheck,
		poolCreationMarketDetails: poolCreation.poolCreationMarketDetails,
		securityPoolCreating: poolCreation.securityPoolCreating,
		securityPoolError: poolCreation.securityPoolError,
		securityPoolForm: poolCreation.securityPoolForm,
		securityPoolResult: poolCreation.securityPoolResult,
		securityPoolReviewAbortSignal: poolCreation.securityPoolReviewAbortSignal,
	} satisfies Partial<CreatePoolProps>
}

type Overview = ReturnType<typeof useSecurityPoolsOverview>
type OverviewSource = SectionSource<
	Overview,
	SecurityPoolWorkflowRouteContentProps,
	'loadLiquidationApproval' | 'loadLiquidationFundingPreview' | 'loadLiquidationReceiverVaultSummary' | 'openLiquidationModal' | 'queueLiquidation' | 'setLiquidationAmount' | 'setLiquidationApprovalId' | 'setLiquidationReceiverVault' | 'setLiquidationTimeoutMinutes'
>
type PriceCoordinator = ReturnType<typeof useOpenOraclePriceCoordinator>
type PriceCoordinatorSource = SectionSource<PriceCoordinator, SecurityPoolWorkflowRouteContentProps, 'executePendingPoolOperation' | 'loadPoolOracleManager' | 'requestPoolPrice'>

/** The liquidation modal and pool price oracle state shared by the selected pool workflow; the route supplies the pool list and remaining workflow props. */
export function buildLiquidationSectionProps(overview: OverviewSource, priceCoordinator: PriceCoordinatorSource) {
	return {
		checkedSecurityPoolAddress: overview.checkedSecurityPoolAddress,
		closeLiquidationModal: overview.closeLiquidationModal,
		liquidationApprovalDetails: overview.liquidationApprovalDetails,
		liquidationApprovalError: overview.liquidationApprovalError,
		liquidationApprovalId: overview.liquidationApprovalId,
		liquidationDebtEthAmount: overview.liquidationDebtEthAmount,
		liquidationFundingPreview: overview.liquidationFundingPreview,
		liquidationFundingPreviewError: overview.liquidationFundingPreviewError,
		liquidationManagerAddress: overview.liquidationManagerAddress,
		liquidationModalOpen: overview.liquidationModalOpen,
		liquidationReceiverVault: overview.liquidationReceiverVault,
		liquidationReceiverVaultSummary: overview.liquidationReceiverVaultSummary,
		liquidationReceiverVaultSummaryError: overview.liquidationReceiverVaultSummaryError,
		liquidationReceiverVaultSummaryResolved: overview.liquidationReceiverVaultSummaryResolved,
		liquidationSecurityPoolAddress: overview.liquidationSecurityPoolAddress,
		liquidationTargetVault: overview.liquidationTargetVault,
		liquidationTimeoutMinutes: overview.liquidationTimeoutMinutes,
		loadingLiquidationApproval: overview.loadingLiquidationApproval,
		loadingLiquidationFundingPreview: overview.loadingLiquidationFundingPreview,
		loadingLiquidationReceiverVaultSummary: overview.loadingLiquidationReceiverVaultSummary,
		loadingPoolOracleManager: priceCoordinator.loadingPoolOracleManager,
		loadingSecurityPools: overview.loadingSecurityPools,
		maximumLiquidationDebtAttoEth: overview.maximumLiquidationDebtAttoEth,
		onExecutePendingPoolOperation: priceCoordinator.executePendingPoolOperation,
		onLiquidationAmountChange: overview.setLiquidationAmount,
		onLiquidationApprovalIdChange: overview.setLiquidationApprovalId,
		onLiquidationReceiverVaultChange: overview.setLiquidationReceiverVault,
		onLiquidationTimeoutMinutesChange: overview.setLiquidationTimeoutMinutes,
		onLoadLiquidationApproval: overview.loadLiquidationApproval,
		onLoadLiquidationFundingPreview: overview.loadLiquidationFundingPreview,
		onLoadLiquidationReceiverVaultSummary: overview.loadLiquidationReceiverVaultSummary,
		onLoadPoolOracleManager: priceCoordinator.loadPoolOracleManager,
		onOpenLiquidationModal: overview.openLiquidationModal,
		onQueueLiquidation: overview.queueLiquidation,
		onRequestPoolPrice: priceCoordinator.requestPoolPrice,
		poolOracleActiveAction: priceCoordinator.poolOracleActiveAction,
		poolOracleManagerDetails: priceCoordinator.poolOracleManagerDetails,
		poolOracleManagerError: priceCoordinator.poolOracleManagerError,
		poolOracleManagerErrorAddress: priceCoordinator.poolOracleManagerErrorAddress,
		poolPriceOracleResult: priceCoordinator.poolPriceOracleResult,
		securityPoolLiquidationError: overview.securityPoolLiquidationError,
		securityPoolOverviewActiveAction: overview.securityPoolOverviewActiveAction,
		securityPoolOverviewError: overview.securityPoolOverviewError,
		securityPoolOverviewResult: overview.securityPoolOverviewResult,
		securityPoolsFreshness: overview.securityPoolsFreshness,
	} satisfies Partial<SecurityPoolWorkflowRouteContentProps>
}
