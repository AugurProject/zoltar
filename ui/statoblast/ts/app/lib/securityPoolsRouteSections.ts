import type { useForkAuctionOperations } from '@zoltar/ui-statoblast-shared/features/truth-auctions/hooks/useForkAuctionOperations.js'
import type { useOpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOraclePriceCoordinator.js'
import type { useReportingOperations } from '@zoltar/ui-statoblast-shared/features/reporting/hooks/useReportingOperations.js'
import type { useSecurityPoolsOverview } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityPoolsOverview.js'
import type { useSecurityVaultOperations } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import type { useTradingOperations } from '@zoltar/ui-statoblast-shared/features/markets/hooks/useTradingOperations.js'
import type { ForkAuctionRouteContentProps, RepPerEthPriceProps, SecurityVaultRouteContentProps, TradingRouteContentProps } from '@zoltar/ui-statoblast-shared/features/types.js'
import type { ReportingRouteContentProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import type { AccountState, ReportingFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'

// Each builder passes its operations hook result through and adds only the handlers and shared values the section props name differently.

type SectionAccount = { accountState: AccountState }

export function buildSecurityVaultSectionProps(vault: ReturnType<typeof useSecurityVaultOperations>, shared: SectionAccount & RepPerEthPriceProps, selectedPool: ListedSecurityPool | undefined, setVaultAddress: (address: string | undefined) => void): SecurityVaultRouteContentProps {
	return {
		...vault,
		...shared,
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
		selectedPoolStatoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		securityPoolVaults: selectedPool?.vaults,
	}
}

export function buildReportingSectionProps(reporting: ReturnType<typeof useReportingOperations>, shared: SectionAccount, updateReportingForm: (update: Partial<ReportingFormState>) => void): ReportingRouteContentProps {
	return {
		...reporting,
		...shared,
		onLoadReporting: reporting.loadReporting,
		onReportingFormChange: updateReportingForm,
		onWithdrawEscalation: reporting.withdrawEscalation,
	}
}

export function buildTradingSectionProps(trading: ReturnType<typeof useTradingOperations>, shared: SectionAccount & RepPerEthPriceProps, selectedPool: ListedSecurityPool | undefined): TradingRouteContentProps {
	return {
		...trading,
		...shared,
		onCreateCompleteSet: trading.createCompleteSet,
		onMigrateShares: trading.migrateShares,
		onRedeemCompleteSet: trading.redeemCompleteSet,
		onRedeemShares: trading.redeemShares,
		onTradingFormChange: update => trading.setTradingForm(current => ({ ...current, ...update })),
		selectedPool,
	}
}

export function buildForkAuctionSectionProps(forkAuction: ReturnType<typeof useForkAuctionOperations>, shared: SectionAccount): ForkAuctionRouteContentProps {
	return {
		...forkAuction,
		...shared,
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

/** The liquidation modal and pool price oracle state shared by the selected pool workflow. */
export function buildLiquidationSectionProps(overview: ReturnType<typeof useSecurityPoolsOverview>, priceCoordinator: ReturnType<typeof useOpenOraclePriceCoordinator>) {
	return {
		...overview,
		...priceCoordinator,
		onLiquidationAmountChange: overview.setLiquidationAmount,
		onLiquidationReceiverVaultChange: overview.setLiquidationReceiverVault,
		onLiquidationApprovalIdChange: overview.setLiquidationApprovalId,
		onLoadLiquidationApproval: overview.loadLiquidationApproval,
		onLoadLiquidationReceiverVaultSummary: overview.loadLiquidationReceiverVaultSummary,
		onLiquidationTimeoutMinutesChange: overview.setLiquidationTimeoutMinutes,
		onLoadLiquidationFundingPreview: overview.loadLiquidationFundingPreview,
		onOpenLiquidationModal: overview.openLiquidationModal,
		onQueueLiquidation: overview.queueLiquidation,
		onExecutePendingPoolOperation: priceCoordinator.executePendingPoolOperation,
		onLoadPoolOracleManager: priceCoordinator.loadPoolOracleManager,
		onRequestPoolPrice: priceCoordinator.requestPoolPrice,
	}
}
