import { describe, expect, test } from 'bun:test'
import { getDefaultForkAuctionFormState, getDefaultSecurityPoolFormState, getDefaultSecurityVaultFormState, getDefaultTradingFormState } from '@zoltar/ui-statoblast-shared/features/markets/lib/marketForm.js'
import { getDefaultReportingFormState } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingForm.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { buildForkAuctionSectionProps, buildLiquidationSectionProps, buildPoolCreationSectionProps, buildReportingSectionProps, buildSecurityVaultSectionProps, buildTradingSectionProps } from '../../app/lib/securityPoolsRouteSections.js'

const noop = () => undefined
const asyncNoop = async () => undefined
const accountState = { address: undefined, chainId: '0x1', ethBalanceAttoEth: 1n, wethBalanceAttoEth: 2n }
const repPrice = { repPerEthPrice: 3n, repPerEthSource: undefined, repPerEthSourceUrl: 'https://example.invalid/rep' }
// Hook results carry feedback, loaders, and caches that no section declares; none of them may reach a section.
const undeclaredHookFields = { loadMarketById: noop, poolOracleFeedback: 'pool oracle feedback', securityPoolsLoadError: 'load error', securityVaultFeedback: 'vault feedback', universeDirectoryPools: [] }

function sortedKeys(value: object) {
	return Object.keys(value).sort()
}

function expectPassedThrough(props: Record<string, unknown>, source: Record<string, unknown>) {
	for (const [key, value] of Object.entries(props)) {
		if (key in source) expect(value).toBe(source[key])
	}
}

describe('security pools route section builders', () => {
	test('security vault props name exactly the declared vault section props', () => {
		const vault = {
			...undeclaredHookFields,
			adjustBackingFactor: noop,
			approveRep: noop,
			depositRepToVault: noop,
			loadSecurityVault: noop,
			loadingSecurityVault: false,
			redeemFees: noop,
			redeemRepFromVault: noop,
			securityVaultActiveAction: undefined,
			securityVaultDetails: undefined,
			securityVaultError: 'vault error',
			securityVaultForm: getDefaultSecurityVaultFormState(),
			securityVaultMissing: false,
			securityVaultQueuedOperations: [],
			securityVaultRepApproval: { error: undefined, loading: false, value: 4n },
			securityVaultResult: undefined,
			setSecurityVaultForm: noop,
			walletRepBalanceAttoRep: 5n,
			walletRepBalanceError: undefined,
			walletRepBalanceLoading: false,
			withdrawRep: noop,
		}
		const props = buildSecurityVaultSectionProps(vault, { accountState, ...repPrice }, undefined, noop)
		expect(sortedKeys(props)).toEqual([
			'accountState',
			'loadingSecurityVault',
			'onApproveRep',
			'onDepositRepToVault',
			'onLoadSecurityVault',
			'onRedeemFees',
			'onRedeemRepFromVault',
			'onSecurityVaultFormChange',
			'onSetVaultUnderwritingLimit',
			'onWithdrawRep',
			'repPerEthPrice',
			'repPerEthSource',
			'repPerEthSourceUrl',
			'securityPoolVaults',
			'securityVaultActiveAction',
			'securityVaultDetails',
			'securityVaultError',
			'securityVaultForm',
			'securityVaultMissing',
			'securityVaultQueuedOperations',
			'securityVaultRepApproval',
			'securityVaultResult',
			'selectedPoolStatoblastSecurityMultiplierBps',
			'walletRepBalanceAttoRep',
			'walletRepBalanceError',
			'walletRepBalanceLoading',
		])
		expectPassedThrough(props, vault)
		expect(props.onApproveRep).toBe(vault.approveRep)
		expect(props.onSetVaultUnderwritingLimit).toBe(vault.adjustBackingFactor)
		expect(props.repPerEthSourceUrl).toBe(repPrice.repPerEthSourceUrl)
	})

	test('reporting props name exactly the declared reporting section props', () => {
		const reporting = {
			...undeclaredHookFields,
			loadReporting: noop,
			loadingReportingDetails: true,
			onApproveReportingRep: noop,
			onReportOutcome: noop,
			reportingActiveAction: undefined,
			reportingDetails: undefined,
			reportingError: undefined,
			reportingForm: getDefaultReportingFormState(),
			reportingResult: undefined,
			withdrawEscalation: noop,
		}
		const updateReportingForm = noop
		const props = buildReportingSectionProps(reporting, { accountState }, updateReportingForm)
		expect(sortedKeys(props)).toEqual(['accountState', 'loadingReportingDetails', 'onApproveReportingRep', 'onLoadReporting', 'onReportOutcome', 'onReportingFormChange', 'onWithdrawEscalation', 'reportingActiveAction', 'reportingDetails', 'reportingError', 'reportingForm', 'reportingResult'])
		expectPassedThrough(props, reporting)
		expect(props.onLoadReporting).toBe(reporting.loadReporting)
		expect(props.onReportingFormChange).toBe(updateReportingForm)
	})

	test('trading props name exactly the declared trading section props', () => {
		const trading = {
			...undeclaredHookFields,
			createCompleteSet: noop,
			loadingTradingDetails: false,
			loadingTradingForkUniverse: false,
			migrateShares: noop,
			redeemCompleteSet: noop,
			redeemShares: noop,
			setTradingForm: noop,
			tradingActiveAction: undefined,
			tradingDetails: undefined,
			tradingError: undefined,
			tradingForkUniverse: undefined,
			tradingForm: getDefaultTradingFormState(),
			tradingResult: undefined,
		}
		const props = buildTradingSectionProps(trading, { accountState, ...repPrice }, undefined)
		expect(sortedKeys(props)).toEqual([
			'accountState',
			'loadingTradingDetails',
			'loadingTradingForkUniverse',
			'onCreateCompleteSet',
			'onMigrateShares',
			'onRedeemCompleteSet',
			'onRedeemShares',
			'onTradingFormChange',
			'repPerEthPrice',
			'repPerEthSource',
			'repPerEthSourceUrl',
			'selectedPool',
			'tradingActiveAction',
			'tradingDetails',
			'tradingError',
			'tradingForkUniverse',
			'tradingForm',
			'tradingResult',
		])
		expectPassedThrough(props, trading)
		expect(props.onCreateCompleteSet).toBe(trading.createCompleteSet)
	})

	test('fork auction props name exactly the declared fork auction section props', () => {
		const forkAuction = {
			...undeclaredHookFields,
			claimAuctionProceeds: noop,
			claimParentEscalation: asyncNoop,
			createChildUniverse: asyncNoop,
			finalizeTruthAuction: noop,
			forkAuctionActiveAction: undefined,
			forkAuctionDetails: undefined,
			forkAuctionError: undefined,
			forkAuctionForm: getDefaultForkAuctionFormState(),
			forkAuctionResult: undefined,
			forkUniverse: noop,
			forkWithOwnEscalation: noop,
			initiateFork: noop,
			loadForkAuction: noop,
			loadingForkAuctionDetails: false,
			migrateRepToZoltar: noop,
			migrateUnresolvedEscalation: noop,
			migrateVault: noop,
			refundLosingBids: noop,
			setForkAuctionForm: noop,
			settleForkedEscalation: noop,
			startTruthAuction: noop,
			submitBid: noop,
			withdrawAuctionRefund: noop,
		}
		const props = buildForkAuctionSectionProps(forkAuction, { accountState })
		expect(sortedKeys(props)).toEqual([
			'accountState',
			'forkAuctionActiveAction',
			'forkAuctionDetails',
			'forkAuctionError',
			'forkAuctionForm',
			'forkAuctionResult',
			'loadingForkAuctionDetails',
			'onClaimAuctionProceeds',
			'onClaimParentEscalationDeposits',
			'onCreateChildUniverse',
			'onFinalizeTruthAuction',
			'onForkAuctionFormChange',
			'onForkUniverse',
			'onForkWithOwnEscalation',
			'onInitiateFork',
			'onLoadForkAuction',
			'onMigrateRepToZoltar',
			'onMigrateUnresolvedEscalation',
			'onMigrateVault',
			'onRefundLosingBids',
			'onStartTruthAuction',
			'onSubmitBid',
			'onWithdrawAuctionRefund',
			'onWithdrawForkedEscalation',
		])
		expectPassedThrough(props, forkAuction)
		expect(props.onWithdrawForkedEscalation).toBe(forkAuction.settleForkedEscalation)
	})

	test('pool creation props name only the declared Create Pool props the creation hook owns', () => {
		const poolCreation = {
			...undeclaredHookFields,
			checkingDuplicateOriginPool: false,
			dismissSecurityPoolReview: noop,
			duplicateOriginPoolAddress: undefined,
			duplicateOriginPoolExists: false,
			existingQuestionCheck: undefined,
			loadingMarketDetails: false,
			marketDetails: undefined,
			poolCreationMarketDetails: undefined,
			resetSecurityPoolCreation: noop,
			retryExistingQuestionCheck: noop,
			securityPoolCreating: false,
			securityPoolError: undefined,
			securityPoolForm: getDefaultSecurityPoolFormState(),
			securityPoolResult: undefined,
			securityPoolReviewAbortSignal: new AbortController().signal,
		}
		const props = buildPoolCreationSectionProps(poolCreation)
		expect(sortedKeys(props)).toEqual([
			'checkingDuplicateOriginPool',
			'duplicateOriginPoolAddress',
			'duplicateOriginPoolExists',
			'existingQuestionCheck',
			'loadingMarketDetails',
			'marketDetails',
			'onDismissSecurityPoolReview',
			'onResetSecurityPoolCreation',
			'onRetryExistingQuestionCheck',
			'poolCreationMarketDetails',
			'securityPoolCreating',
			'securityPoolError',
			'securityPoolForm',
			'securityPoolResult',
			'securityPoolReviewAbortSignal',
		])
		expectPassedThrough(props, poolCreation)
		expect(props.onRetryExistingQuestionCheck).toBe(poolCreation.retryExistingQuestionCheck)
	})

	test('liquidation props name only the declared workflow props the overview and price coordinator own', () => {
		const securityPools: ListedSecurityPool[] = []
		const overview = {
			...undeclaredHookFields,
			activeUniverseId: 1n,
			checkedSecurityPoolAddress: undefined,
			closeLiquidationModal: noop,
			liquidationApprovalDetails: undefined,
			liquidationApprovalError: undefined,
			liquidationApprovalId: '7',
			liquidationDebtEthAmount: '1',
			liquidationFundingPreview: undefined,
			liquidationFundingPreviewError: undefined,
			liquidationManagerAddress: undefined,
			liquidationModalOpen: false,
			liquidationReceiverVault: '',
			liquidationReceiverVaultSummary: undefined,
			liquidationReceiverVaultSummaryError: undefined,
			liquidationReceiverVaultSummaryResolved: false,
			liquidationSecurityPoolAddress: undefined,
			liquidationTargetVault: '',
			liquidationTimeoutMinutes: '30',
			loadLiquidationApproval: noop,
			loadLiquidationFundingPreview: noop,
			loadLiquidationReceiverVaultSummary: noop,
			loadingLiquidationApproval: false,
			loadingLiquidationFundingPreview: false,
			loadingLiquidationReceiverVaultSummary: false,
			loadingSecurityPools: false,
			openLiquidationModal: noop,
			queueLiquidation: noop,
			securityPoolLiquidationError: undefined,
			securityPoolOverviewActiveAction: undefined,
			securityPoolOverviewError: undefined,
			securityPoolOverviewResult: undefined,
			securityPools,
			securityPoolsFreshness: undefined,
			setLiquidationAmount: noop,
			setLiquidationApprovalId: noop,
			setLiquidationReceiverVault: noop,
			setLiquidationTimeoutMinutes: noop,
		}
		const priceCoordinator = {
			...undeclaredHookFields,
			executePendingPoolOperation: noop,
			loadPoolOracleManager: noop,
			loadingPoolOracleManager: false,
			poolOracleActiveAction: undefined,
			poolOracleManagerDetails: undefined,
			poolOracleManagerError: undefined,
			poolOracleManagerErrorAddress: undefined,
			poolPriceOracleResult: undefined,
			requestPoolPrice: noop,
		}
		const props = buildLiquidationSectionProps(overview, priceCoordinator)
		expect(sortedKeys(props)).toEqual([
			'checkedSecurityPoolAddress',
			'closeLiquidationModal',
			'liquidationApprovalDetails',
			'liquidationApprovalError',
			'liquidationApprovalId',
			'liquidationDebtEthAmount',
			'liquidationFundingPreview',
			'liquidationFundingPreviewError',
			'liquidationManagerAddress',
			'liquidationModalOpen',
			'liquidationReceiverVault',
			'liquidationReceiverVaultSummary',
			'liquidationReceiverVaultSummaryError',
			'liquidationReceiverVaultSummaryResolved',
			'liquidationSecurityPoolAddress',
			'liquidationTargetVault',
			'liquidationTimeoutMinutes',
			'loadingLiquidationApproval',
			'loadingLiquidationFundingPreview',
			'loadingLiquidationReceiverVaultSummary',
			'loadingPoolOracleManager',
			'loadingSecurityPools',
			'onExecutePendingPoolOperation',
			'onLiquidationAmountChange',
			'onLiquidationApprovalIdChange',
			'onLiquidationReceiverVaultChange',
			'onLiquidationTimeoutMinutesChange',
			'onLoadLiquidationApproval',
			'onLoadLiquidationFundingPreview',
			'onLoadLiquidationReceiverVaultSummary',
			'onLoadPoolOracleManager',
			'onOpenLiquidationModal',
			'onQueueLiquidation',
			'onRequestPoolPrice',
			'poolOracleActiveAction',
			'poolOracleManagerDetails',
			'poolOracleManagerError',
			'poolOracleManagerErrorAddress',
			'poolPriceOracleResult',
			'securityPoolLiquidationError',
			'securityPoolOverviewActiveAction',
			'securityPoolOverviewError',
			'securityPoolOverviewResult',
			'securityPoolsFreshness',
		])
		expectPassedThrough(props, { ...overview, ...priceCoordinator })
		expect(props.onLoadLiquidationApproval).toBe(overview.loadLiquidationApproval)
		expect(props.onRequestPoolPrice).toBe(priceCoordinator.requestPoolPrice)
	})
})
