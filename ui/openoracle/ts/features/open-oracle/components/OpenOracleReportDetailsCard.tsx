import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { getWalletConnectionActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { useState } from 'preact/hooks'
import { useOpenOracleSettlementTime } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleSettlementTime.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FavoriteToggle } from '@zoltar/ui-core-shared/components/FavoriteToggle.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { getReportPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import * as openOracleCopy from '@zoltar/ui-statoblast-shared/copy/openOracle.js'
import type { OpenOracleFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import {
	formatOpenOracleFeePercentage,
	formatOpenOracleReportPriceUnit,
	formatOpenOracleMultiplier,
	formatOpenOracleTimingDuration,
	getEffectiveOpenOracleReportDetails,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportProgress,
	getOpenOracleReportProgressLabel,
	getOpenOracleReportProgressTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	getOpenOracleSettleRemaining,
	OPEN_ORACLE_PRICE_UNITS,
	type OpenOracleDisputeInputField,
} from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import { getOpenOracleReadinessActions } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleStage.js'
import { getOpenOracleReportEntityId } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/reportBrowse.js'
import type { OpenOracleSectionProps } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import { DISPUTE_REPORT_MODAL, getOpenOracleClockLabel, OpenOracleClockValue, renderReportField, renderReportFields, renderReportSection, renderSelectedReportActionSection, type SelectedReportModal } from './OpenOracleReportContent.js'

type OpenOracleReportDetailsCardProps = {
	accountAddress: string | undefined
	isConnected: boolean
	isOnActiveAppChain: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onDisputeReport: () => void
	onLoadOracleReport: (reportId?: string) => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onSelectedReportModalChange: (modal: SelectedReportModal) => void
	onSettleReport: () => void
	onWithdrawOpenOracleBalance: OpenOracleSectionProps['onWithdrawOpenOracleBalance']
	onWrapDisputeWeth: () => void
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction']
	openOracleActiveWithdrawalBalance: OpenOracleSectionProps['openOracleActiveWithdrawalBalance']
	openOracleDisputeSubmission: OpenOracleSectionProps['openOracleDisputeSubmission']
	openOracleForm: OpenOracleFormState
	openOracleReportDetails: OpenOracleReportDetails | undefined
	openOracleReportLookupState: OpenOracleSectionProps['openOracleReportLookupState']
	openOracleResult: OpenOracleSectionProps['openOracleResult']
	openOracleTokenAccessState: OpenOracleSectionProps['openOracleTokenAccessState']
	openOracleWithdrawableBalances: OpenOracleSectionProps['openOracleWithdrawableBalances']
	openOracleWithdrawableBalancesError: OpenOracleSectionProps['openOracleWithdrawableBalancesError']
	openOracleWithdrawableBalancesLoading: OpenOracleSectionProps['openOracleWithdrawableBalancesLoading']
	openOracleWithdrawalBalanceChecking: OpenOracleSectionProps['openOracleWithdrawalBalanceChecking']
	openOracleWithdrawalReviewMessage: OpenOracleSectionProps['openOracleWithdrawalReviewMessage']
	selectedReportModal: SelectedReportModal
}

export function OpenOracleReportDetailsCard({
	isConnected,
	isOnActiveAppChain,
	onApproveToken1,
	onApproveToken2,
	onDisputeReport,
	onLoadOracleReport,
	onOpenOracleFormChange,
	onSelectedReportModalChange,
	onSettleReport,
	onWithdrawOpenOracleBalance,
	onWrapDisputeWeth,
	openOracleActiveAction,
	openOracleActiveWithdrawalBalance,
	openOracleDisputeSubmission,
	openOracleForm,
	openOracleReportDetails,
	openOracleReportLookupState,
	openOracleResult,
	openOracleTokenAccessState,
	openOracleWithdrawableBalances,
	openOracleWithdrawableBalancesError,
	openOracleWithdrawableBalancesLoading,
	openOracleWithdrawalBalanceChecking,
	openOracleWithdrawalReviewMessage,
	selectedReportModal,
}: OpenOracleReportDetailsCardProps) {
	const loadingSelectedReport = openOracleReportLookupState === 'loading'
	const liveCurrentTime = useOpenOracleSettlementTime(openOracleReportDetails, loadingSelectedReport, onLoadOracleReport)
	// Revealed dispute errors belong to one report; switching reports starts with hidden errors again.
	const disputeRevealKey = openOracleReportDetails?.reportId.toString() ?? ''
	const [revealedDisputeState, setRevealedDisputeState] = useState<{ key: string; fields: ReadonlySet<OpenOracleDisputeInputField> }>({ key: disputeRevealKey, fields: new Set() })
	const revealedDisputeFields = revealedDisputeState.key === disputeRevealKey ? revealedDisputeState.fields : new Set<OpenOracleDisputeInputField>()
	const onDisputeFieldRevealChange = (field: OpenOracleDisputeInputField, revealed: boolean) =>
		setRevealedDisputeState(current => {
			const fields = current.key === disputeRevealKey ? current.fields : new Set<OpenOracleDisputeInputField>()
			if (fields.has(field) === revealed) return current.key === disputeRevealKey ? current : { key: disputeRevealKey, fields }
			const next = new Set(fields)
			if (revealed) next.add(field)
			else next.delete(field)
			return { key: disputeRevealKey, fields: next }
		})
	// The lookup text is a draft: typing never replaces the loaded report, and submitting opens the typed ID.
	const selectedReportId = openOracleForm.reportId.trim()
	const [lookupDraft, setLookupDraft] = useState<{ selectedReportId: string; text: string }>({ selectedReportId, text: openOracleForm.reportId })
	const lookupText = lookupDraft.selectedReportId === selectedReportId ? lookupDraft.text : openOracleForm.reportId
	const loadedReportId = openOracleReportDetails?.reportId.toString()
	const lookupMatchesLoadedReport = loadedReportId !== undefined && lookupText.trim() === loadedReportId
	const submitLookup = () => {
		const reportId = lookupText.trim()
		setLookupDraft({ selectedReportId: reportId, text: reportId })
		onLoadOracleReport(reportId)
	}
	const reportControls = (
		<form
			className='form-grid'
			onSubmit={event => {
				event.preventDefault()
				if (!loadingSelectedReport && lookupText.trim() !== '') submitLookup()
			}}
		>
			<LookupFieldRow
				label={openOracleCopy.reportId}
				value={lookupText}
				onInput={text => setLookupDraft({ selectedReportId, text })}
				action={
					<button className='secondary' type='submit' disabled={loadingSelectedReport || lookupText.trim() === ''}>
						{(() => {
							if (loadingSelectedReport) return <LoadingText>{commonCopy.loadingWithEllipsis}</LoadingText>
							if (lookupMatchesLoadedReport) return openOracleCopy.refreshReport
							return openOracleCopy.openReport
						})()}
					</button>
				}
			/>
		</form>
	)
	if (openOracleReportDetails === undefined) {
		const reportLookupPresentationState = (() => {
			if (openOracleReportLookupState === 'missing') return 'missing'
			if (openOracleReportLookupState === 'loading') return 'loading'
			return 'unknown'
		})()
		const reportPresentation = getReportPresentation({ kind: 'report', state: reportLookupPresentationState })
		return (
			<SectionBlock title={commonCopy.reportDetails}>
				{reportControls}
				{reportPresentation === undefined ? undefined : <StateHint presentation={reportPresentation} />}
			</SectionBlock>
		)
	}
	const liveReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, liveCurrentTime, undefined)
	// The badge follows the same live clock as the stage banner, so a report past its settlement time never reads as pending.
	const progress = getOpenOracleReportProgress(liveReportDetails, liveReportDetails)
	const statusLabel = getOpenOracleReportProgressLabel(progress)
	const statusTone = getOpenOracleReportProgressTone(progress)
	const actionMode = getOpenOracleSelectedReportActionMode(liveReportDetails)
	const stage = getOpenOracleStagePresentation(actionMode, liveReportDetails)
	const disputeAvailability = getOpenOracleDisputeAvailability(liveReportDetails)
	const settleAvailability = getOpenOracleSettleAvailability(liveReportDetails)
	const remainingUntilSettle = getOpenOracleSettleRemaining(liveReportDetails)
	const settleCountdown = !liveReportDetails.isDistributed && remainingUntilSettle > 0n ? openOracleCopy.formatSettleCountdown(remainingUntilSettle, liveReportDetails.timeType) : undefined
	const readinessActions = getOpenOracleReadinessActions({
		actionMode,
		disputeMessage: disputeAvailability.message,
		hasReport: true,
		settleMessage: settleAvailability.message,
	}).map(action => {
		if (action.key === 'settle-report' && settleCountdown !== undefined) {
			return { actionLabel: action.actionLabel, disabledReasonId: 'open-oracle-settle-countdown', key: action.key, readiness: action.readiness, title: action.title }
		}
		if (action.blocker !== undefined) return action
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange(DISPUTE_REPORT_MODAL) }
		if (action.key === 'settle-report') {
			const wallet = getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected: isConnected })
			return { ...action, onAction: onSettleReport, ...(wallet.reason !== undefined ? { blocker: wallet.reason, walletBlocker: wallet.walletBlocker } : {}) }
		}

		return action
	})
	const withdrawableBalanceItems = [
		{ amount: openOracleWithdrawableBalances?.ethAttoEth, key: 'ethAttoEth' as const, symbol: commonCopy.eth, units: 18 },
		{ amount: openOracleWithdrawableBalances?.token1, key: 'token1' as const, symbol: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals },
		{ amount: openOracleWithdrawableBalances?.token2, key: 'token2' as const, symbol: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals },
	]
	const hasWithdrawableBalance = withdrawableBalanceItems.some(item => (item.amount ?? 0n) > 0n)
	const showWithdrawableBalances = isConnected && (openOracleReportDetails.isDistributed || hasWithdrawableBalance || openOracleWithdrawableBalancesLoading || openOracleWithdrawableBalancesError !== undefined)
	const withdrawableBalancesContent = openOracleWithdrawableBalances === undefined ? undefined : <MetricGrid>{withdrawableBalanceItems.map(item => renderReportField(item.symbol, <CurrencyValue value={item.amount ?? 0n} suffix={item.symbol} units={item.units} />))}</MetricGrid>
	// Each balance keeps its withdraw button in the same order; a reason every button shares is stated once for the group.
	const sharedWithdrawReason = (() => {
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		if (openOracleWithdrawableBalances === undefined) return openOracleWithdrawableBalancesError === undefined ? openOracleCopy.loadingOracleBalances : openOracleCopy.oracleBalancesUnavailable
		if (!hasWithdrawableBalance) return openOracleCopy.noOracleBalances
		return undefined
	})()
	const getWithdrawBalanceAvailability = (amount: bigint | undefined) => {
		if (sharedWithdrawReason !== undefined) return { disabled: true, reason: sharedWithdrawReason }
		if ((amount ?? 0n) === 0n) return { disabled: true, reason: openOracleCopy.nothingToWithdraw }
		return { disabled: openOracleWithdrawalBalanceChecking || openOracleActiveAction !== undefined, reason: undefined }
	}
	const withdrawBalanceButtons = withdrawableBalanceItems.map(item => (
		<TransactionActionButton
			key={item.key}
			idleLabel={openOracleCopy.withdrawBalance(item.symbol)}
			pendingLabel={openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(item.symbol) : openOracleCopy.withdrawingBalance(item.symbol)}
			onClick={() => {
				if (item.amount !== undefined) onWithdrawOpenOracleBalance(item.key, item.amount)
			}}
			pending={(openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === item.key}
			tone='secondary'
			availability={getWithdrawBalanceAvailability(item.amount)}
		/>
	))
	const selectedReportActionProps = {
		disputeSubmission: openOracleDisputeSubmission,
		isConnected,
		isOnActiveAppChain,
		onApproveToken1,
		onApproveToken2,
		onDisputeReport,
		onOpenOracleFormChange,
		onSettleReport,
		onWrapDisputeWeth,
		openOracleActiveAction,
		openOracleForm,
		openOracleTokenAccessState,
		openOracleReportDetails: liveReportDetails,
		token1Symbol: openOracleReportDetails.token1Symbol,
		token2Symbol: openOracleReportDetails.token2Symbol,
	}
	const reportTransactionContext = [
		{ label: openOracleCopy.reportId, value: openOracleReportDetails.reportId.toString() },
		{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
		{ label: openOracleCopy.oracleAddress, value: <AddressValue address={openOracleReportDetails.openOracleAddress} /> },
	]
	return (
		<>
			<StickyObjectContext
				badge={
					<div className='open-oracle-report-badges'>
						<FavoriteToggle app='openoracle' entityLabel={openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString())} id={getOpenOracleReportEntityId(openOracleReportDetails.reportId)} kind='oracleReport' />
						<Badge tone={statusTone}>{statusLabel}</Badge>
					</div>
				}
				eyebrow={openOracleCopy.openOracleReportDetails}
				title={openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: openOracleCopy.reporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: openOracleCopy.price,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={formatOpenOracleReportPriceUnit(openOracleReportDetails)} units={OPEN_ORACLE_PRICE_UNITS} />,
					},
				]}
			/>
			{reportControls}
			{stage.label === statusLabel && stage.detail === undefined ? undefined : <LifecycleStageBanner stage={stage} />}
			{readinessActions.length > 0 ? (
				<SectionBlock title={openOracleCopy.reportActions}>
					<div className='action-readiness-grid open-oracle-report-actions'>
						{readinessActions.map(action => (
							<ActionLauncherCard key={action.key} action={action} pending={action.key === 'settle-report' && openOracleActiveAction === 'settle'} pendingLabel={openOracleCopy.settlingReport}>
								{action.key === 'settle-report' && settleCountdown !== undefined ? <UserMessage id='open-oracle-settle-countdown' className='detail' detail={settleCountdown} /> : undefined}
							</ActionLauncherCard>
						))}
					</div>
				</SectionBlock>
			) : undefined}
			{!showWithdrawableBalances ? undefined : (
				<SectionBlock title={openOracleCopy.oracleBalances} description={openOracleCopy.oracleBalancesDetail}>
					<ErrorNotice message={openOracleWithdrawableBalancesError} />
					<ErrorNotice message={openOracleWithdrawalReviewMessage?.message} />
					{withdrawableBalancesContent}
					{sharedWithdrawReason === undefined ? (
						<div className='actions'>{withdrawBalanceButtons}</div>
					) : (
						<TransactionActionGroup loading={sharedWithdrawReason === openOracleCopy.loadingOracleBalances} message={sharedWithdrawReason}>
							{withdrawBalanceButtons}
						</TransactionActionGroup>
					)}
				</SectionBlock>
			)}
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion title={openOracleCopy.identity}>
					{renderReportFields([
						{
							label: openOracleReportDetails.token1Symbol,
							value: <AddressValue address={openOracleReportDetails.token1} />,
						},
						{
							label: openOracleReportDetails.token2Symbol,
							value: <AddressValue address={openOracleReportDetails.token2} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={openOracleCopy.economics}>
					{renderReportSection(openOracleCopy.reportAmounts, [
						{
							label: openOracleCopy.formatExactTokenRequiredLabel(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount1Label(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount2Label(openOracleReportDetails.token2Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} />,
						},
						{
							label: openOracleCopy.price,
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={formatOpenOracleReportPriceUnit(openOracleReportDetails)} units={OPEN_ORACLE_PRICE_UNITS} />,
						},
						{
							label: openOracleCopy.settlerReward,
							value: <CurrencyValue value={openOracleReportDetails.settlerRewardAttoEth} suffix={commonCopy.eth} />,
						},
						{
							label: openOracleCopy.escalationHalt,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.status}>
					{renderReportFields([
						{
							label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.reportTimestamp, openOracleCopy.reportBlock),
							value: <OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={openOracleReportDetails.timeType} value={openOracleReportDetails.reportTimestamp} />,
						},
						{
							label: openOracleCopy.disputeOccurred,
							value: openOracleReportDetails.disputeOccurred ? commonCopy.yes : commonCopy.no,
						},
						{
							label: commonCopy.settled,
							value: openOracleReportDetails.isDistributed ? commonCopy.yes : commonCopy.no,
						},
						{
							label: getOpenOracleClockLabel(openOracleReportDetails.timeType, openOracleCopy.settlementTimestamp, openOracleCopy.settlementBlock),
							value: <OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={openOracleReportDetails.timeType} value={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />,
						},
						{
							label: openOracleCopy.lastReportOpportunity,
							// The contract records this on the opposite clock: a block number for time-based reports and a timestamp otherwise.
							value: openOracleReportDetails.lastReportOppoTime === 0n ? commonCopy.none : <OpenOracleClockValue currentTimestamp={openOracleReportDetails.currentTime} timeType={!openOracleReportDetails.timeType} value={openOracleReportDetails.lastReportOppoTime} />,
						},
						{
							label: openOracleCopy.stateHash,
							value: openOracleReportDetails.stateHash,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.settlement}>
					{renderReportFields([
						{
							label: openOracleCopy.settlementDelay,
							value: formatOpenOracleTimingDuration(openOracleReportDetails.settlementTime, openOracleReportDetails.timeType),
						},
						{
							label: openOracleCopy.disputeDelay,
							value: formatOpenOracleTimingDuration(openOracleReportDetails.disputeDelay, openOracleReportDetails.timeType),
						},
						{
							label: openOracleCopy.disputeFeeRate,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
						},
						{
							label: openOracleCopy.protocolFee,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
						},
						{
							label: commonCopy.multiplier,
							value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={openOracleCopy.callbackExtra}>
					{renderReportFields([
						{
							label: openOracleCopy.callbackContract,
							value: openOracleReportDetails.callbackContract === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.callbackContract} />,
						},
						{
							label: openOracleCopy.callbackGasLimit,
							value: openOracleReportDetails.callbackGasLimit === 0 ? commonCopy.none : openOracleReportDetails.callbackGasLimit.toString(),
						},
						{
							label: openOracleCopy.protocolFeeRecipient,
							value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.protocolFeeRecipient} />,
						},
						{
							label: openOracleCopy.trackDisputes,
							value: openOracleReportDetails.trackDisputes ? commonCopy.yes : commonCopy.no,
						},
						{
							label: openOracleCopy.numberOfReports,
							value: openOracleReportDetails.numReports.toString(),
						},
					])}
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal closeOnSuccessKey={openOracleResult?.action === 'dispute' ? openOracleResult.hash : undefined} context={reportTransactionContext} isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.disputeAndSwap}>
				{renderSelectedReportActionSection({ ...selectedReportActionProps, actionMode: 'dispute', onDisputeFieldRevealChange, revealedDisputeFields })}
			</OperationModal>
		</>
	)
}
