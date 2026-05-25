import { useEffect, useRef } from 'preact/hooks'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { TimestampValue } from './TimestampValue.js'
import { UniverseLink } from './UniverseLink.js'
import { WorkflowTransactionStatus } from './WorkflowTransactionStatus.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, getReportingTimerPreview, previewReportingContribution } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import type { LifecycleStagePresentation, ReportingSectionProps, WorkflowOutcomePresentation } from '../types/components.js'
import type { EscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'

type ReportingStatus = 'active' | 'missing' | 'not-started'

type EscalationSideDisplay = {
	balance: bigint | undefined
	key: ReportingOutcomeKey
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}

const MAX_PROFIT_NOT_STARTED_REASON = 'Max profit becomes available after the escalation game starts.'
const LOAD_REPORTING_PRESETS_REASON = 'Load reporting details before using presets.'
const SELECT_OUTCOME_PRESET_REASON = 'Select an outcome side before using presets.'
const SELECTED_SIDE_ALREADY_LEADS_REASON = 'Selected side already leads.'
const MAX_PROFIT_WINDOW_FILLED_REASON = 'Max profit preset unavailable because the reward window is already filled on the selected side.'

function getOutcomeSides(reportingDetails: ReportingDetails | undefined) {
	if (reportingDetails?.status === 'active') {
		return reportingDetails.sides.map<EscalationSideDisplay>(side => ({
			balance: side.balance,
			key: side.key,
			label: side.label,
			userDeposits: side.userDeposits,
			userStake: side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n),
		}))
	}

	if (reportingDetails?.status === 'not-started') {
		return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
			balance: 0n,
			key: option.value,
			label: option.label,
			userDeposits: [],
			userStake: 0n,
		}))
	}

	return REPORTING_OUTCOME_DROPDOWN_OPTIONS.map<EscalationSideDisplay>(option => ({
		balance: undefined,
		key: option.value,
		label: option.label,
		userDeposits: undefined,
		userStake: undefined,
	}))
}

function getDepositEntryCountLabel(count: number) {
	return count === 1 ? 'entry' : 'entries'
}

function isHiddenPresetReason(reason: string | undefined) {
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === MAX_PROFIT_NOT_STARTED_REASON || reason === SELECT_OUTCOME_PRESET_REASON || reason === SELECTED_SIDE_ALREADY_LEADS_REASON || reason === MAX_PROFIT_WINDOW_FILLED_REASON
}

function getReportingStagePresentation({
	effectiveCurrentTimestamp,
	marketDetails,
	reportingDetails,
}: {
	effectiveCurrentTimestamp: bigint | undefined
	marketDetails: ReportingDetails['marketDetails'] | ReportingSectionProps['previewMarketDetails']
	reportingDetails: ReportingDetails | undefined
}): LifecycleStagePresentation | undefined {
	if (effectiveCurrentTimestamp === undefined || marketDetails === undefined) return undefined

	if (marketDetails.endTime > effectiveCurrentTimestamp) {
		return {
			availableActions: [],
			blockedActions: ['report'],
			detail: 'Reporting opens after the market end timestamp for this pool.',
			key: 'reporting-not-enabled',
			label: 'Reporting Not Enabled',
			tone: 'warning',
		}
	}

	if (reportingDetails === undefined) {
		return {
			availableActions: [],
			blockedActions: [],
			detail: 'Load reporting details to view the escalation state for this pool.',
			key: 'reporting-open',
			label: 'Reporting Open',
			tone: 'default',
		}
	}

	if (reportingDetails.status === 'not-started') {
		return undefined
	}

	switch (getEscalationPhase(reportingDetails)) {
		case 'Pending Start':
			return undefined
		case 'Active':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation is live. Review the bond, side balances, and time remaining before contributing or withdrawing.',
				key: 'escalation-active',
				label: 'Active',
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation reached non-decision. Continue in the Fork workflow; this panel does not have a final-resolution action.',
				key: 'escalation-fork-triggered',
				label: 'Fork Triggered',
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation ended by timeout. The winner is computed from the current stakes; refresh reporting if the resolved outcome is not loaded yet.',
				key: 'escalation-timed-out',
				label: 'Timed Out',
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation has resolved. Review the final state and any remaining deposits below.',
				key: 'escalation-resolved',
				label: 'Resolved',
				tone: 'success',
			}
	}
}

function getReportingOutcomePresentation(action: ReportingSectionProps['reportingResult']): WorkflowOutcomePresentation | undefined {
	if (action === undefined) return undefined

	switch (action.action) {
		case 'reportOutcome':
			return undefined
		case 'withdrawEscalation':
			return {
				detail: 'Eligible escalation deposits were withdrawn for the selected outcome side.',
				nextStep: 'Review the updated escalation balances before taking another reporting action.',
				title: 'Escalation Deposits Withdrawn',
			}
	}
}

function getEffectiveReportingDetails(reportingDetails: ReportingDetails | undefined, currentTimestamp: bigint | undefined) {
	if (reportingDetails === undefined || currentTimestamp === undefined || reportingDetails.currentTime === currentTimestamp) {
		return reportingDetails
	}

	return {
		...reportingDetails,
		currentTime: currentTimestamp,
	}
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
	reportingForm,
	reportingResult,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	mode = 'full-reporting',
}: ReportingSectionProps) {
	const lastTimedOutRefreshBoundaryKey = useRef<string | undefined>(undefined)
	const isMainnet = isMainnetChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? reportingDetails?.currentTime
	const effectiveReportingDetails = getEffectiveReportingDetails(reportingDetails, effectiveCurrentTimestamp)
	const activeReportingDetails = effectiveReportingDetails?.status === 'active' ? effectiveReportingDetails : undefined
	const escalationPhase = activeReportingDetails === undefined ? undefined : getEscalationPhase(activeReportingDetails)
	const reportingStatus: ReportingStatus = effectiveReportingDetails === undefined ? 'missing' : effectiveReportingDetails.status
	const marketDetails = effectiveReportingDetails?.marketDetails ?? previewMarketDetails
	const reportingLocked = lockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const selectedOutcome = reportingForm.selectedOutcome
	const selectedSide = selectedOutcome === undefined ? undefined : activeReportingDetails?.sides.find(side => side.key === selectedOutcome)
	const selectedWithdrawDepositIndexes = reportingForm.selectedWithdrawDepositIndexes
	const displayBindingCapital = effectiveReportingDetails === undefined ? undefined : effectiveReportingDetails.status === 'not-started' ? 0n : effectiveReportingDetails.bindingCapital
	const outcomeSides = getOutcomeSides(effectiveReportingDetails)
	const chartScaleMax = outcomeSides.reduce(
		(maxBalance, side) => {
			if (side.balance === undefined || side.balance <= maxBalance) return maxBalance
			return side.balance
		},
		displayBindingCapital !== undefined && displayBindingCapital > 1n ? displayBindingCapital : 1n,
	)
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides)
	const reportContributionPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : previewReportingContribution(effectiveReportingDetails, selectedOutcome, selectedAmount)
	const actualReportDepositAmount = reportContributionPreview?.actualDepositAmount
	const selectedEstimate = activeReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, selectedOutcome, selectedAmount)
	const timerPreview = effectiveReportingDetails === undefined || selectedAmount === undefined || selectedOutcome === undefined ? undefined : getReportingTimerPreview(effectiveReportingDetails, selectedOutcome, selectedAmount, effectiveCurrentTimestamp)
	const selectedOutcomeLabel = selectedOutcome === undefined ? 'Selected Side' : (outcomeSides.find(side => side.key === selectedOutcome)?.label ?? getReportingOutcomeLabel(selectedOutcome))
	const reportButtonLabel = selectedOutcome === undefined ? 'Report / Contribute On Selected Side' : `Report / Contribute ${selectedOutcomeLabel}`
	const minimumOutcomeChangeContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMinimumOutcomeChangeContribution(effectiveReportingDetails, selectedOutcome)
	const maxProfitContribution = selectedOutcome === undefined ? { amount: undefined, reason: SELECT_OUTCOME_PRESET_REASON } : getReportingMaxProfitContribution(effectiveReportingDetails, selectedOutcome)
	const presetReasons = reportingLocked ? [] : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].filter((reason, index, reasons): reason is string => reason !== undefined && !isHiddenPresetReason(reason) && reasons.indexOf(reason) === index)
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
	const reportGuardMessage = getReportingReportGuardMessage({
		actualDepositAmount: actualReportDepositAmount,
		accountAddress: accountState.address,
		contributionPreviewReason: reportContributionPreview?.reason,
		isMainnet,
		lockedReason,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedOutcome,
		selectedAmount,
		viewerVaultAvailableEscalationRep: effectiveReportingDetails?.viewerVaultAvailableEscalationRep,
		viewerVaultExists: effectiveReportingDetails?.viewerVaultExists ?? false,
		...(activeReportingDetails === undefined ? {} : { activeReportingDetails }),
	})
	const withdrawGuardMessage = getReportingWithdrawGuardMessage({
		accountAddress: accountState.address,
		hasUserDepositsOnSelectedSide: (selectedSide?.userDeposits.length ?? 0) > 0,
		isMainnet,
		lockedReason,
		reportingStatus,
		withdrawalEnabled: activeReportingDetails?.withdrawalEnabled ?? false,
		withdrawalState: effectiveReportingDetails?.withdrawalState,
		selectedOutcome,
		...(activeReportingDetails === undefined ? {} : { activeReportingDetails }),
	})
	const reportingOpenNotice = showFullReporting && reportingStatus === 'not-started' ? 'Reporting is open.' : undefined

	useEffect(() => {
		if (activeReportingDetails === undefined) return
		if (escalationPhase !== 'Timed Out') return
		if (loadingReportingDetails) return
		if (activeReportingDetails.resolution !== 'none' || activeReportingDetails.hasReachedNonDecision) return

		const refreshBoundaryKey = `${activeReportingDetails.securityPoolAddress}:${activeReportingDetails.escalationEndTime.toString()}`
		if (lastTimedOutRefreshBoundaryKey.current === refreshBoundaryKey) return

		lastTimedOutRefreshBoundaryKey.current = refreshBoundaryKey
		void onLoadReporting()
	}, [activeReportingDetails, escalationPhase, loadingReportingDetails, onLoadReporting])
	const reportingStage = showFullReporting
		? getReportingStagePresentation({
				effectiveCurrentTimestamp,
				marketDetails,
				reportingDetails: effectiveReportingDetails,
			})
		: undefined
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStage !== undefined || reportingOpenNotice !== undefined)
	const latestReportingAction =
		reportingResult === undefined
			? undefined
			: {
					title: 'Latest Reporting Action',
					embedInCard,
					rows: [
						{ label: 'Action', value: reportingResult.action },
						{ label: 'Outcome', value: getReportingOutcomeLabel(reportingResult.outcome) },
						{ label: 'Pool', value: <AddressValue address={reportingResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={reportingResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={reportingResult.hash} /> },
					],
				}
	const reportingOutcome = getReportingOutcomePresentation(reportingResult)

	const sections = (
		<>
			<WorkflowTransactionStatus latestAction={latestReportingAction} outcome={reportingOutcome} />
			{showReportingHeaderStack ? (
				<div className='reporting-header-stack'>
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
					{reportingOpenNotice === undefined ? <LifecycleStageBanner stage={reportingStage} /> : <p className='notice'>{reportingOpenNotice}</p>}
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock title='Escalation Metrics'>
					<div className='escalation-metrics'>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={displayBindingCapital} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={effectiveReportingDetails?.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{activeReportingDetails === undefined ? '—' : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label='Game Start'>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.startingTime} />
						</MetricField>
						<MetricField label='Start Bond'>
							<CurrencyValue value={effectiveReportingDetails?.startBond} suffix='REP' />
						</MetricField>
					</div>
				</SectionBlock>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock title='Report Outcome'>
					<div className='escalation-sides-shell'>
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
								<CurrencyValue copyable={false} value={displayBindingCapital} suffix='REP' />
							</div>
						</div>
						<div className='escalation-sides'>
							{outcomeSides.map(side => (
								<EscalationSide
									key={side.key}
									bindingCapital={displayBindingCapital}
									chartScaleMax={chartScaleMax}
									disabled={reportingLocked}
									isLeading={leadingOutcome === side.key}
									isSelected={selectedOutcome !== undefined && selectedOutcome === side.key}
									onSelect={() => onReportingFormChange({ selectedOutcome: side.key, selectedWithdrawDepositIndexes: [] })}
									side={side}
								/>
							))}
						</div>
					</div>
					{effectiveReportingDetails?.viewerVaultAvailableEscalationRep === undefined ? undefined : (
						<p className='detail'>
							Available unlocked vault REP for reporting: <CurrencyValue value={effectiveReportingDetails.viewerVaultAvailableEscalationRep} suffix='REP' />.
						</p>
					)}
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

					{presetReasons.map(reason => (
						<p key={reason} className='detail'>
							{reason}
						</p>
					))}
					{reportAmountError === undefined ? undefined : <p className='detail'>{reportAmountError}</p>}
					{selectedEstimate === undefined || selectedOutcome === undefined ? undefined : (
						<p className='detail'>
							If {selectedOutcomeLabel} wins and no one else contributes afterward, the current amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit.
						</p>
					)}
					{actualReportDepositAmount === undefined || selectedAmount === undefined || actualReportDepositAmount === selectedAmount ? undefined : (
						<p className='detail'>
							Based on the current escalation state, this action would lock <CurrencyValue value={actualReportDepositAmount} suffix='REP' /> instead of the full entered amount.
						</p>
					)}
					<div className='actions'>
						<TransactionActionButton idleLabel={reportButtonLabel} pendingLabel='Submitting report...' onClick={onReportOutcome} pending={reportingActiveAction === 'reportOutcome'} availability={{ disabled: reportGuardMessage !== undefined, reason: reportGuardMessage }} />
					</div>
					{timerPreview === undefined ? undefined : timerPreview.kind === 'not-started' ? (
						<>
							<p className='detail'>This contribution would start the escalation timer at {timerPreview.startsAt === undefined ? 'immediately' : <TimestampValue currentTimestamp={timerPreview.startsAt} timestamp={timerPreview.startsAt} />}.</p>
							<p className='detail'>
								If <CurrencyValue copyable={false} value={selectedAmount} suffix='REP' /> became binding capital, the dispute window would last {formatDuration(timerPreview.hypotheticalDuration)} from game start.
							</p>
						</>
					) : (
						<>
							<p className='detail'>
								{timerPreview.actualState === 'ends-immediately'
									? 'This contribution would end the escalation immediately instead of extending the timer.'
									: timerPreview.actualState === 'extends'
										? `This contribution would extend the timer by ${formatDuration(timerPreview.timerIncrease ?? 0n)}.`
										: 'This contribution would not extend the timer.'}
							</p>
							<p className='detail'>
								If <CurrencyValue copyable={false} value={selectedAmount} suffix='REP' /> became binding capital, the dispute window would last {formatDuration(timerPreview.hypotheticalDuration)} from game start.
							</p>
						</>
					)}
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
						<TransactionActionButton idleLabel='Withdraw Escalation Deposits' pendingLabel='Withdrawing deposits...' onClick={onWithdrawEscalation} pending={reportingActiveAction === 'withdrawEscalation'} tone='secondary' availability={{ disabled: withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }} />
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
