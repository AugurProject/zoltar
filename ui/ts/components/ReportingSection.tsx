import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { EscalationSide } from './EscalationSide.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { StateHint } from './StateHint.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getMaxProfitContribution, getMinimumOutcomeChangeContribution } from '../lib/reportingDomain.js'
import type { UserMessagePresentation } from '../lib/userCopy.js'
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
		balance: undefined,
		estimate: undefined,
		key: option.value,
		label: option.label,
		userDeposits: undefined,
		userStake: undefined,
	}))
}

function getOutcomeSidesHint(reportingStatus: ReportingStatus) {
	if (reportingStatus === 'missing') {
		return 'Load reporting details to populate live stakes, bond progression, and deposit indexes.'
	}
	if (reportingStatus === 'not-started') {
		return 'Escalation game has not started yet. The first report will populate live stakes, bond progression, and deposit indexes.'
	}
	return undefined
}

function getDepositEntryCountLabel(count: number) {
	return count === 1 ? 'entry' : 'entries'
}

function getReportingLockedPresentation({ effectiveCurrentTimestamp, marketDetails }: { effectiveCurrentTimestamp: bigint | undefined; marketDetails: ReportingSectionProps['previewMarketDetails'] }): UserMessagePresentation | undefined {
	if (effectiveCurrentTimestamp === undefined || marketDetails === undefined || marketDetails.endTime <= effectiveCurrentTimestamp) return undefined
	return {
		actionHint: `Reporting opens in ${formatDuration(marketDetails.endTime - effectiveCurrentTimestamp)}.`,
		detail: 'Reporting is not enabled at the moment.',
		key: 'action_needed',
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
	const selectedEstimate = activeReportingDetails === undefined || selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(activeReportingDetails, reportingForm.selectedOutcome, selectedAmount)
	const outcomeSides = getOutcomeSides({
		activeReportingDetails,
		selectedAmount,
	})
	const outcomeSidesHint = getOutcomeSidesHint(reportingStatus)
	const presetFallbackReason = reportingStatus === 'not-started' ? 'Escalation game has not started yet.' : 'Load reporting details before using presets.'
	const minimumOutcomeChangeContribution = activeReportingDetails === undefined ? { amount: undefined, reason: presetFallbackReason } : getMinimumOutcomeChangeContribution(activeReportingDetails, reportingForm.selectedOutcome)
	const maxProfitContribution = activeReportingDetails === undefined ? { amount: undefined, reason: presetFallbackReason } : getMaxProfitContribution(activeReportingDetails, reportingForm.selectedOutcome)
	const presetReasons = reportingLocked ? [] : [minimumOutcomeChangeContribution.reason, maxProfitContribution.reason].filter((reason, index, reasons): reason is string => reason !== undefined && reasons.indexOf(reason) === index)
	const escalationTimeRemaining = activeReportingDetails === undefined ? undefined : formatDuration(getEscalationTimeRemaining(activeReportingDetails))
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
	const reportGuardMessage = getReportingReportGuardMessage({
		accountAddress: accountState.address,
		isMainnet,
		lockedReason,
		reportAmount: reportingForm.reportAmount,
		reportingStatus,
		selectedAmount,
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
	const latestReportingAction =
		reportingResult === undefined ? undefined : (
			<LatestActionSection
				title='Latest Reporting Action'
				embedInCard={embedInCard}
				rows={[
					{ label: 'Action', value: reportingResult.action },
					{ label: 'Outcome', value: getReportingOutcomeLabel(reportingResult.outcome) },
					{ label: 'Pool', value: <AddressValue address={reportingResult.securityPoolAddress} /> },
					{ label: 'Universe', value: <UniverseLink universeId={reportingResult.universeId} /> },
					{ label: 'Transaction', value: <TransactionHashLink hash={reportingResult.hash} /> },
				]}
			/>
		)
	const reportingLockedPresentation = getReportingLockedPresentation({ effectiveCurrentTimestamp, marketDetails })
	const visibleLatestReportingAction = reportingResult === undefined ? undefined : showFullReporting ? (reportingResult.action === 'reportOutcome' ? latestReportingAction : undefined) : reportingResult.action === 'withdrawEscalation' ? latestReportingAction : undefined

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

					{marketDetails === undefined ? undefined : (
						<div className='workflow-metric-grid'>
							<MetricField label='Market End'>
								<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={marketDetails.endTime} />
							</MetricField>
							{effectiveCurrentTimestamp !== undefined && marketDetails.endTime <= effectiveCurrentTimestamp ? <MetricField label='Reporting'>Open</MetricField> : undefined}
						</div>
					)}
					{reportingLockedPresentation === undefined ? undefined : <StateHint presentation={reportingLockedPresentation} />}

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
							<CurrencyValue value={activeReportingDetails?.currentRequiredBond} suffix='REP' />
						</MetricField>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={activeReportingDetails?.bindingCapital} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={activeReportingDetails?.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{escalationTimeRemaining ?? '—'}</MetricField>
						<MetricField label='Game Start'>
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails?.startingTime} />
						</MetricField>
						<MetricField label='Start Bond'>
							<CurrencyValue value={activeReportingDetails?.startBond} suffix='REP' />
						</MetricField>
					</div>
					{outcomeSidesHint === undefined ? undefined : <p className='detail'>{outcomeSidesHint}</p>}
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

			{visibleLatestReportingAction}

			{showFullReporting ? (
				<SectionBlock title='Report Outcome'>
					{selectedSide === undefined ? undefined : (
						<p className='detail'>
							Selected side currently has <CurrencyValue value={selectedSide.balance} suffix='REP' /> deposited.
						</p>
					)}
					<label className='field'>
						<span>Outcome Side</span>
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={reportingForm.selectedOutcome} onChange={selectedOutcome => onReportingFormChange({ selectedOutcome, selectedWithdrawDepositIndexes: [] })} disabled={reportingLocked} />
					</label>

					<label className='field'>
						<span>Report / Contribution Amount</span>
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
