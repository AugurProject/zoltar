import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
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
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getReportingMaxProfitContribution, getReportingMinimumOutcomeChangeContribution, previewReportingContribution } from '../lib/reportingDomain.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import type { LifecycleStagePresentation, ReportingSectionProps, WorkflowOutcomePresentation } from '../types/components.js'
import type { ActiveReportingDetails, EscalationDeposit, ReportingDetails, ReportingOutcomeKey } from '../types/contracts.js'

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
const SELECTED_SIDE_ALREADY_LEADS_REASON = 'Selected side already leads.'
const MAX_PROFIT_WINDOW_FILLED_REASON = 'Max profit preset unavailable because the reward window is already filled on the selected side.'

function getOutcomeSides(activeReportingDetails: ActiveReportingDetails | undefined) {
	if (activeReportingDetails !== undefined) {
		return activeReportingDetails.sides.map<EscalationSideDisplay>(side => ({
			balance: side.balance,
			key: side.key,
			label: side.label,
			userDeposits: side.userDeposits,
			userStake: side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n),
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
	return reason === LOAD_REPORTING_PRESETS_REASON || reason === MAX_PROFIT_NOT_STARTED_REASON || reason === SELECTED_SIDE_ALREADY_LEADS_REASON || reason === MAX_PROFIT_WINDOW_FILLED_REASON
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
		return {
			availableActions: ['first-report'],
			blockedActions: [],
			detail: 'This pool does not have an escalation game yet. The first report or contribution will deploy it.',
			key: 'first-report-starts-escalation',
			label: 'First Report Starts Escalation',
			tone: 'default',
		}
	}

	switch (getEscalationPhase(reportingDetails)) {
		case 'Pending Start':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'The escalation game has been initialized and will start at the scheduled start time.',
				key: 'escalation-pending-start',
				label: 'Pending Start',
				tone: 'default',
			}
		case 'Active':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation is live. Review the bond, side balances, and time remaining before contributing or withdrawing.',
				key: 'escalation-active',
				label: 'Active',
				tone: 'default',
			}
		case 'Awaiting Resolution':
			return {
				availableActions: [],
				blockedActions: [],
				detail: 'Escalation has reached its end time and is waiting for final resolution.',
				key: 'escalation-awaiting-resolution',
				label: 'Awaiting Resolution',
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
			return {
				detail: 'The selected escalation outcome received your report or contribution.',
				nextStep: 'Monitor the escalation state and withdraw eligible deposits when the workflow allows it.',
				title: 'Reporting Contribution Submitted',
			}
		case 'withdrawEscalation':
			return {
				detail: 'Eligible escalation deposits were withdrawn for the selected outcome side.',
				nextStep: 'Review the updated escalation balances before taking another reporting action.',
				title: 'Escalation Deposits Withdrawn',
			}
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
	const outcomeSides = getOutcomeSides(activeReportingDetails)
	const minimumOutcomeChangeContribution = getReportingMinimumOutcomeChangeContribution(reportingDetails, reportingForm.selectedOutcome)
	const maxProfitContribution = getReportingMaxProfitContribution(reportingDetails, reportingForm.selectedOutcome)
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
	const reportingStage = showFullReporting
		? getReportingStagePresentation({
				effectiveCurrentTimestamp,
				marketDetails,
				reportingDetails,
			})
		: undefined
	const showReportingHeaderStack = showFullReporting && (showSecurityPoolAddressInput || reportingStage !== undefined)
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
					<LifecycleStageBanner stage={reportingStage} />
				</div>
			) : undefined}

			{showFullReporting ? (
				<SectionBlock title='Outcome Sides' {...(activeReportingDetails === undefined ? {} : { description: 'Bars show total REP on each outcome. The marker shows current binding capital, and the thin inset shows your wallet stake.' })}>
					<div className='escalation-metrics'>
						<MetricField label='Current Bond'>
							<CurrencyValue value={activeReportingDetails?.currentRequiredBond} suffix='REP' />
						</MetricField>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={activeReportingDetails?.bindingCapital} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={reportingDetails?.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{activeReportingDetails === undefined ? '—' : formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
						<MetricField label='Game Start'>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.startingTime} />
						</MetricField>
						<MetricField label='Start Bond'>
							<CurrencyValue value={reportingDetails?.startBond} suffix='REP' />
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
							<EscalationSide key={side.key} bindingCapital={activeReportingDetails?.bindingCapital} chartScaleMax={chartScaleMax} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} />
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

					{presetReasons.map(reason => (
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
						<TransactionActionButton idleLabel='Report / Contribute On Selected Side' pendingLabel='Submitting report...' onClick={onReportOutcome} pending={reportingActiveAction === 'reportOutcome'} availability={{ disabled: reportGuardMessage !== undefined, reason: reportGuardMessage }} />
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
