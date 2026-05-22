import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { WarningSurface } from './WarningSurface.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getMaxProfitContribution, getMinimumOutcomeChangeContribution, previewReportingContribution } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../types/components.js'
import type { ActiveReportingDetails, EscalationDeposit, ReportingOutcomeKey } from '../types/contracts.js'

type ReportingStatus = 'active' | 'missing' | 'not-started'

type EscalationSideDisplay = {
	balance: bigint | undefined
	estimate:
		| {
				profit: bigint
				payout: bigint
		  }
		| undefined
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}

const ZERO_REP = 0n

function getOutcomeSides({ activeReportingDetails, selectedAmount }: { activeReportingDetails: ActiveReportingDetails | undefined; selectedAmount: bigint | undefined }) {
	if (activeReportingDetails !== undefined) {
		return activeReportingDetails.sides.map<EscalationSideDisplay>(side => {
			const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
			return {
				balance: side.balance,
				estimate: selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, side.key, selectedAmount),
				key: side.key,
				label: side.label,
				userDeposits: side.userDeposits,
				userStake,
			}
		})
	}

	return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
		balance: ZERO_REP,
		estimate: undefined,
		key: option.value,
		label: option.label,
		userDeposits: [],
		userStake: ZERO_REP,
	}))
}

function getDepositEntryCountLabel(count: number) {
	return count === 1 ? 'entry' : 'entries'
}

function isPresetLoadReason(reason: string | undefined) {
	return reason === 'Load reporting details before using presets.'
}

function renderReportingContextStatus(effectiveCurrentTimestamp: bigint | undefined, marketDetails: ReportingSectionProps['previewMarketDetails']) {
	if (effectiveCurrentTimestamp === undefined || marketDetails === undefined) return undefined
	if (marketDetails.endTime > effectiveCurrentTimestamp) {
		return (
			<WarningSurface as='div' className='transaction-action-status warning' role='status' variant='compact'>
				<p className='detail transaction-action-status-detail'>Reporting is not enabled. Opens in {formatDuration(marketDetails.endTime - effectiveCurrentTimestamp)}.</p>
			</WarningSurface>
		)
	}

	return (
		<div className='transaction-action-status success' role='status'>
			<p className='detail transaction-action-status-detail'>
				Reporting is open. Market ended at <TimestampValue currentTimestamp={effectiveCurrentTimestamp} timestamp={marketDetails.endTime} /> ({formatDuration(effectiveCurrentTimestamp - marketDetails.endTime)} ago).
			</p>
		</div>
	)
}

export function ReportingSection({
	accountState,
	currentTimestamp,
	embedInCard = false,
	loadingReportingDetails,
	lockedReason,
	onLoadReporting,
	onReportOutcome,
	onReportingFormChange,
	onWithdrawEscalation,
	previewMarketDetails,
	reportingActiveAction,
	reportingDetails,
	reportingError,
	reportingFeedback,
	reportingForm,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	mode = 'full-reporting',
}: ReportingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const activeReportingDetails = reportingDetails?.status === 'active' ? reportingDetails : undefined
	const reportingStatus: ReportingStatus = reportingDetails === undefined ? 'missing' : reportingDetails.status
	const marketDetails = reportingDetails?.marketDetails ?? previewMarketDetails
	const effectiveCurrentTimestamp = reportingDetails?.currentTime ?? currentTimestamp
	const reportingLocked = lockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const selectedSide = activeReportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedWithdrawDepositIndexes = reportingForm.selectedWithdrawDepositIndexes
	const chartScaleMax = activeReportingDetails === undefined ? 1n : activeReportingDetails.sides.reduce((maxBalance, side) => (side.balance > maxBalance ? side.balance : maxBalance), activeReportingDetails.bindingCapital > 1n ? activeReportingDetails.bindingCapital : 1n)
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = reportingDetails === undefined || selectedAmount === undefined ? undefined : previewReportingContribution(reportingDetails, reportingForm.selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const selectedEstimate = activeReportingDetails === undefined || selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, reportingForm.selectedOutcome, selectedAmount)
	const outcomeSides = getOutcomeSides({
		activeReportingDetails,
		selectedAmount,
	})
	const presetFallbackReason = reportingStatus === 'not-started' ? 'Escalation game has not started yet.' : 'Load reporting details before using presets.'
	const minimumOutcomeChangeContribution = activeReportingDetails === undefined ? { amount: undefined, reason: presetFallbackReason } : getMinimumOutcomeChangeContribution(activeReportingDetails, reportingForm.selectedOutcome)
	const maxProfitContribution = activeReportingDetails === undefined ? { amount: undefined, reason: presetFallbackReason } : getMaxProfitContribution(activeReportingDetails, reportingForm.selectedOutcome)
	const presetReasons = reportingLocked ? [] : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].filter((reason, index, reasons): reason is string => reason !== undefined && reasons.indexOf(reason) === index)
	const escalationTimeRemaining = activeReportingDetails === undefined ? formatDuration(ZERO_REP) : formatDuration(getEscalationTimeRemaining(activeReportingDetails))
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
	const reportGuardMessage = getReportingReportGuardMessage({
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		contributionPreviewReason: reportContributionPreview?.reason,
		isMainnet,
		lockedReason,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedAmount,
		viewerVaultAvailableEscalationRep: reportingDetails?.viewerVaultAvailableEscalationRep,
		viewerVaultExists: reportingDetails?.viewerVaultExists ?? false,
	})
	const withdrawGuardMessage = getReportingWithdrawGuardMessage({
		accountAddress: accountState.address,
		hasUserDepositsOnSelectedSide: (selectedSide?.userDeposits.length ?? 0) > 0,
		isMainnet,
		lockedReason,
		reportingStatus,
		withdrawalEnabled: activeReportingDetails?.withdrawalEnabled ?? false,
		withdrawalState: reportingDetails?.withdrawalState,
	})
	const reportingContextStatus = renderReportingContextStatus(effectiveCurrentTimestamp, marketDetails)

	const sections = (
		<>
			{showFullReporting ? (
				<EntityCard title='Reporting Context' variant='record' badge={activeReportingDetails === undefined ? undefined : <span className='badge ok'>{getEscalationPhase(activeReportingDetails)}</span>}>
					{showSecurityPoolAddressInput ? (
						<LookupFieldRow
							label='Security Pool Address'
							value={reportingForm.securityPoolAddress}
							onInput={securityPoolAddress => onReportingFormChange({ securityPoolAddress })}
							placeholder='0x...'
							action={
								<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || reportingLocked} title={reportingLocked ? lockedReason : undefined}>
									{loadingReportingDetails ? <LoadingText>Loading escalation...</LoadingText> : 'Refresh reporting'}
								</button>
							}
						/>
					) : undefined}
					{reportingContextStatus}

					{activeReportingDetails === undefined ? undefined : (
						<ul className='status-list hashes'>
							<li>
								<span>Escalation Game</span>
								<strong>
									<AddressValue address={activeReportingDetails.escalationGameAddress} />
								</strong>
							</li>
						</ul>
					)}
				</EntityCard>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock title='Outcome Sides' {...(activeReportingDetails === undefined ? {} : { description: 'Bars show total REP on each outcome. The marker shows current binding capital, and the thin inset shows your wallet stake.' })}>
					<div className='escalation-metrics'>
						<MetricField label='Current Bond'>
							<CurrencyValue value={activeReportingDetails?.currentRequiredBond ?? ZERO_REP} suffix='REP' />
						</MetricField>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={activeReportingDetails?.bindingCapital ?? ZERO_REP} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={activeReportingDetails?.nonDecisionThreshold ?? ZERO_REP} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{escalationTimeRemaining}</MetricField>
						<MetricField label='Game Start'>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.startingTime} />
						</MetricField>
						<MetricField label='Start Bond'>
							<CurrencyValue value={activeReportingDetails?.startBond ?? ZERO_REP} suffix='REP' />
						</MetricField>
					</div>
					<div className='escalation-sides-shell'>
						{activeReportingDetails === undefined ? undefined : (
							<div className='escalation-sides-legend'>
								<div className='escalation-sides-legend-item'>
									<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-total' />
									<span className='panel-label'>Total stake</span>
								</div>
								<div className='escalation-sides-legend-item'>
									<span aria-hidden='true' className='escalation-sides-legend-swatch escalation-sides-legend-swatch-user' />
									<span className='panel-label'>Your stake</span>
								</div>
								<div className='escalation-sides-legend-item escalation-sides-legend-item-binding'>
									<span aria-hidden='true' className='escalation-sides-legend-marker' />
									<span className='panel-label'>Binding capital</span>
									<CurrencyValue copyable={false} value={activeReportingDetails.bindingCapital} suffix='REP' />
								</div>
							</div>
						)}
					</div>
					<div className='escalation-sides'>
						{outcomeSides.map(side => (
							<EscalationSide key={side.key} bindingCapital={activeReportingDetails?.bindingCapital} chartScaleMax={chartScaleMax} estimate={side.estimate} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} />
						))}
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock title='Report Outcome'>
					{selectedSide === undefined ? undefined : (
						<p className='detail'>
							Selected side currently has <CurrencyValue value={selectedSide.balance} suffix='REP' /> deposited.
						</p>
					)}
					<p className='detail'>Reporting locks REP already deposited in your security vault. It does not spend wallet REP directly or require a wallet approval.</p>
					{reportingDetails?.viewerVaultAvailableEscalationRep === undefined ? undefined : (
						<p className='detail'>
							Available unlocked vault REP for reporting: <CurrencyValue value={reportingDetails.viewerVaultAvailableEscalationRep} suffix='REP' />.
						</p>
					)}
					<label className='field'>
						<span>Outcome Side</span>
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={reportingForm.selectedOutcome} onChange={selectedOutcome => onReportingFormChange({ selectedOutcome, selectedWithdrawDepositIndexes: [] })} disabled={reportingLocked} />
					</label>

					<label className='field'>
						<span>Report / Contribution Amount (REP)</span>
						<FormInput value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} disabled={reportingLocked} />
					</label>

					<div className='actions'>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (minimumOutcomeChangeContribution.amount === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(minimumOutcomeChangeContribution.amount) })
							}}
							disabled={reportingLocked || minimumOutcomeChangeContribution.amount === undefined}
							title={reportingLocked ? lockedReason : minimumOutcomeChangeContribution.reason}
						>
							Min to change proposed outcome
						</button>
						<button
							className='secondary'
							type='button'
							onClick={() => {
								if (maxProfitContribution.amount === undefined) return
								onReportingFormChange({ reportAmount: formatCurrencyInputBalance(maxProfitContribution.amount) })
							}}
							disabled={reportingLocked || maxProfitContribution.amount === undefined}
							title={reportingLocked ? lockedReason : maxProfitContribution.reason}
						>
							Max profit
						</button>
					</div>

					{presetReasons
						.filter(reason => !isPresetLoadReason(reason))
						.map(reason => (
							<p key={reason} className='detail'>
								{reason}
							</p>
						))}
					{reportAmountError === undefined ? undefined : <p className='detail'>{reportAmountError}</p>}

					{selectedEstimate === undefined ? undefined : (
						<p className='detail'>
							If {getReportingOutcomeLabel(reportingForm.selectedOutcome)} wins and no one else contributes afterward, the current amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit.
						</p>
					)}
					{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
						<p className='detail'>
							Based on the current escalation state, this action would lock <CurrencyValue value={actualReportDepositAmount} suffix='REP' /> instead of the full entered amount.
						</p>
					)}

					<div className='actions'>
						<TransactionActionButton
							idleLabel='Report / Contribute On Selected Side'
							pendingLabel='Submitting report...'
							onClick={onReportOutcome}
							pending={reportingActiveAction === 'reportOutcome'}
							status={reportingFeedback?.action === 'reportOutcome' ? reportingFeedback.status : undefined}
							availability={{ disabled: reportGuardMessage !== undefined, reason: reportGuardMessage }}
						/>
					</div>
				</SectionBlock>
			) : undefined}

			{showWithdrawOnly ? (
				<SectionBlock title='Withdraw Escalation Deposits'>
					{selectedSide === undefined ? undefined : selectedSide.userDeposits.length === 0 ? (
						<p className='detail'>Connected wallet has no unsettled deposits on the selected side.</p>
					) : activeReportingDetails?.withdrawalEnabled ? (
						<p className='detail'>
							Connected wallet has <strong>{selectedSide.userDeposits.length.toString()}</strong> withdrawable unsettled deposit {getDepositEntryCountLabel(selectedSide.userDeposits.length)} on the selected side.
						</p>
					) : (
						<p className='detail'>
							Connected wallet has <strong>{selectedSide.userDeposits.length.toString()}</strong> unsettled deposit {getDepositEntryCountLabel(selectedSide.userDeposits.length)} on the selected side, but withdrawals are not available yet.
						</p>
					)}
					{selectedSide === undefined || selectedSide.userDeposits.length === 0 ? undefined : (
						<div className='field'>
							<span>Choose deposits to withdraw</span>
							<p className='detail'>Leave all unchecked to withdraw every eligible deposit on this side.</p>
							<div>
								{selectedSide.userDeposits.map(deposit => {
									const isChecked = selectedWithdrawDepositIndexes.includes(deposit.depositIndex)
									return (
										<label key={deposit.depositIndex.toString()} className='detail'>
											<input
												type='checkbox'
												checked={isChecked}
												disabled={reportingLocked}
												onChange={event => {
													const nextSelectedWithdrawDepositIndexes = event.currentTarget.checked ? [...selectedWithdrawDepositIndexes, deposit.depositIndex] : selectedWithdrawDepositIndexes.filter(index => index !== deposit.depositIndex)
													onReportingFormChange({ selectedWithdrawDepositIndexes: nextSelectedWithdrawDepositIndexes })
												}}
											/>{' '}
											Deposit #{deposit.depositIndex.toString()} | Amount: <CurrencyValue value={deposit.amount} suffix='REP' /> | Cumulative at entry: <CurrencyValue value={deposit.cumulativeAmount} suffix='REP' />
										</label>
									)
								})}
							</div>
						</div>
					)}

					<div className='actions'>
						<TransactionActionButton
							idleLabel='Withdraw Escalation Deposits'
							pendingLabel='Withdrawing deposits...'
							onClick={onWithdrawEscalation}
							pending={reportingActiveAction === 'withdrawEscalation'}
							status={reportingFeedback?.action === 'withdrawEscalation' ? reportingFeedback.status : undefined}
							tone='secondary'
							availability={{ disabled: withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }}
						/>
					</div>
				</SectionBlock>
			) : undefined}

			<ErrorNotice message={reportingError} />
		</>
	)

	if (embedInCard) {
		return sections
	}

	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Reporting & Escalation'>
			{sections}
		</RouteWorkflowPanel>
	)
}
