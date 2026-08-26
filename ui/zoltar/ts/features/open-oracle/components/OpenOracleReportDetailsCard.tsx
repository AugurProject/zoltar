import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from '@zoltar/ui-core-shared/components/ActionLauncherCard.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LifecycleStageBanner } from '@zoltar/ui-core-shared/components/LifecycleStageBanner.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionNetworkValue } from '@zoltar/ui-core-shared/components/TransactionNetworkValue.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionReviewCopy from '@zoltar/ui-core-shared/copy/transactionReview.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
import { getReportPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import type { OpenOracleReportDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import type { OpenOracleFormState } from '../../../types/app.js'
import { formatOpenOracleFeePercentage, formatOpenOracleMultiplier, getOpenOracleDisputeAvailability, getOpenOracleReportStatus, getOpenOracleReportStatusTone, getOpenOracleSelectedReportActionMode, getOpenOracleSettleAvailability } from '../lib/openOracle.js'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import type { OpenOracleSectionProps } from '../../types.js'
import {
	DISPUTE_REPORT_MODAL,
	getOpenOracleClockLabel,
	getSelectedWithdrawalBalance,
	getWithdrawalReportModal,
	OPEN_ORACLE_PRICE_UNITS,
	OpenOracleClockValue,
	renderReportField,
	renderReportFields,
	renderReportSection,
	renderSelectedReportActionSection,
	SETTLE_REPORT_MODAL,
	type SelectedReportModal,
} from './OpenOracleReportContent.js'

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
	accountAddress,
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
	const reportControls = (
		<div className='form-grid'>
			<LookupFieldRow
				label={openOracleCopy.reportId}
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingSelectedReport}>
						{(() => {
							if (loadingSelectedReport) return <LoadingText>{commonCopy.loadingWithEllipsis}</LoadingText>
							if (openOracleReportDetails === undefined) return openOracleCopy.openReport

							return openOracleCopy.refreshReport
						})()}
					</button>
				}
			/>
		</div>
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
	const status = getOpenOracleReportStatus({
		currentReporter: openOracleReportDetails.currentReporter,
		disputeOccurred: openOracleReportDetails.disputeOccurred,
		isDistributed: openOracleReportDetails.isDistributed,
		reportTimestamp: openOracleReportDetails.reportTimestamp,
	})
	const statusTone = getOpenOracleReportStatusTone(status)
	const actionMode = getOpenOracleSelectedReportActionMode(openOracleReportDetails)
	const stage = getOpenOracleStagePresentation(actionMode, openOracleReportDetails)
	const disputeAvailability = getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = getOpenOracleSettleAvailability(openOracleReportDetails)
	const readinessActions = getOpenOracleReadinessActions({
		actionMode,
		disputeMessage: disputeAvailability.message,
		hasReport: true,
		settleMessage: settleAvailability.message,
	}).map(action => {
		if (action.blocker !== undefined) return action
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange(DISPUTE_REPORT_MODAL) }
		if (action.key === 'settle-report') return { ...action, onAction: () => onSelectedReportModalChange(SETTLE_REPORT_MODAL) }

		return action
	})
	const withdrawableBalanceItems = [
		{ amount: openOracleWithdrawableBalances?.ethAttoEth, key: 'ethAttoEth' as const, symbol: commonCopy.eth, units: 18 },
		{ amount: openOracleWithdrawableBalances?.token1, key: 'token1' as const, symbol: openOracleReportDetails.token1Symbol, units: openOracleReportDetails.token1Decimals },
		{ amount: openOracleWithdrawableBalances?.token2, key: 'token2' as const, symbol: openOracleReportDetails.token2Symbol, units: openOracleReportDetails.token2Decimals },
	]
	const selectedWithdrawalBalance = getSelectedWithdrawalBalance(selectedReportModal)
	const selectedWithdrawalItem = withdrawableBalanceItems.find(item => item.key === selectedWithdrawalBalance)
	const selectedWithdrawalAmount = selectedWithdrawalItem?.amount
	const selectedWithdrawalReviewMessage = openOracleWithdrawalReviewMessage !== undefined && openOracleWithdrawalReviewMessage.balance === selectedWithdrawalBalance ? openOracleWithdrawalReviewMessage.message : undefined
	const withdrawalDisabledReason = (() => {
		if (!isOnActiveAppChain) return getWrongNetworkReason()
		if (selectedWithdrawalAmount !== undefined && selectedWithdrawalAmount <= 0n) return openOracleCopy.noWithdrawableBalanceForAsset
		return undefined
	})()
	const hasWithdrawableBalance = withdrawableBalanceItems.some(item => (item.amount ?? 0n) > 0n)
	const showWithdrawableBalances = isConnected && (openOracleReportDetails.isDistributed || hasWithdrawableBalance || openOracleWithdrawableBalancesLoading || openOracleWithdrawableBalancesError !== undefined)
	let withdrawableBalancesContent: ComponentChildren
	if (openOracleWithdrawableBalances === undefined) {
		withdrawableBalancesContent = openOracleWithdrawableBalancesLoading ? (
			<p className='detail'>
				<LoadingText>{openOracleCopy.loadingOracleBalances}</LoadingText>
			</p>
		) : undefined
	} else {
		withdrawableBalancesContent = <MetricGrid>{withdrawableBalanceItems.map(item => renderReportField(item.symbol, <CurrencyValue value={item.amount ?? 0n} suffix={item.symbol} units={item.units} copyable={false} />))}</MetricGrid>
	}
	const reportTransactionContext = [
		{ label: openOracleCopy.reportId, value: openOracleReportDetails.reportId.toString() },
		{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
		{ label: openOracleCopy.oracleAddress, value: <AddressValue address={openOracleReportDetails.openOracleAddress} /> },
		{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
	]
	return (
		<>
			<StickyObjectContext
				badge={<Badge tone={statusTone}>{status}</Badge>}
				eyebrow={openOracleCopy.openOracleReportDetails}
				title={openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: openOracleCopy.reporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: openOracleCopy.price,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
					},
				]}
			/>
			{reportControls}
			{stage.label === status ? undefined : <LifecycleStageBanner stage={stage} />}
			{readinessActions.length > 0 ? (
				<SectionBlock title={openOracleCopy.reportActions}>
					<div className='action-readiness-grid'>
						{readinessActions.map(action => (
							<ActionLauncherCard key={action.key} action={action} />
						))}
					</div>
				</SectionBlock>
			) : undefined}
			{!showWithdrawableBalances ? undefined : (
				<SectionBlock title={openOracleCopy.oracleBalances} description={openOracleCopy.oracleBalancesDetail}>
					<ErrorNotice message={openOracleWithdrawableBalancesError} />
					{withdrawableBalancesContent}
					{!hasWithdrawableBalance && !openOracleWithdrawableBalancesLoading && openOracleWithdrawableBalancesError === undefined ? <p className='detail'>{openOracleCopy.noOracleBalances}</p> : undefined}
					{!hasWithdrawableBalance ? undefined : (
						<div className='actions'>
							{withdrawableBalanceItems
								.filter(item => (item.amount ?? 0n) > 0n)
								.map(item => (
									<TransactionActionButton
										key={item.key}
										idleLabel={openOracleCopy.withdrawBalance(item.symbol)}
										pendingLabel={openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(item.symbol) : openOracleCopy.withdrawingBalance(item.symbol)}
										onClick={() => onSelectedReportModalChange(getWithdrawalReportModal(item.key))}
										pending={(openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === item.key}
										tone='secondary'
										availability={{ disabled: !isOnActiveAppChain || openOracleActiveAction === 'withdrawBalance', reason: isOnActiveAppChain ? undefined : getWrongNetworkReason() }}
									/>
								))}
						</div>
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
						{
							label: openOracleCopy.initialReporter,
							value: openOracleReportDetails.initialReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.initialReporter} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={openOracleCopy.economics}>
					{renderReportSection(openOracleCopy.reportAmounts, [
						{
							label: openOracleCopy.formatExactTokenRequiredLabel(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount1Label(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.formatCurrentAmount2Label(openOracleReportDetails.token2Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
						},
						{
							label: openOracleCopy.price,
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
						},
						{
							label: openOracleCopy.fee,
							value: <CurrencyValue value={openOracleReportDetails.fee} suffix={commonCopy.eth} copyable={false} />,
						},
						{
							label: openOracleCopy.settlerReward,
							value: <CurrencyValue value={openOracleReportDetails.settlerRewardAttoEth} suffix={commonCopy.eth} copyable={false} />,
						},
						{
							label: openOracleCopy.escalationHalt,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
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
							value: openOracleReportDetails.lastReportOppoTime === 0n ? commonCopy.none : openOracleCopy.formatTimingValue(openOracleReportDetails.lastReportOppoTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
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
							label: openOracleCopy.settlementTime,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.settlementTime, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
						},
						{
							label: openOracleCopy.disputeDelay,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.disputeDelay, openOracleReportDetails.timeType ? openOracleCopy.secondsAbbreviation : openOracleCopy.blocks),
						},
						{
							label: openOracleCopy.feePercentage,
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

			<OperationModal context={reportTransactionContext} isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.disputeAndSwap}>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					isConnected,
					isOnActiveAppChain,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onSettleReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleTokenAccessState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal closeOnSuccessKey={openOracleResult?.action === 'settle' ? openOracleResult.hash : undefined} context={reportTransactionContext} isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.settleReport}>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					isConnected,
					isOnActiveAppChain,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onSettleReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleTokenAccessState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			{selectedWithdrawalItem === undefined || selectedWithdrawalAmount === undefined ? undefined : (
				<OperationModal
					closeOnSuccessKey={openOracleResult?.action === 'withdrawBalance' ? openOracleResult.hash : undefined}
					context={reportTransactionContext}
					isOpen={selectedWithdrawalBalance !== undefined}
					onClose={() => onSelectedReportModalChange(undefined)}
					title={openOracleCopy.withdrawBalance(selectedWithdrawalItem.symbol)}
				>
					<TransactionReview
						primary={[
							{
								label: transactionReviewCopy.youReceive,
								value: <CurrencyValue value={selectedWithdrawalAmount} suffix={selectedWithdrawalItem.symbol} units={selectedWithdrawalItem.units} precision='exact' copyable={false} />,
							},
						]}
						details={[
							{
								label: openOracleCopy.withdrawalRecipient,
								value: <AddressValue address={accountAddress} />,
							},
						]}
						risks={[openOracleCopy.formatWithdrawalRisk(selectedWithdrawalItem.symbol)]}
					/>
					<ErrorNotice message={selectedWithdrawalReviewMessage} />
					<div className='actions'>
						<TransactionActionButton
							idleLabel={openOracleCopy.confirmWithdrawal}
							pendingLabel={openOracleWithdrawalBalanceChecking ? openOracleCopy.checkingWithdrawalBalance(selectedWithdrawalItem.symbol) : openOracleCopy.withdrawingBalance(selectedWithdrawalItem.symbol)}
							onClick={() => onWithdrawOpenOracleBalance(selectedWithdrawalItem.key, selectedWithdrawalAmount)}
							pending={(openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance') && openOracleActiveWithdrawalBalance === selectedWithdrawalItem.key}
							availability={{
								disabled: !isOnActiveAppChain || selectedWithdrawalAmount <= 0n || openOracleWithdrawalBalanceChecking || openOracleActiveAction === 'withdrawBalance',
								reason: withdrawalDisabledReason,
							}}
						/>
					</div>
				</OperationModal>
			)}
		</>
	)
}
