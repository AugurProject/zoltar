import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown, type EnumDropdownOption } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OperationModal } from './OperationModal.js'
import { PaginationControls } from './PaginationControls.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { SectionBlock } from './SectionBlock.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { useLoadController } from '../hooks/useLoadController.js'
import { getOpenOracleActionSafetyId } from '../lib/actionSafety/ids.js'
import { assertNever } from '../lib/assert.js'
import { createConnectedReadClient } from '../lib/clients.js'
import { useChainBlockNumber, useChainTimestamp } from '../lib/chainTimestamp.js'
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
import { formatPaginationSummary, getHasNextPaginationPage, getPaginationPageCount } from '../lib/pagination.js'
import { loadOpenOracleReportSummaries } from '../contracts.js'
import { isMainnetChain } from '../lib/network.js'
import { UI_STRINGS } from '../lib/uiStrings.js'
import { getReportPresentation } from '../lib/userCopy.js'
import type { OpenOracleFormState } from '../types/app.js'
import type { OpenOracleReportDetails, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../types/contracts.js'
import type { OpenOracleSectionProps } from '../types/components.js'
const BROWSE_PAGE_SIZE = 10
const OPEN_ORACLE_PRICE_UNITS = 30
type SelectedReportModal = 'dispute' | 'initial-report' | 'settle' | undefined
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
			{UI_STRINGS.openOracleSection.quoteLoadedDetail(openOracleInitialReportState.quoteBlockNumber?.toString(), UI_STRINGS.openOracleSection.quoteAgeText(openOracleInitialReportState.quoteLoadedAtMs))}
			{openOracleInitialReportState.quoteStale === true ? ` ${UI_STRINGS.openOracleSection.staleQuoteRefreshDetail}` : ''}
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
			title={UI_STRINGS.openOracleSection.reportNumberTitle(report.reportId.toString())}
			badge={<Badge tone={statusTone}>{status}</Badge>}
			actions={
				<div className='actions'>
					<button className='secondary' type='button' onClick={() => onSelectReport(report.reportId)}>
						{UI_STRINGS.openOracleSection.openReportButtonLabel}
					</button>
				</div>
			}
		>
			<MetricGrid variant='question'>
				{renderReportField(
					UI_STRINGS.openOracleSection.tokenPairLabel,
					<>
						<AddressValue address={report.token1} /> / <AddressValue address={report.token2} />
					</>,
				)}
				{renderReportField(UI_STRINGS.openOracleSection.currentPriceLabel, <CurrencyValue value={report.price} suffix={UI_STRINGS.openOracleSection.tokenPairSuffix(report.token1Symbol, report.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
				{renderReportField(UI_STRINGS.openOracleSection.currentReporterLabel, report.currentReporter === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={report.currentReporter} />)}
				{renderReportField(UI_STRINGS.openOracleSection.currentAmount1Label(report.token1Symbol), <CurrencyValue value={report.currentAmount1} suffix={report.token1Symbol} units={report.token1Decimals} copyable={false} />)}
				{renderReportField(UI_STRINGS.openOracleSection.currentAmount2Label(report.token2Symbol), <CurrencyValue value={report.currentAmount2} suffix={report.token2Symbol} units={report.token2Decimals} copyable={false} />)}
				{renderReportField(UI_STRINGS.openOracleSection.reportTimestampLabel, <TimestampValue timestamp={report.reportTimestamp} zeroText={UI_STRINGS.openOracleSection.awaitingInitialReportLabel} />)}
				{renderReportField(UI_STRINGS.openOracleSection.settlementTimestampLabel, <TimestampValue timestamp={report.settlementTimestamp} zeroText={UI_STRINGS.openOracleSection.notSettledLabel} />)}
			</MetricGrid>
		</EntityCard>
	)
}
export function renderSelectedReportActionSection({
	actionMode,
	disputeSubmission,
	initialReportSubmission,
	isConnected,
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
			return (
				<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.initialReportTitle} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRINGS.openOracleSection.initialReportContextTitle, [
									{ label: UI_STRINGS.openOracleSection.reportLabel, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRINGS.openOracleSection.tokenPairLabel, value: `${token1Symbol} / ${token2Symbol}` },
									{ label: UI_STRINGS.openOracleSection.stickyContextFields.stageLabel, value: UI_STRINGS.openOracleSection.awaitingInitialReportLabel },
								])}
						<div className='field-row'>
							<label className='field'>
								<span>{UI_STRINGS.openOracleSection.priceFieldLabel(token1Symbol, token2Symbol)}</span>
								<FormInput value={openOracleForm.price} onInput={event => onOpenOracleFormChange({ price: event.currentTarget.value })} placeholder={UI_STRINGS.openOracleSection.priceFieldPlaceholder} />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onRefreshPrice} disabled={openOracleInitialReportState.quoteLoading}>
									{openOracleInitialReportState.quoteLoading ? UI_STRINGS.openOracleSection.fetchPriceFromUniswapPendingLabel : UI_STRINGS.openOracleSection.fetchPriceFromUniswapIdleLabel}
								</button>
							</div>
						</div>
						<p className='detail'>
							{UI_STRINGS.openOracleSection.priceSourceLabelPrefix} {showQuoteLoadingPlaceholder ? <strong>{UI_STRINGS.common.loadingLabel}</strong> : renderInitialPriceSourceLabel(initialReportSubmission.priceSource, initialReportSubmission.priceSourceUrl)}
						</p>
						{renderInitialPriceFreshness(openOracleInitialReportState, initialReportSubmission.priceSource)}
						<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.tokenApprovalTitle(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRINGS.openOracleSection.initialReportTokenApprovalActionLabel}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								guardMessage={!isConnected ? UI_STRINGS.openOracleSection.connectWalletBeforeApprovingTokensReason : undefined}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={UI_STRINGS.openOracleSection.approvingTokenPendingLabel(token1Symbol)}
								requiredAmount={initialReportSubmission.amount1}
								resetKey={`token1:${token1Symbol}:${initialReportSubmission.amount1?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken1')}
								tokenSymbol={token1Symbol}
								tokenUnits={initialReportSubmission.token1Decimals ?? 18}
							/>
						</SectionBlock>

						<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.tokenApprovalTitle(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRINGS.openOracleSection.initialReportTokenApprovalActionLabel}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								guardMessage={(() => {
									if (!isConnected) return UI_STRINGS.openOracleSection.connectWalletBeforeApprovingTokensReason
									if (initialReportSubmission.amount2 === undefined) return UI_STRINGS.openOracleSection.enterValidPriceBeforeApprovingReason(token1Symbol, token2Symbol)

									return undefined
								})()}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={UI_STRINGS.openOracleSection.approvingTokenPendingLabel(token2Symbol)}
								requiredAmount={initialReportSubmission.amount2}
								resetKey={`token2:${token2Symbol}:${initialReportSubmission.amount2?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken2')}
								tokenSymbol={token2Symbol}
								tokenUnits={initialReportSubmission.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{initialReportSubmission.requiredWethWrapAmount === undefined || initialReportSubmission.requiredWethWrapAmount <= 0n ? undefined : (
							<p className='detail'>
								{UI_STRINGS.openOracleSection.requiredWethWrapDetailPrefix} <CurrencyValue value={initialReportSubmission.requiredWethWrapAmount} suffix={UI_STRINGS.common.wethSuffix} copyable={false} /> {UI_STRINGS.openOracleSection.requiredWethWrapDetailSuffix}
							</p>
						)}
						{initialReportSubmission.wrapRequiredWethMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.wrapRequiredWethMessage.message}</p>}
						{initialReportSubmission.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{initialReportSubmission.blockMessage.message}</p>}
						<div className='actions'>
							{!initialReportSubmission.hasWethWrapAction ? undefined : (
								<TransactionActionButton
									safetyId={getOpenOracleActionSafetyId('wrapWeth')}
									idleLabel={UI_STRINGS.openOracleSection.wrapEthToWethIdleLabel}
									pendingLabel={UI_STRINGS.openOracleSection.wrapEthToWethPendingLabel}
									onClick={onWrapWethForInitialReport}
									pending={openOracleActiveAction === 'wrapWeth'}
									tone='secondary'
									availability={{
										disabled: !isConnected || !initialReportSubmission.canWrapRequiredWeth,
										reason: (() => {
											if (!isConnected) return UI_STRINGS.openOracleSection.connectWalletBeforeWrappingEthReason
											if (initialReportSubmission.wrapRequiredWethMessage?.kind === 'visible') return initialReportSubmission.wrapRequiredWethMessage.message

											return undefined
										})(),
									}}
								/>
							)}
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('submitInitialReport')}
								idleLabel={UI_STRINGS.openOracleSection.submitInitialReportIdleLabel}
								pendingLabel={UI_STRINGS.openOracleSection.submitInitialReportPendingLabel}
								onClick={onSubmitInitialReport}
								pending={openOracleActiveAction === 'submitInitialReport'}
								availability={{
									disabled: !isConnected || !initialReportSubmission.canSubmit,
									reason: (() => {
										if (!isConnected) return UI_STRINGS.openOracleSection.connectWalletBeforeSubmittingInitialReportReason
										if (initialReportSubmission.blockMessage?.kind === 'visible') return initialReportSubmission.blockMessage.message

										return undefined
									})(),
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		case 'dispute': {
			const disputeDisabledMessage = (() => {
				if (!isConnected) return UI_STRINGS.openOracleSection.connectWalletBeforeDisputingReportsReason
				if (openOracleForm.reportId.trim() === '') return UI_STRINGS.openOracleSection.loadReportFirstReason

				return disputeAvailability.message
			})()
			const token1ApprovalGuardMessage = !isConnected
				? UI_STRINGS.openOracleSection.connectWalletBeforeApprovingTokensReason
				: (() => {
						if (openOracleReportDetails === undefined) return UI_STRINGS.openOracleSection.loadReportFirstReason
						if (disputeSubmission?.token1ContributionAmount === undefined) return UI_STRINGS.openOracleSection.enterValidDisputeAmountsBeforeApprovingReason(token1Symbol)

						return undefined
					})()
			const token2ApprovalGuardMessage = !isConnected
				? UI_STRINGS.openOracleSection.connectWalletBeforeApprovingTokensReason
				: (() => {
						if (openOracleReportDetails === undefined) return UI_STRINGS.openOracleSection.loadReportFirstReason
						if (disputeSubmission?.token2ContributionAmount === undefined) return UI_STRINGS.openOracleSection.enterValidDisputeAmountsBeforeApprovingReason(token2Symbol)

						return undefined
					})()
			return (
				<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.disputeReportTitle} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRINGS.openOracleSection.currentReportStateTitle, [
									{ label: UI_STRINGS.openOracleSection.reportLabel, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRINGS.openOracleSection.currentReporterLabel, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: UI_STRINGS.openOracleSection.currentPriceLabel, value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_STRINGS.openOracleSection.tokenPairSuffix(token1Symbol, token2Symbol)} copyable={false} /> },
								])}
						<label className='field'>
							<span>{UI_STRINGS.openOracleSection.tokenSwapOutLabel}</span>
							<EnumDropdown options={disputeTokenOptions} value={openOracleForm.disputeTokenToSwap} onChange={disputeTokenToSwap => onOpenOracleFormChange({ disputeTokenToSwap })} />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>{UI_STRINGS.openOracleSection.newTokenAmountFieldLabel(token1Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount1} onInput={event => onOpenOracleFormChange({ disputeNewAmount1: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>{UI_STRINGS.openOracleSection.newTokenAmountFieldLabel(token2Symbol)}</span>
								<FormInput value={openOracleForm.disputeNewAmount2} onInput={event => onOpenOracleFormChange({ disputeNewAmount2: event.currentTarget.value })} />
							</label>
						</div>
						{disputeSubmission?.expectedNewAmount1 === undefined ? undefined : <p className='detail'>{UI_STRINGS.openOracleSection.newAmountMustBeExactDetail(token1Symbol, disputeSubmission.expectedNewAmount1.toString())}</p>}
						<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.tokenApprovalTitle(token1Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRINGS.openOracleSection.disputingReportActionLabel}
								allowanceError={openOracleInitialReportState.token1Approval.error}
								allowanceLoading={openOracleInitialReportState.token1Approval.loading}
								approvedAmount={openOracleInitialReportState.token1Approval.value}
								guardMessage={token1ApprovalGuardMessage}
								onApprove={amount => onApproveToken1(amount)}
								pending={openOracleActiveAction === 'approveToken1'}
								pendingLabel={UI_STRINGS.openOracleSection.approvingTokenPendingLabel(token1Symbol)}
								requiredAmount={disputeSubmission?.token1ContributionAmount}
								resetKey={`dispute:token1:${token1Symbol}:${disputeSubmission?.token1ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken1')}
								tokenSymbol={token1Symbol}
								tokenUnits={disputeSubmission?.token1Decimals ?? 18}
							/>
						</SectionBlock>
						<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.tokenApprovalTitle(token2Symbol)} variant='embedded'>
							<TokenApprovalControl
								actionLabel={UI_STRINGS.openOracleSection.disputingReportActionLabel}
								allowanceError={openOracleInitialReportState.token2Approval.error}
								allowanceLoading={openOracleInitialReportState.token2Approval.loading}
								approvedAmount={openOracleInitialReportState.token2Approval.value}
								guardMessage={token2ApprovalGuardMessage}
								onApprove={amount => onApproveToken2(amount)}
								pending={openOracleActiveAction === 'approveToken2'}
								pendingLabel={UI_STRINGS.openOracleSection.approvingTokenPendingLabel(token2Symbol)}
								requiredAmount={disputeSubmission?.token2ContributionAmount}
								resetKey={`dispute:token2:${token2Symbol}:${disputeSubmission?.token2ContributionAmount?.toString() ?? ''}:${openOracleForm.reportId}`}
								safetyId={getOpenOracleActionSafetyId('approveToken2')}
								tokenSymbol={token2Symbol}
								tokenUnits={disputeSubmission?.token2Decimals ?? 18}
							/>
						</SectionBlock>
						{disputeSubmission?.blockMessage?.kind !== 'visible' ? undefined : <p className='detail'>{disputeSubmission.blockMessage.message}</p>}
						<div className='actions'>
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('dispute')}
								idleLabel={UI_STRINGS.openOracleSection.disputeReportActionLabel}
								pendingLabel={UI_STRINGS.openOracleSection.disputeAndSwapPendingLabel}
								onClick={onDisputeReport}
								pending={openOracleActiveAction === 'dispute'}
								tone='secondary'
								availability={{
									disabled: !isConnected || openOracleForm.reportId.trim() === '' || !disputeAvailability.canAct || disputeSubmission?.canSubmit === false,
									reason: disputeDisabledMessage ?? (disputeSubmission?.blockMessage?.kind === 'visible' ? disputeSubmission.blockMessage.message : undefined),
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'settle': {
			const settleDisabledMessage = (() => {
				if (!isConnected) return UI_STRINGS.openOracleSection.connectWalletBeforeSettlingReportsReason
				if (openOracleForm.reportId.trim() === '') return UI_STRINGS.openOracleSection.loadReportFirstReason

				return settleAvailability.message
			})()
			return (
				<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.settleReportTitle} variant='embedded'>
					<div className='form-grid'>
						{openOracleReportDetails === undefined
							? undefined
							: renderReportSection(UI_STRINGS.openOracleSection.settlementSummaryTitle, [
									{ label: UI_STRINGS.openOracleSection.reportLabel, value: `#${openOracleReportDetails.reportId.toString()}` },
									{ label: UI_STRINGS.openOracleSection.currentReporterLabel, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.currentReporter} /> },
									{ label: UI_STRINGS.openOracleSection.settlementTimestampLabel, value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRINGS.openOracleSection.notSettledLabel} /> },
								])}
						<p className='detail'>{UI_STRINGS.openOracleSection.settleConfirmationDetail}</p>
						<div className='actions'>
							<TransactionActionButton
								safetyId={getOpenOracleActionSafetyId('settle')}
								idleLabel={UI_STRINGS.openOracleSection.settleReportIdleLabel}
								pendingLabel={UI_STRINGS.openOracleSection.settleReportPendingLabel}
								onClick={onSettleReport}
								pending={openOracleActiveAction === 'settle'}
								tone='secondary'
								availability={{
									disabled: !isConnected || openOracleForm.reportId.trim() === '' || !settleAvailability.canAct,
									reason: settleDisabledMessage,
								}}
							/>
						</div>
					</div>
				</SectionBlock>
			)
		}
		case 'read-only':
			return (
				<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.settledReportTitle} variant='embedded'>
					<p className='detail'>{UI_STRINGS.openOracleSection.noWriteActionsAvailableDetail}</p>
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
				label={UI_STRINGS.openOracleSection.reportIdFieldLabel}
				value={openOracleForm.reportId}
				onInput={reportId => onOpenOracleFormChange({ reportId })}
				action={
					<button className='secondary' onClick={() => onLoadOracleReport(openOracleForm.reportId)} disabled={loadingOracleReport}>
						{(() => {
							if (loadingOracleReport) return <LoadingText>{UI_STRINGS.common.loadingLabel}</LoadingText>
							if (openOracleReportDetails === undefined) return UI_STRINGS.openOracleSection.openReportButtonLabel

							return UI_STRINGS.openOracleSection.refreshReportButtonLabel
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
			<SectionBlock title={UI_STRINGS.openOracleSection.reportDetailsTitle}>
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
		if (action.key === 'submit-initial-report') return { ...action, onAction: () => onSelectedReportModalChange('initial-report') }
		if (action.key === 'dispute-report') return { ...action, onAction: () => onSelectedReportModalChange('dispute') }
		if (action.key === 'settle-report') return { ...action, onAction: () => onSelectedReportModalChange('settle') }

		return action
	})
	if (openOracleInitialReportSubmission === undefined) return undefined
	return (
		<>
			<StickyObjectContext
				eyebrow={UI_STRINGS.openOracleSection.selectedReportEyebrow}
				title={UI_STRINGS.openOracleSection.reportNumberTitle(openOracleReportDetails.reportId.toString())}
				items={[
					{ label: UI_STRINGS.openOracleSection.stickyContextFields.stageLabel, value: stage.label },
					{ label: UI_STRINGS.openOracleSection.stickyContextFields.tokenPairLabel, value: UI_STRINGS.openOracleSection.tokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol) },
					{ label: UI_STRINGS.openOracleSection.stickyContextFields.reporterLabel, value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.currentReporter} /> },
					{
						label: UI_STRINGS.openOracleSection.stickyContextFields.priceLabel,
						value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_STRINGS.openOracleSection.tokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
					},
				]}
			/>
			<LifecycleStageBanner stage={stage} />
			<SectionBlock title={UI_STRINGS.openOracleSection.reportActionsTitle} description={UI_STRINGS.openOracleSection.reportActionsDescription}>
				<div className='action-readiness-grid'>
					{readinessActions.map(action => (
						<ActionLauncherCard key={action.key} action={action} />
					))}
				</div>
			</SectionBlock>
			<SectionBlock badge={<Badge tone={statusTone}>{status}</Badge>} title={UI_STRINGS.openOracleSection.reportDetailsTitle}>
				{reportControls}
				<MetricGrid variant='question'>
					{renderReportField(UI_STRINGS.openOracleSection.reportIdLabel, openOracleReportDetails.reportId.toString())}
					{renderReportField(UI_STRINGS.openOracleSection.oracleAddressLabel, <AddressValue address={openOracleReportDetails.openOracleAddress} />)}
					{renderReportField(UI_STRINGS.openOracleSection.currentReporterLabel, openOracleReportDetails.currentReporter === zeroAddress ? UI_STRINGS.openOracleSection.currentReporterAwaitingInitialReportLabel : <AddressValue address={openOracleReportDetails.currentReporter} />)}
					{renderReportField(UI_STRINGS.openOracleSection.currentPriceLabel, <CurrencyValue value={openOracleReportDetails.price} suffix={UI_STRINGS.openOracleSection.tokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />)}
					{renderReportField(UI_STRINGS.openOracleSection.settlementTimestampLabel, <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRINGS.openOracleSection.notSettledLabel} />)}
				</MetricGrid>
			</SectionBlock>
			<div className='report-detail-stack'>
				<ReadOnlyDetailAccordion defaultOpen title={UI_STRINGS.openOracleSection.identityTitle}>
					{renderReportSection(UI_STRINGS.openOracleSection.identityTitle, [
						{
							label: UI_STRINGS.openOracleSection.oracleAddressLabel,
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
							label: UI_STRINGS.openOracleSection.currentReporterLabel,
							value: openOracleReportDetails.currentReporter === zeroAddress ? UI_STRINGS.openOracleSection.currentReporterAwaitingInitialReportLabel : <AddressValue address={openOracleReportDetails.currentReporter} />,
						},
						{
							label: UI_STRINGS.openOracleSection.initialReporterLabel,
							value: openOracleReportDetails.initialReporter === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.initialReporter} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRINGS.openOracleSection.economicsTitle}>
					{renderReportSection(UI_STRINGS.openOracleSection.reportAmountsTitle, [
						{
							label: UI_STRINGS.openOracleSection.exactTokenRequiredLabel(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.exactToken1Report} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.currentAmount1Label(openOracleReportDetails.token1Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount1} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.currentAmount2Label(openOracleReportDetails.token2Symbol),
							value: <CurrencyValue value={openOracleReportDetails.currentAmount2} suffix={openOracleReportDetails.token2Symbol} units={openOracleReportDetails.token2Decimals} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.priceLabel,
							value: <CurrencyValue value={openOracleReportDetails.price} suffix={UI_STRINGS.openOracleSection.tokenPairSuffix(openOracleReportDetails.token1Symbol, openOracleReportDetails.token2Symbol)} units={OPEN_ORACLE_PRICE_UNITS} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.feeLabel,
							value: <CurrencyValue value={openOracleReportDetails.fee} suffix={UI_STRINGS.common.ethSuffix} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.settlerRewardLabel,
							value: <CurrencyValue value={openOracleReportDetails.settlerReward} suffix={UI_STRINGS.common.ethSuffix} copyable={false} />,
						},
						{
							label: UI_STRINGS.openOracleSection.escalationHaltLabel,
							value: <CurrencyValue value={openOracleReportDetails.escalationHalt} suffix={openOracleReportDetails.token1Symbol} units={openOracleReportDetails.token1Decimals} copyable={false} />,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRINGS.openOracleSection.statusTitle}>
					{renderReportSection(UI_STRINGS.openOracleSection.statusTitle, [
						{
							label: UI_STRINGS.openOracleSection.reportTimestampLabel,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.reportTimestamp} zeroText={UI_STRINGS.openOracleSection.awaitingInitialReportLabel} />,
						},
						{
							label: UI_STRINGS.openOracleSection.disputeOccurredLabel,
							value: openOracleReportDetails.disputeOccurred ? UI_STRINGS.openOracleSection.booleanYesLabel : UI_STRINGS.openOracleSection.booleanNoLabel,
						},
						{
							label: UI_STRINGS.openOracleSection.settledLabel,
							value: openOracleReportDetails.isDistributed ? UI_STRINGS.openOracleSection.booleanYesLabel : UI_STRINGS.openOracleSection.booleanNoLabel,
						},
						{
							label: UI_STRINGS.openOracleSection.settlementTimestampLabel,
							value: <TimestampValue currentTimestamp={openOracleReportDetails.currentTime} timestamp={openOracleReportDetails.settlementTimestamp} zeroText={UI_STRINGS.openOracleSection.notSettledLabel} />,
						},
						{
							label: UI_STRINGS.openOracleSection.lastReportOpportunityLabel,
							value: openOracleReportDetails.lastReportOppoTime === 0n ? UI_STRINGS.common.noneLabel : `${openOracleReportDetails.lastReportOppoTime.toString()} ${openOracleReportDetails.timeType ? UI_STRINGS.openOracleSection.timeInSecondsSuffix : UI_STRINGS.openOracleSection.timeInBlocksSuffix}`,
						},
						{
							label: UI_STRINGS.openOracleSection.stateHashLabel,
							value: openOracleReportDetails.stateHash,
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRINGS.openOracleSection.settlementTitle}>
					{renderReportSection(UI_STRINGS.openOracleSection.settlementTitle, [
						{
							label: UI_STRINGS.openOracleSection.settlementTimeLabel,
							value: `${openOracleReportDetails.settlementTime.toString()} ${openOracleReportDetails.timeType ? UI_STRINGS.openOracleSection.timeInSecondsSuffix : UI_STRINGS.openOracleSection.timeInBlocksSuffix}`,
						},
						{
							label: UI_STRINGS.openOracleSection.disputeDelayLabel,
							value: `${openOracleReportDetails.disputeDelay.toString()} ${openOracleReportDetails.timeType ? UI_STRINGS.openOracleSection.timeInSecondsSuffix : UI_STRINGS.openOracleSection.timeInBlocksSuffix}`,
						},
						{
							label: UI_STRINGS.openOracleSection.feePercentageLabel,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.feePercentage),
						},
						{
							label: UI_STRINGS.openOracleSection.protocolFeeLabel,
							value: formatOpenOracleFeePercentage(openOracleReportDetails.protocolFee),
						},
						{
							label: UI_STRINGS.openOracleSection.multiplierLabel,
							value: formatOpenOracleMultiplier(openOracleReportDetails.multiplier),
						},
					])}
				</ReadOnlyDetailAccordion>

				<ReadOnlyDetailAccordion title={UI_STRINGS.openOracleSection.callbackExtraTitle}>
					{renderReportSection(UI_STRINGS.openOracleSection.callbackExtraTitle, [
						{
							label: UI_STRINGS.openOracleSection.callbackContractLabel,
							value: openOracleReportDetails.callbackContract === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.callbackContract} />,
						},
						{
							label: UI_STRINGS.openOracleSection.callbackGasLimitLabel,
							value: openOracleReportDetails.callbackGasLimit === 0 ? UI_STRINGS.common.noneLabel : openOracleReportDetails.callbackGasLimit.toString(),
						},
						{
							label: UI_STRINGS.openOracleSection.protocolFeeRecipientLabel,
							value: openOracleReportDetails.protocolFeeRecipient === zeroAddress ? UI_STRINGS.common.noneLabel : <AddressValue address={openOracleReportDetails.protocolFeeRecipient} />,
						},
						{
							label: UI_STRINGS.openOracleSection.trackDisputesLabel,
							value: openOracleReportDetails.trackDisputes ? UI_STRINGS.openOracleSection.booleanYesLabel : UI_STRINGS.openOracleSection.booleanNoLabel,
						},
						{
							label: UI_STRINGS.openOracleSection.numberOfReportsLabel,
							value: openOracleReportDetails.numReports.toString(),
						},
					])}
				</ReadOnlyDetailAccordion>
			</div>

			<OperationModal isOpen={selectedReportModal === 'initial-report'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRINGS.openOracleSection.initialReportModalTitle} description={UI_STRINGS.openOracleSection.initialReportModalDescription}>
				{renderSelectedReportActionSection({
					actionMode: 'initial-report',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
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

			<OperationModal isOpen={selectedReportModal === 'dispute'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRINGS.openOracleSection.disputeAndSwapModalTitle} description={UI_STRINGS.openOracleSection.disputeAndSwapModalDescription}>
				{renderSelectedReportActionSection({
					actionMode: 'dispute',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
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

			<OperationModal isOpen={selectedReportModal === 'settle'} onClose={() => onSelectedReportModalChange(undefined)} title={UI_STRINGS.openOracleSection.settleReportModalTitle} description={UI_STRINGS.openOracleSection.settleReportModalDescription}>
				{renderSelectedReportActionSection({
					actionMode: 'settle',
					disputeSubmission: openOracleDisputeSubmission,
					initialReportSubmission: openOracleInitialReportSubmission,
					isConnected,
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
					setBrowseError(error instanceof Error ? error.message : UI_STRINGS.openOracleSection.loadOpenOracleReportsFailedMessage)
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
						title={UI_STRINGS.openOracleSection.browseReportsTitle}
						description={UI_STRINGS.openOracleSection.browseReportsDescription(BROWSE_PAGE_SIZE.toString())}
					>
						<ErrorNotice message={browseError} />
						<div className='filter-toolbar'>
							<label className='field'>
								<span>{UI_STRINGS.openOracleSection.searchReportsLabel}</span>
								<FormInput value={browseSearchText} onInput={event => setBrowseSearchText(event.currentTarget.value)} placeholder={UI_STRINGS.openOracleSection.searchReportsPlaceholder} />
							</label>
							<label className='field'>
								<span>{UI_STRINGS.openOracleSection.statusFieldLabel}</span>
								<select value={browseStatusFilter} onChange={event => setBrowseStatusFilter(resolveBrowseStatusFilter(event.currentTarget.value))}>
									<option value='all'>{UI_STRINGS.openOracleSection.statusFilterAllLabel}</option>
									<option value='Awaiting Initial Report'>{UI_STRINGS.openOracleSection.statusFilterAwaitingInitialReportLabel}</option>
									<option value='Pending'>{UI_STRINGS.openOracleSection.statusFilterPendingLabel}</option>
									<option value='Disputed'>{UI_STRINGS.openOracleSection.statusFilterDisputedLabel}</option>
									<option value='Settled'>{UI_STRINGS.openOracleSection.statusFilterSettledLabel}</option>
								</select>
							</label>
						</div>
						{browsePage === undefined ? undefined : <p className='detail'>{UI_STRINGS.openOracleSection.browseShownCountSummary(filteredBrowseReports.length.toString(), browsePage.reports.length.toString())}</p>}
						{loadingBrowse ? (
							<StateHint presentation={{ key: 'loading', badgeLabel: UI_STRINGS.common.loadingBadgeLabel, badgeTone: 'pending', detail: UI_STRINGS.openOracleSection.refreshingReportSummariesDetail }} />
						) : (
							(() => {
								if (browsePage === undefined || browsePage.reports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: UI_STRINGS.openOracleSection.noneYetBadgeLabel, badgeTone: 'muted', detail: UI_STRINGS.openOracleSection.noOpenOracleGamesDetail }} />
								if (filteredBrowseReports.length === 0) return <StateHint presentation={{ key: 'empty', badgeLabel: UI_STRINGS.openOracleSection.noMatchesBadgeLabel, badgeTone: 'muted', detail: UI_STRINGS.openOracleSection.noReportsMatchFiltersDetail }} />

								return <div className='entity-card-list'>{filteredBrowseReports.map(report => renderReportSummaryCard(report, reportId => void openBrowseReport(reportId)))}</div>
							})()
						)}
					</SectionBlock>
				</div>
			) : undefined}

			{view === 'create' ? (
				<div className='workflow-stack route-workflow-stack'>
					{openOracleResult?.action !== 'createReportInstance' ? undefined : (
						<SectionBlock title={UI_STRINGS.openOracleSection.createSuccessTitle} description={UI_STRINGS.openOracleSection.createSuccessDescription}>
							<div className='actions'>
								<button className='primary' type='button' onClick={() => onActiveViewChange('browse')}>
									{UI_STRINGS.openOracleSection.returnToBrowseLabel}
								</button>
								<button className='secondary' type='button' onClick={() => onActiveViewChange('create')}>
									{UI_STRINGS.openOracleSection.createAnotherLabel}
								</button>
							</div>
						</SectionBlock>
					)}
					<SectionBlock title={UI_STRINGS.openOracleSection.advancedStandaloneOracleGameTitle} variant='plain' description={UI_STRINGS.openOracleSection.advancedStandaloneOracleGameDescription}>
						<p className='notice warning'>{UI_STRINGS.openOracleSection.standaloneOracleWarning}</p>
						<div className='form-grid'>
							<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.tokenPairTitle} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.token1AddressFieldLabel}</span>
										<FormInput
											value={openOracleCreateForm.token1Address}
											onInput={event => onOpenOracleCreateFormChange({ token1Address: event.currentTarget.value })}
											placeholder={UI_STRINGS.common.hexValuePlaceholder}
											aria-label={UI_STRINGS.openOracleSection.token1AddressFieldLabel}
											aria-describedby='open-oracle-token1-address-help'
										/>
										<p id='open-oracle-token1-address-help' className='field-help'>
											{UI_STRINGS.openOracleSection.token1AddressFieldHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.token2AddressFieldLabel}</span>
										<FormInput
											value={openOracleCreateForm.token2Address}
											onInput={event => onOpenOracleCreateFormChange({ token2Address: event.currentTarget.value })}
											placeholder={UI_STRINGS.common.hexValuePlaceholder}
											aria-label={UI_STRINGS.openOracleSection.token2AddressFieldLabel}
											aria-describedby='open-oracle-token2-address-help'
										/>
										<p id='open-oracle-token2-address-help' className='field-help'>
											{UI_STRINGS.openOracleSection.token2AddressFieldHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.initialEconomicsTitle} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.exactToken1ReportFieldLabel}</span>
										<FormInput
											value={openOracleCreateForm.exactToken1Report}
											inputMode='decimal'
											onInput={event => onOpenOracleCreateFormChange({ exactToken1Report: event.currentTarget.value })}
											aria-label={UI_STRINGS.openOracleSection.exactToken1ReportFieldLabel}
											aria-describedby='open-oracle-exact-token1-report-help'
										/>
										<p id='open-oracle-exact-token1-report-help' className='field-help'>
											{UI_STRINGS.openOracleSection.exactToken1ReportFieldHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.settlerRewardFieldLabel}</span>
										<FormInput value={openOracleCreateForm.settlerReward} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ settlerReward: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.settlerRewardFieldLabel} aria-describedby='open-oracle-settler-reward-help' />
										<p id='open-oracle-settler-reward-help' className='field-help'>
											{UI_STRINGS.openOracleSection.settlerRewardFieldHelpText}
										</p>
									</label>
								</div>
								<label className='field'>
									<span>{UI_STRINGS.openOracleSection.ethValueToSendFieldLabel}</span>
									<FormInput value={openOracleCreateForm.ethValue} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ ethValue: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.ethValueToSendFieldLabel} aria-describedby='open-oracle-eth-value-help' />
									<p id='open-oracle-eth-value-help' className='field-help'>
										{UI_STRINGS.openOracleSection.ethValueToSendFieldHelpText}
									</p>
								</label>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.feeFieldLabel}</span>
										<FormInput value={openOracleCreateForm.feePercentage} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ feePercentage: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.feeFieldLabel} aria-describedby='open-oracle-fee-percentage-help' />
										<p id='open-oracle-fee-percentage-help' className='field-help'>
											{UI_STRINGS.openOracleSection.feeFieldHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.multiplierFieldLabel}</span>
										<FormInput value={openOracleCreateForm.multiplier} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ multiplier: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.multiplierFieldLabel} aria-describedby='open-oracle-multiplier-help' />
										<p id='open-oracle-multiplier-help' className='field-help'>
											{UI_STRINGS.openOracleSection.multiplierFieldHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<SectionBlock headingLevel={4} title={UI_STRINGS.openOracleSection.timingTitle} variant='embedded'>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.settlementTimeFieldLabel}</span>
										<FormInput value={openOracleCreateForm.settlementTime} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ settlementTime: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.settlementTimeFieldLabel} aria-describedby='open-oracle-settlement-time-help' />
										<p id='open-oracle-settlement-time-help' className='field-help'>
											{UI_STRINGS.openOracleSection.settlementTimeFieldHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.escalationHaltFieldLabel}</span>
										<FormInput value={openOracleCreateForm.escalationHalt} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ escalationHalt: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.escalationHaltFieldLabel} aria-describedby='open-oracle-escalation-halt-help' />
										<p id='open-oracle-escalation-halt-help' className='field-help'>
											{UI_STRINGS.openOracleSection.escalationHaltFieldHelpText}
										</p>
									</label>
								</div>
								<div className='field-row'>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.disputeDelayFieldLabel}</span>
										<FormInput value={openOracleCreateForm.disputeDelay} inputMode='numeric' onInput={event => onOpenOracleCreateFormChange({ disputeDelay: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.disputeDelayFieldLabel} aria-describedby='open-oracle-dispute-delay-help' />
										<p id='open-oracle-dispute-delay-help' className='field-help'>
											{UI_STRINGS.openOracleSection.disputeDelayFieldHelpText}
										</p>
									</label>
									<label className='field'>
										<span>{UI_STRINGS.openOracleSection.protocolFeeFieldLabel}</span>
										<FormInput value={openOracleCreateForm.protocolFee} inputMode='decimal' onInput={event => onOpenOracleCreateFormChange({ protocolFee: event.currentTarget.value })} aria-label={UI_STRINGS.openOracleSection.protocolFeeFieldLabel} aria-describedby='open-oracle-protocol-fee-help' />
										<p id='open-oracle-protocol-fee-help' className='field-help'>
											{UI_STRINGS.openOracleSection.protocolFeeFieldHelpText}
										</p>
									</label>
								</div>
							</SectionBlock>

							<div className='actions'>
								<TransactionActionButton
									safetyId={getOpenOracleActionSafetyId('createReportInstance')}
									idleLabel={UI_STRINGS.openOracleSection.createStandaloneOracleGameButtonIdleLabel}
									pendingLabel={UI_STRINGS.openOracleSection.createStandaloneOracleGameButtonPendingLabel}
									onClick={onCreateOpenOracleGame}
									pending={loadingOpenOracleCreate}
									availability={{ disabled: createAvailabilityMessage !== undefined, reason: createAvailabilityMessage }}
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
