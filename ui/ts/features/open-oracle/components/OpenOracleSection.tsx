import * as commonCopy from '../../../copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from '../../../components/ActionLauncherCard.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { EntityCard } from '../../../components/EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from '../../../components/EnumDropdown.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { LifecycleStageBanner } from '../../security-pools/components/LifecycleStageBanner.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OperationModal } from '../../../components/OperationModal.js'
import { PaginationControls } from '../../../components/PaginationControls.js'
import { ReadOnlyDetailAccordion } from '../../../components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { StickyObjectContext } from '../../../components/StickyObjectContext.js'
import { StateHint } from '../../../components/StateHint.js'
import { TokenApprovalControl } from '../../../components/TokenApprovalControl.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TimestampValue } from '../../../components/TimestampValue.js'
import { useLoadController } from '../../../hooks/useLoadController.js'
import { assertNever } from '../../../lib/assert.js'
import { createConnectedReadClient } from '../../../lib/clients.js'
import { useChainBlockNumber, useChainTimestamp } from '../../../lib/chainTimestamp.js'
import {
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidationMessage,
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleReportStatusTone,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	type OpenOracleDisputeSubmissionDetails,
	type OpenOracleInitialReportSubmissionDetails,
	type OpenOracleSelectedReportActionMode,
} from '../lib/openOracle.js'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'
import { getOpenOracleStagePresentation } from '../lib/openOracleStage.js'
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount } from '../../../lib/pagination.js'
import { loadOpenOracleReportSummaries } from '../../../protocol/index.js'
import { isMainnetChain } from '../../../lib/network.js'
import { getReportPresentation } from '../../../lib/userCopy.js'
import type { OpenOracleFormState } from '../../../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../../../types/contracts.js'
import type { OpenOracleSectionProps } from '../../types.js'
const BROWSE_PAGE_SIZE = 10
const OPEN_ORACLE_PRICE_UNITS = 30
type SelectedReportModal = 'dispute' | 'initial-report' | 'settle' | undefined
const DISPUTE_REPORT_MODAL: SelectedReportModal = 'dispute'
const INITIAL_REPORT_MODAL: SelectedReportModal = 'initial-report'
const SETTLE_REPORT_MODAL: SelectedReportModal = 'settle'
type BrowseStatusFilter = 'all' | 'Awaiting Initial Report' | 'Pending' | 'Disputed' | 'Settled'
function getEffectiveOpenOracleReportDetails(report: OpenOracleReportDetails | undefined, currentTimestamp: bigint | undefined, currentBlockNumber: bigint | undefined) {
	if (report === undefined) return undefined
	if ((currentTimestamp === undefined || report.currentTime === currentTimestamp) && (currentBlockNumber === undefined || report.currentBlockNumber === currentBlockNumber)) return report
	return {
		...report,
		currentBlockNumber: currentBlockNumber ?? report.currentBlockNumber,
		currentTime: currentTimestamp ?? report.currentTime,
	}
}
function resolveBrowseStatusFilter(value: string): BrowseStatusFilter {
	switch (value) {
		case 'Awaiting Initial Report':
		case 'Pending':
		case 'Disputed':
		case 'Settled':
		case 'all':
			return value
		default:
			return 'all'
	}
}
function renderReportField(label: string, value: ComponentChildren) {
	return (
		<MetricField key={label} label={label}>
			{value}
		</MetricField>
	)
}
function renderReportSection(
	title: string,
	fields: Array<{
		label: string
		value: ComponentChildren
	}>,
) {
	return (
		<SectionBlock headingLevel={4} title={title} variant='embedded'>
			<MetricGrid variant='question'>{fields.map(field => renderReportField(field.label, field.value))}</MetricGrid>
		</SectionBlock>
	)
}
function renderInitialPriceSourceLabel(priceSource: string, priceSourceUrl: string | undefined) {
	if (priceSourceUrl === undefined) return <strong>{priceSource}</strong>
	return (
		<strong>
			<a href={priceSourceUrl} target='_blank' rel='noreferrer'>
				{priceSource}
			</a>
		</strong>
	)
}

function renderInitialPriceFreshness(openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'], priceSource: OpenOracleInitialReportSubmissionDetails['priceSource']) {
	if (priceSource !== 'MOCK' && priceSource !== 'Uniswap V3' && priceSource !== 'Uniswap V4') return undefined
	if (openOracleInitialReportState.quoteLoadedAtMs === undefined) return undefined
	return (
		<p className='detail'>
			{openOracleCopy.formatQuoteLoadedDetail(openOracleInitialReportState.quoteBlockNumber?.toString(), openOracleCopy.formatQuoteAgeText(openOracleInitialReportState.quoteLoadedAtMs))}
			{openOracleInitialReportState.quoteStale === true ? ` ${openOracleCopy.staleQuoteWarning}` : ''}
		</p>
	)
}
function renderReportSummaryCard(report: OpenOracleReportSummary, onSelectReport: (reportId: bigint) => void) {
	const status = getOpenOracleReportStatus(report)
	const statusTone = getOpenOracleReportStatusTone(status)
	return (
		<EntityCard
			key={report.reportId.toString()}
			className='compact'
			title={openOracleCopy.formatReportNumberTitle(report.reportId.toString())}
			badge={<Badge tone={statusTone}>{status}</Badge>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						{openOracleCopy.openReport}
					</button>
				</div>
			}
		>
			<MetricGrid variant='question'>
				{renderReportField(
					openOracleCopy.tokenPair,
					<>
						<AddressValue address={report.token1} /> / <AddressValue address={report.token2} />
					</>,
				)}
				{renderReportField(openOracleCopy.currentPrice, <CurrencyValue value={report.price} suffix={openOracleCopy.formatTokenPairSuffix(report.token1Symbol, report.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
				{renderReportField(openOracleCopy.currentReporter, report.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={report.currentReporter} />)}
				{renderReportField(openOracleCopy.formatCurrentAmount1Label(report.token1Symbol), <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField(openOracleCopy.formatCurrentAmount2Label(report.token2Symbol), <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField(openOracleCopy.reportTimestamp, <TimestampValue timestamp={report.reportTimestamp} zeroText={openOracleCopy.awaitingInitialReportLabel} />)}
				{renderReportField(openOracleCopy.settlementTimestamp, <TimestampValue timestamp={report.settlementTimestamp} zeroText={openOracleCopy.notSettled} />)}
			</MetricGrid>
		</EntityCard>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	initialReportSubmission,
	isConnected,
	isMainnet,
	onApproveToken1,
	onApproveToken2,
	onDisputeReport,
	onOpenOracleFormChange,
	onRefreshPrice,
	onSettleReport,
	onSubmitInitialReport,
	onWrapWethForInitialReport,
	openOracleActiveAction,
	openOracleForm,
	openOracleInitialReportState,
	openOracleReportDetails,
	token1Symbol,
	token2Symbol,
}: {
	actionMode: OpenOracleSelectedReportActionMode
	disputeSubmission: OpenOracleDisputeSubmissionDetails | undefined
	initialReportSubmission: OpenOracleInitialReportSubmissionDetails
	isConnected: boolean
	isMainnet: boolean
	onApproveToken1: (amount?: bigint) => void
	onApproveToken2: (amount?: bigint) => void
	onDisputeReport: () => void
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void
	onRefreshPrice: () => void
	onSettleReport: () => void
	onSubmitInitialReport: () => void
	onWrapWethForInitialReport: () => void
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction']
	openOracleForm: OpenOracleFormState
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState']
	openOracleReportDetails?: OpenOracleReportDetails
	token1Symbol: string
	token2Symbol: string
}) {
	const disputeTokenOptions: EnumDropdownOption<OpenOracleFormState['disputeTokenToSwap']>[] = [
		{ value: 'token1', label: token1Symbol },
		{ value: 'token2', label: token2Symbol },
	]
	const showQuoteLoadingPlaceholder = openOracleInitialReportState.quoteLoading && openOracleForm.price.trim() === '' && openOracleInitialReportState.defaultPrice === undefined && openOracleInitialReportState.defaultPriceError === undefined
	const disputeAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = openOracleReportDetails === undefined ? { canAct: true, message: undefined } : getOpenOracleSettleAvailability(openOracleReportDetails)
	switch (actionMode) {
		case 'initial-report':
			const token1ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token1Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return undefined
			})()
			const token2ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token2Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				if (initialReportSubmission.amount2 === undefined) return openOracleCopy.formatEnterValidPriceBeforeApprovingReason(token1Symbol, token2Symbol)
				return undefined
			})()
			const wrapDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.wrapEthWalletRequiredReason
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				if (initialReportSubmission.wrapRequiredWethMessage?.kind === 'visible') return initialReportSubmission.wrapRequiredWethMessage.message
				return undefined
			})()
			const submitInitialReportDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.initialReportWalletRequired
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				if (initialReportSubmission.blockMessage?.kind === 'visible') return initialReportSubmission.blockMessage.message
				return undefined
			})()
			return (
				<SectionBlock headingLevel={4} title={openOracleCopy.initialReport} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.reportContext, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.tokenPair, value: `${token1Symbol} / ${token2Symbol}` },
									{ label: openOracleCopy.stage, value: openOracleCopy.awaitingInitialReportLabel },
								])}
						<div className='field-row'>
							<label className='field'>
								<span>{openOracleCopy.formatPriceFieldLabel(token1Symbol, token2Symbol)}</span>
								<FormInput value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder={openOracleCopy.priceExample} />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onRefreshPrice} disabled={openOracleInitialReportState.quoteLoading}>
									{openOracleInitialReportState.quoteLoading ? openOracleCopy.fetching : openOracleCopy.fetchPriceFromUniswap}
								</button>
							</div>
						</div>
						<p className='detail'>
							{openOracleCopy.priceSource} {showQuoteLoadingPlaceholder ? <strong>{commonCopy.loadingWithEllipsis}</strong> : renderInitialPriceSourceLabel(initialReportSubmission.priceSource, initialReportSubmission.priceSourceUrl)}
						</p>
						{renderInitialPriceFreshness(openOracleInitialReportState, initialReportSubmission.priceSource)}
						<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={openOracleCopy.submittingTheInitialReport}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={token1ApprovalGuardMessage}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token1Symbol)}
								requiredAmount={initialReportSubmission.amount1}
								resetKey={`token1:${token1Symbol}:${initialReportSubmission.amount1?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token1Symbol}
								tokenUnits={initialReportSubmission.token1Decimals ?? 18}
							/>
						</SectionBlock>

						<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={openOracleCopy.submittingTheInitialReport}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={token2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token2Symbol)}
								requiredAmount={initialReportSubmission.amount2}
								resetKey={`token2:${token2Symbol}:${initialReportSubmission.amount2?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token2Symbol}
								tokenUnits={initialReportSubmission.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{initialReportSubmission.requiredWethWrapAmount === undefined || initialReportSubmission.requiredWethWrapAmount <= 0n ? undefined : (
							<p className='detail'>
								{openOracleCopy.need} <CurrencyValue value={initialReportSubmission.requiredWethWrapAmount} suffix={commonCopy.weth} copyable={false} /> {openOracleCopy.wethShortfallTail}
							</p>
						)}
						{!isMainnet || initialReportSubmission.wrapRequiredWethMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.wrapRequiredWethMessage.message}</p>}
						{!isMainnet || initialReportSubmission.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.blockMessage.message}</p>}
						<div className='actions'>
							{!initialReportSubmission.hasWethWrapAction ? undefined : (
								<TransactionActionButton
									idleLabel={openOracleCopy.wrapNeededEthToWeth}
									pendingLabel={openOracleCopy.wrappingEth}
									onClick={onWrapWethForInitialReport}
									pending={openOracleActiveAction === 'wrapWeth'}
									tone='secondary'
									availability={{
										disabled: !isConnected || !isMainnet || !initialReportSubmission.canWrapRequiredWeth,
										reason: wrapDisabledReason,
									}}
								/>
							)}
							<TransactionActionButton
								idleLabel={openOracleCopy.submitInitialReport}
								pendingLabel={openOracleCopy.submitting}
								onClick={onSubmitInitialReport}
								pending={openOracleActiveAction === 'submitInitialReport'}
								availability={{
									disabled: !isConnected || !isMainnet || !initialReportSubmission.canSubmit,
									reason: submitInitialReportDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		case 'dispute': {
			const disputeDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return openOracleCopy.reportLoadRequired

				return disputeAvailability.message
			})()
			const token1ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
				if (disputeSubmission?.token1ContributionAmount === undefined) return openOracleCopy.formatDisputeAmountsInvalidReason(token1Symbol)

				return undefined
			})()
			const token2ApprovalGuardMessage = (() => {
				if (openOracleReportDetails === undefined) return openOracleCopy.reportLoadRequired
				if (disputeSubmission?.token2ContributionAmount === undefined) return openOracleCopy.formatDisputeAmountsInvalidReason(token2Symbol)

				return undefined
			})()
			const disputeToken1ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token1Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return token1ApprovalGuardMessage
			})()
			const disputeToken2ApprovalGuardMessage = (() => {
				if (!isConnected) return openOracleCopy.formatDisconnectedWalletApprovalReason(token2Symbol)
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return token2ApprovalGuardMessage
			})()
			const disputeActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.disputeWalletRequiredReason
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined)
			})()
			return (
				<SectionBlock headingLevel={4} title={openOracleCopy.disputeReport} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.currentReportState, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: openOracleCopy.currentPrice, value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(token1Symbol, token2Symbol)} copyable={false} /> },
								])}
						<label className='field'>
							<span>{openOracleCopy.tokenToSwapOut}</span>
							<EnumDropdown options={disputeTokenOptions} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token1Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>{openOracleCopy.formatNewTokenAmountFieldLabel(token2Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>
						{disputeSubmission?.expectedNewAmount1 === undefined ? undefined : <p className='detail'>{openOracleCopy.formatNewAmountMustBeExactDetail(token1Symbol, disputeSubmission.expectedNewAmount1.toString())}</p>}
						<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={openOracleCopy.disputingTheReport}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={disputeToken1ApprovalGuardMessage}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token1Symbol)}
								requiredAmount={disputeSubmission?.token1ContributionAmount}
								resetKey={`dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token1Symbol}
								tokenUnits={disputeSubmission?.token1Decimals ?? 18}
							/>
						</SectionBlock>
						<SectionBlock headingLevel={4} title={openOracleCopy.formatTokenApprovalTitle(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={openOracleCopy.disputingTheReport}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								disabled={!isConnected || !isMainnet}
								guardMessage={disputeToken2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={openOracleCopy.formatApprovingTokenPendingLabel(token2Symbol)}
								requiredAmount={disputeSubmission?.token2ContributionAmount}
								resetKey={`dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								tokenSymbol={token2Symbol}
								tokenUnits={disputeSubmission?.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{!isMainnet || disputeSubmission?.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.disputeAndSwap}
								pendingLabel={openOracleCopy.submittingDispute}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isMainnet || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
									reason: disputeActionDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'settle': {
			const settleDisabledMessage = (() => {
				if (openOracleForm.reportId.trim() === '') return openOracleCopy.reportLoadRequired

				return settleAvailability.message
			})()
			const settleActionDisabledReason = (() => {
				if (!isConnected) return openOracleCopy.settlementWalletRequiredReason
				if (!isMainnet) return commonCopy.mainnetRequiredReason
				return settleDisabledMessage
			})()
			return (
				<SectionBlock headingLevel={4} title={openOracleCopy.settleReport} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(openOracleCopy.settlementSummary, [
									{ label: openOracleCopy.report, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: openOracleCopy.currentReporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: openOracleCopy.settlementTimestamp, value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} /> },
								])}
						<p className='detail'>{openOracleCopy.settlementConfirmationHelpText}</p>
						<div className='actions'>
							<TransactionActionButton
								idleLabel={openOracleCopy.settleReport}
								pendingLabel={openOracleCopy.settlingReport}
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || !isMainnet || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
									reason: settleActionDisabledReason,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'read-only':
			return (
				<SectionBlock headingLevel={4} title={openOracleCopy.settledReport} variant='embedded'>
					<p className='detail'>{openOracleCopy.settledReportReadOnlyDetail}</p>
				</SectionBlock>
			)
		default:
			return assertNever(actionMode)
	}
}
function renderReportDetailsCard(
	openOracleReportDetails: OpenOracleReportDetails | undefined,
	openOracleForm: OpenOracleFormState,
	openOracleInitialReportState: OpenOracleSectionProps['openOracleInitialReportState'],
	openOracleDisputeSubmission: OpenOracleSectionProps['openOracleDisputeSubmission'],
	openOracleInitialReportSubmission: OpenOracleSectionProps['openOracleInitialReportSubmission'],
	openOracleActiveAction: OpenOracleSectionProps['openOracleActiveAction'],
	loadingOracleReport: boolean,
	isConnected: boolean,
	isMainnet: boolean,
	selectedReportModal: SelectedReportModal,
	onApproveToken1: (amount?: bigint) => void,
	onApproveToken2: (amount?: bigint) => void,
	onDisputeReport: () => void,
	onLoadOracleReport: (reportId?: string) => void,
	onOpenOracleFormChange: (update: Partial<OpenOracleFormState>) => void,
	onRefreshPrice: () => void,
	onSelectedReportModalChange: (modal: SelectedReportModal) => void,
	onSettleReport: () => void,
	onSubmitInitialReport: () => void,
	onWrapWethForInitialReport: () => void,
) {
	const reportControls = (
		<div className='form-grid'>
			<LookupFieldRow
				label={openOracleCopy.reportId}
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
						{(() => {
							if (loadingOracleReport) return <LoadingText>{commonCopy.loadingWithEllipsis}</LoadingText>
							if (openOracleReportDetails === undefined) return openOracleCopy.openReport

							return openOracleCopy.refreshReport
						})()}
					</button>
				}
			/>
		</div>
	)
	if (openOracleReportDetails === undefined) {
		const reportPresentation = getReportPresentation({
			kind: 'report',
			state: (() => {
				if (loadingOracleReport) return 'loading'
				if (openOracleForm.reportId.trim() === '') return 'unknown'

				return 'missing'
			})(),
		})
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
	const stage = getOpenOracleStagePresentation(actionMode)
	const disputeAvailability = getOpenOracleDisputeAvailability(openOracleReportDetails)
	const settleAvailability = getOpenOracleSettleAvailability(openOracleReportDetails)
	const readinessActions = getOpenOracleReadinessActions({
		actionMode,
		disputeMessage: disputeAvailability.message,
		hasReport: true,
		reportId: openOracleForm.reportId,
		settleMessage: settleAvailability.message,
	}).map(action => {
		if (action.blocker !== undefined) return action
		if (action.key === 'submit-initial-report') return { ...action, onAction: () => onSelectedReportModalChange(INITIAL_REPORT_MODAL) }
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange(DISPUTE_REPORT_MODAL) }
		if (action.key === 'settle-report') return { ...action, onAction: () => onSelectedReportModalChange(SETTLE_REPORT_MODAL) }

		return action
	})
	if (openOracleInitialReportSubmission === undefined) return undefined
	return (
		<>
			<StickyObjectContext
				eyebrow={openOracleCopy.openOracleReportDetails}
				title={openOracleCopy.formatReportNumberTitle(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: openOracleCopy.stage, value: stage.label },
					{ label: openOracleCopy.tokenPair, value: openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: openOracleCopy.reporter, value: openOracleReportDetails.currentReporter === zeroAddress ? commonCopy.none : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: openOracleCopy.price,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
					},
				]}
			/>
			<LifecycleStageBanner stage={stage} />
			<SectionBlock title={openOracleCopy.reportActions} description={openOracleCopy.reportActionFlowHint}>
				<div className='action-readiness-grid'>
					{readinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<SectionBlock badge={<Badge tone={statusTone}>{status}</Badge>} title={commonCopy.reportDetails}>
				{reportControls}
				<MetricGrid variant='question'>
					{renderReportField(openOracleCopy.reportId, openOracleReportDetails.reportId.toString())}
					{renderReportField(openOracleCopy.oracleAddress, <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField(openOracleCopy.currentReporter, openOracleReportDetails.currentReporter === zeroAddress ? openOracleCopy.noneAwaitingInitialReport : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField(openOracleCopy.currentPrice, <CurrencyValue value={openOracleReportDetails.price} suffix={openOracleCopy.formatTokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
					{renderReportField(openOracleCopy.settlementTimestamp, <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />)}
				</MetricGrid>
			</SectionBlock>
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion defaultOpen title={openOracleCopy.identity}>
					{renderReportSection(openOracleCopy.identity, [
						{
							label: openOracleCopy.oracleAddress,
							value: <AddressValue address={openOracleReportDetails.openOracleAddress} />,
						},
						{
							label: openOracleReportDetails.token1Symbol,
							value: <AddressValue address={openOracleReportDetails.token1} />,
						},
						{
							label: openOracleReportDetails.token2Symbol,
							value: <AddressValue address={openOracleReportDetails.token2} />,
						},
						{
							label: openOracleCopy.currentReporter,
							value: openOracleReportDetails.currentReporter === zeroAddress ? openOracleCopy.noneAwaitingInitialReport : <AddressValue address={openOracleReportDetails.currentReporter} />,
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
							value: <CurrencyValue value={openOracleReportDetails.settlerReward} suffix={commonCopy.eth} copyable={false} />,
						},
						{
							label: openOracleCopy.escalationHalt,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.status}>
					{renderReportSection(commonCopy.status, [
						{
							label: openOracleCopy.reportTimestamp,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.reportTimestamp} zeroText={openOracleCopy.awaitingInitialReportLabel} />,
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
							label: openOracleCopy.settlementTimestamp,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={openOracleCopy.notSettled} />,
						},
						{
							label: openOracleCopy.lastReportOpportunity,
							value: openOracleReportDetails.lastReportOppoTime === 0n ? commonCopy.none : openOracleCopy.formatTimingValue(openOracleReportDetails.lastReportOppoTime, openOracleReportDetails.timeType),
						},
						{
							label: openOracleCopy.stateHash,
							value: openOracleReportDetails.stateHash,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={commonCopy.settlement}>
					{renderReportSection(commonCopy.settlement, [
						{
							label: openOracleCopy.settlementTime,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.settlementTime, openOracleReportDetails.timeType),
						},
						{
							label: openOracleCopy.disputeDelay,
							value: openOracleCopy.formatTimingValue(openOracleReportDetails.disputeDelay, openOracleReportDetails.timeType),
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
					{renderReportSection(openOracleCopy.callbackExtra, [
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

			<OperationModal isOpen={selectedReportModal === 'initial-report'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.submitInitialReport} description={openOracleCopy.initialReportReviewHint}>
				{renderSelectedReportActionSection({
					actionMode: 'initial-report',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.disputeAndSwap} description={openOracleCopy.replacementSwapAmountsHint}>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>

			<OperationModal isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title={openOracleCopy.settleReport} description={openOracleCopy.settlementConfirmationHint}>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
					isMainnet,
					onApproveToken1,
					onApproveToken2,
					onDisputeReport,
					onOpenOracleFormChange,
					onRefreshPrice,
					onSettleReport,
					onSubmitInitialReport,
					onWrapWethForInitialReport,
					openOracleActiveAction,
					openOracleForm,
					openOracleInitialReportState,
					openOracleReportDetails,
					token1Symbol: openOracleReportDetails.token1Symbol,
					token2Symbol: openOracleReportDetails.token2Symbol,
				})}
			</OperationModal>
		</>
	)
}
export function OpenOracleSection({
	activeView,
	accountState,
	loadingOracleReport,
	onApproveToken1,
	onApproveToken2,
	onCreateOpenOracleGame,
	onDisputeReport,
	onLoadOracleReport,
	onOpenOracleCreateFormChange,
	onOpenOracleFormChange,
	onRefreshPrice,
	onSettleReport,
	onSubmitInitialReport,
	onWrapWethForInitialReport,
	loadingOpenOracleCreate,
	openOracleActiveAction,
	openOracleCreateForm,
	openOracleDisputeSubmission,
	openOracleError,
	openOracleForm,
	openOracleInitialReportState,
	openOracleInitialReportSubmission,
	openOracleReportDetails,
	openOracleResult,
	onActiveViewChange,
}: OpenOracleSectionProps) {
	const view = activeView
	const chainCurrentTimestamp = useChainTimestamp()
	const chainCurrentBlockNumber = useChainBlockNumber()
	const [browsePage, setBrowsePage] = useState<OpenOracleReportSummaryPage | undefined>(undefined)
	const [browseError, setBrowseError] = useState<string | undefined>(undefined)
	const [browsePageIndex, setBrowsePageIndex] = useState(0)
	const [browseSearchText, setBrowseSearchText] = useState('')
	const [browseStatusFilter, setBrowseStatusFilter] = useState<BrowseStatusFilter>('all')
	const [selectedReportModal, setSelectedReportModal] = useState<SelectedReportModal>(undefined)
	const browseLoad = useLoadController()
	const isConnected = accountState.address !== undefined
	const isMainnet = isMainnetChain(accountState.chainId)
	const createGuardMessage = getOpenOracleCreateGuardMessage({
		ethValueInput: openOracleCreateForm.ethValue,
		isMainnet,
		settlerRewardInput: openOracleCreateForm.settlerReward,
		walletConnected: isConnected,
		walletEthBalance: accountState.ethBalance,
	})
	const createValidationMessage = getOpenOracleCreateValidationMessage({ form: openOracleCreateForm })
	const createAvailabilityMessage = createGuardMessage ?? createValidationMessage
	const effectiveOpenOracleReportDetails = getEffectiveOpenOracleReportDetails(openOracleReportDetails, chainCurrentTimestamp, chainCurrentBlockNumber)
	useEffect(() => {
		let cancelled = false
		const shouldLoadBrowse = view === 'browse' || openOracleResult?.action === 'createReportInstance'
		if (!shouldLoadBrowse) return undefined
		const loadBrowseReports = async () => {
			await browseLoad.run({
				isCurrent: () => !cancelled,
				onStart: () => {
					setBrowseError(undefined)
				},
				load: async () => await loadOpenOracleReportSummaries(createConnectedReadClient(), browsePageIndex, BROWSE_PAGE_SIZE),
				onSuccess: page => {
					setBrowsePage(page)
				},
				onError: error => {
					setBrowsePage(undefined)
					setBrowseError(error instanceof Error ? error.message : openOracleCopy.reportLoadError)
				},
			})
		}
		void loadBrowseReports()
		return () => {
			cancelled = true
		}
	}, [browsePageIndex, openOracleResult?.action, openOracleResult?.hash, view])
	const loadingBrowse = browseLoad.isLoading.value
	const normalizedBrowseSearchText = browseSearchText.trim().toLowerCase()
	const browseReportCount = browsePage?.reportCount ?? 0n
	const browsePageCount = browsePage === undefined ? undefined : getPaginationPageCount(browseReportCount, BROWSE_PAGE_SIZE)
	const browseHasPreviousPage = browsePageIndex > 0
	const browseHasNextPage = getHasNextPaginationPage(browsePageIndex, browsePageCount)
	const filteredBrowseReports =
		browsePage?.reports.filter(report => {
			const status = getOpenOracleReportStatus(report)
			if (browseStatusFilter !== 'all' && status !== browseStatusFilter) return false
			if (normalizedBrowseSearchText === '') return true
			return (
				report.reportId.toString().includes(normalizedBrowseSearchText) ||
				report.token1Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2Symbol.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token1.toLowerCase().includes(normalizedBrowseSearchText) ||
				report.token2.toLowerCase().includes(normalizedBrowseSearchText)
			)
		}) ?? []
	const openBrowseReport = async (reportId: bigint) => {
		onOpenOracleFormChange({ reportId: reportId.toString() })
		onActiveViewChange('selected-report')
		await onLoadOracleReport(reportId.toString())
	}
	return (
		<div className='route-view-flow'>
			{view === 'browse' ? (
				<div className='workflow-stack route-workflow-stack'>
					<SectionBlock
						actions={
							<PaginationControls
								hasNextPage={browseHasNextPage}
								hasPreviousPage={browseHasPreviousPage}
								loading={loadingBrowse}
								onNextPage={() => setBrowsePageIndex(current => current + 1)}
								onPreviousPage={() => setBrowsePageIndex(current => Math.max(0, current - 1))}
								summary={browsePage === undefined ? undefined : formatPaginationSummary(browsePageIndex, browsePageCount)}
							/>
						}
						density='compact'
						title={openOracleCopy.browseReports}
						description={openOracleCopy.formatBrowseReportsDescription(BROWSE_PAGE_SIZE.toString())}
					>
						<ErrorNotice message={browseError} />
						<div className='filter-toolbar'>
							<label className='field'>
								<span>{openOracleCopy.searchReports}</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder={openOracleCopy.searchByReportIdTokenSymbolOrTokenAddress} />
							</label>
							<label className='field'>
								<span>{commonCopy.status}</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>{openOracleCopy.allStatuses}</option>
									<option value='Awaiting Initial Report'>{openOracleCopy.awaitingInitialReport}</option>
									<option value='Pending'>{commonCopy.pending}</option>
									<option value='Disputed'>{openOracleCopy.disputed}</option>
									<option value='Settled'>{commonCopy.settled}</option>
								</select>
							</label>
						</div>
						{browsePage === undefined ? undefined : <p className='detail'>{openOracleCopy.formatBrowseShownCountSummary(filteredBrowseReports.length.toString(), browsePage.reports.length.toString())}</p>}
						{loadingBrowse ? (
							<StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'pending', detail: openOracleCopy.reportSummariesRefreshingDetail }} />
						) : (
							(() => {
								if (browsePage === undefined || browsePage.reports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: openOracleCopy.oracleGamesEmpty }} />
								if (filteredBrowseReports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.noMatches, badgeTone: 'muted', detail: openOracleCopy.reportFiltersEmpty }} />

								return <div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
							})()
						)}
					</SectionBlock>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{openOracleResult?.action !== 'createReportInstance' ? undefined : (
						<SectionBlock title={openOracleCopy.createSuccess} description={openOracleCopy.reportCreatedDetail}>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => onActiveViewChange('browse')}>
									{commonCopy.returnToBrowse}
								</button>
								<button className='secondary' type='button' onClick={() => onActiveViewChange('create')}>
									{openOracleCopy.createAnother}
								</button>
							</div>
						</SectionBlock>
					)}
					<SectionBlock title={openOracleCopy.openOracleGame} variant='plain' description={openOracleCopy.standaloneOracleDescription}>
						<p className='notice warning'>{openOracleCopy.standaloneOracleWarningDetail}</p>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title={openOracleCopy.tokenPair} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.token1Address}</span>
										<FormInput value={openOracleCreateForm.token1Address} onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })} placeholder={commonCopy.hexValuePlaceholder} aria-label={openOracleCopy.token1Address} aria-describedby='open-oracle-token1-address-help' />
										<p id='open-oracle-token1-address-help' className='field-help'>
											{openOracleCopy.baseTokenHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{openOracleCopy.token2Address}</span>
										<FormInput value={openOracleCreateForm.token2Address} onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })} placeholder={commonCopy.hexValuePlaceholder} aria-label={openOracleCopy.token2Address} aria-describedby='open-oracle-token2-address-help' />
										<p id='open-oracle-token2-address-help' className='field-help'>
											{openOracleCopy.quoteTokenHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={openOracleCopy.initialEconomics} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.exactToken1Report}</span>
										<FormInput value={openOracleCreateForm.exactToken1Report} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })} aria-label={openOracleCopy.exactToken1Report} aria-describedby='open-oracle-exact-token1-report-help' />
										<p id='open-oracle-exact-token1-report-help' className='field-help'>
											{openOracleCopy.initialToken1AmountHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{openOracleCopy.settlerReward}</span>
										<FormInput value={openOracleCreateForm.settlerReward} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} aria-label={openOracleCopy.settlerReward} aria-describedby='open-oracle-settler-reward-help' />
										<p id='open-oracle-settler-reward-help' className='field-help'>
											{openOracleCopy.settlerRewardHelpText}
										</p>
									</label>
								</div>
								<label className='field'>
									<span>{openOracleCopy.ethValueToSend}</span>
									<FormInput value={openOracleCreateForm.ethValue} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} aria-label={openOracleCopy.ethValueToSend} aria-describedby='open-oracle-eth-value-help' />
									<p id='open-oracle-eth-value-help' className='field-help'>
										{openOracleCopy.creationFundingRequirementHelpText}
									</p>
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.feePercentage}</span>
										<FormInput value={openOracleCreateForm.feePercentage} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} aria-label={openOracleCopy.feePercentage} aria-describedby='open-oracle-fee-percentage-help' />
										<p id='open-oracle-fee-percentage-help' className='field-help'>
											{openOracleCopy.disputeFeeHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{commonCopy.multiplier}</span>
										<FormInput value={openOracleCreateForm.multiplier} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} aria-label={commonCopy.multiplier} aria-describedby='open-oracle-multiplier-help' />
										<p id='open-oracle-multiplier-help' className='field-help'>
											{openOracleCopy.escalationMultiplierHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={openOracleCopy.timing} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.settlementTime}</span>
										<FormInput value={openOracleCreateForm.settlementTime} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} aria-label={openOracleCopy.settlementTime} aria-describedby='open-oracle-settlement-time-help' />
										<p id='open-oracle-settlement-time-help' className='field-help'>
											{openOracleCopy.settlementDelayHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{openOracleCopy.escalationHalt}</span>
										<FormInput value={openOracleCreateForm.escalationHalt} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} aria-label={openOracleCopy.escalationHalt} aria-describedby='open-oracle-escalation-halt-help' />
										<p id='open-oracle-escalation-halt-help' className='field-help'>
											{openOracleCopy.disputeEscalationStopAmountHelpText}
										</p>
									</label>
								</div>
								<div className='field-row'>
									<label className='field'>
										<span>{openOracleCopy.disputeDelay}</span>
										<FormInput value={openOracleCreateForm.disputeDelay} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} aria-label={openOracleCopy.disputeDelay} aria-describedby='open-oracle-dispute-delay-help' />
										<p id='open-oracle-dispute-delay-help' className='field-help'>
											{openOracleCopy.disputeDelayHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{openOracleCopy.protocolFee}</span>
										<FormInput value={openOracleCreateForm.protocolFee} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} aria-label={openOracleCopy.protocolFee} aria-describedby='open-oracle-protocol-fee-help' />
										<p id='open-oracle-protocol-fee-help' className='field-help'>
											{openOracleCopy.protocolFeeHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<div className='actions'>
								<TransactionActionButton
									idleLabel={openOracleCopy.createStandaloneOracleGame}
									pendingLabel={openOracleCopy.creating}
									onClick={onCreateOpenOracleGame}
									pending={loadingOpenOracleCreate}
									availability={{ disabled: !isMainnet || createAvailabilityMessage !== undefined, reason: createAvailabilityMessage }}
								/>
							</div>
						</div>
					</SectionBlock>
					<ErrorNotice message={openOracleError} />
				</div>
			) : undefined}

			{view === 'selected-report' ? (
				<div className='workflow-stack route-workflow-stack'>
					{renderReportDetailsCard(
						effectiveOpenOracleReportDetails,
						openOracleForm,
						openOracleInitialReportState,
						openOracleDisputeSubmission,
						openOracleInitialReportSubmission,
						openOracleActiveAction,
						loadingOracleReport,
						isConnected,
						isMainnet,
						selectedReportModal,
						onApproveToken1,
						onApproveToken2,
						onDisputeReport,
						onLoadOracleReport,
						onOpenOracleFormChange,
						onRefreshPrice,
						setSelectedReportModal,
						onSettleReport,
						onSubmitInitialReport,
						onWrapWethForInitialReport,
					)}
				</div>
			) : undefined}

			<ErrorNotice message={openOracleError} />
		</div>
	)
}
