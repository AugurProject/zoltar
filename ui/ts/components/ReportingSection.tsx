import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LifecycleStageBanner } from './LifecycleStageBanner.js'
import { EscalationSide } from './EscalationSide.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { ResultBanner } from './ResultBanner.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatDuration } from '../lib/formatters.js'
import { parseOptionalRepAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '../lib/reportingGuards.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome } from '../lib/reportingDomain.js'
import type { LifecycleStagePresentation, ReportingSectionProps, WorkflowOutcomePresentation } from '../types/components.js'

function getReportingStagePresentation({ effectiveCurrentTimestamp, marketDetails, reportingDetails }: { effectiveCurrentTimestamp: bigint | undefined; marketDetails: ReportingSectionProps['previewMarketDetails']; reportingDetails: ReportingSectionProps['reportingDetails'] }): LifecycleStagePresentation | undefined {
	if (marketDetails === undefined) return undefined
	if (effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp < marketDetails.endTime) {
		return {
			availableActions: ['Monitor question end'],
			blockedActions: ['Report / Contribute', 'Withdraw escalation deposits'],
			detail: 'Reporting is still locked because the market end time has not passed yet.',
			key: 'reporting-locked',
			label: 'Pre-Reporting',
			tone: 'warning',
		}
	}

	const phase = reportingDetails === undefined || reportingDetails.status === 'not-started' ? 'Reporting Open' : getEscalationPhase(reportingDetails)
	return {
		availableActions: ['Report / Contribute', 'Withdraw escalation deposits'],
		blockedActions: [],
		detail: `The current escalation lifecycle phase is ${phase}. Contribution and withdrawal actions stay inline because side-by-side context matters.`,
		key: 'reporting-open',
		label: phase,
		tone: 'default',
	}
}

function getReportingOutcomePresentation(result: ReportingSectionProps['reportingResult']): WorkflowOutcomePresentation | undefined {
	if (result === undefined) return undefined
	if (result.action === 'reportOutcome') {
		return { title: 'Reporting contribution submitted', detail: `Contributed on the ${getReportingOutcomeLabel(result.outcome)} side.`, nextStep: 'Review the leading side and updated bond before contributing again.' }
	}
	return { title: 'Escalation deposits withdrawn', detail: `Withdrew deposits from the ${getReportingOutcomeLabel(result.outcome)} side.`, nextStep: 'Confirm the remaining deposits and whether any other sides are still withdrawable.' }
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
	const reportingStatus = reportingDetails === undefined ? 'missing' : reportingDetails.status
	const marketDetails = reportingDetails?.marketDetails ?? previewMarketDetails
	const effectiveCurrentTimestamp = reportingDetails?.currentTime ?? currentTimestamp
	const reportingLocked = lockedReason !== undefined
	const selectedAmount = parseOptionalRepAmountInput(reportingForm.reportAmount)
	const showFullReporting = mode === 'full-reporting'
	const showWithdrawOnly = mode === 'withdraw-only'
	const totalBalance = activeReportingDetails === undefined ? 0n : activeReportingDetails.sides.reduce((sum, side) => sum + side.balance, 0n)
	const leadingOutcome = activeReportingDetails === undefined ? undefined : getLeadingEscalationOutcome(activeReportingDetails.sides)
	const selectedSide = activeReportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedEstimate = selectedSide === undefined || selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(selectedSide.balance, totalBalance, selectedAmount)
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
	const visibleLatestReportingAction = reportingResult === undefined ? undefined : showFullReporting ? (reportingResult.action === 'reportOutcome' ? latestReportingAction : undefined) : reportingResult.action === 'withdrawEscalation' ? latestReportingAction : undefined
	const reportingStage = getReportingStagePresentation({ effectiveCurrentTimestamp, marketDetails, reportingDetails })
	const reportingOutcome = getReportingOutcomePresentation(reportingResult)

	const sections = (
		<>
			<ResultBanner outcome={reportingOutcome} />
			{showFullReporting && reportingStage !== undefined ? <LifecycleStageBanner stage={reportingStage} /> : undefined}
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
							{effectiveCurrentTimestamp === undefined ? undefined : <MetricField label='Reporting'>{marketDetails.endTime <= effectiveCurrentTimestamp ? 'Open' : 'Locked'}</MetricField>}
							{effectiveCurrentTimestamp === undefined || marketDetails.endTime <= effectiveCurrentTimestamp ? undefined : <MetricField label='Opens In'>{formatDuration(marketDetails.endTime - effectiveCurrentTimestamp)}</MetricField>}
						</div>
					)}

					{reportingDetails === undefined ? undefined : (
						<ul className='status-list hashes'>
							<li>
								<span>Security Pool</span>
								<strong>
									<AddressValue address={reportingDetails.securityPoolAddress} />
								</strong>
							</li>
							{activeReportingDetails === undefined ? undefined : (
								<li>
									<span>Escalation Game</span>
									<strong>
										<AddressValue address={activeReportingDetails.escalationGameAddress} />
									</strong>
								</li>
							)}
							<li>
								<span>Universe</span>
								<strong>
									<UniverseLink universeId={reportingDetails.universeId} />
								</strong>
							</li>
							<li>
								<span>Resolution</span>
								<strong>{getReportingOutcomeLabel(reportingDetails.resolution)}</strong>
							</li>
						</ul>
					)}
				</EntityCard>
			) : undefined}

			{showFullReporting && reportingDetails?.status === 'not-started' ? (
				<SectionBlock title='Escalation Status'>
					<p className='detail'>Reporting is open, but the escalation game has not started yet.</p>
					<p className='detail'>The first report or contribution will deploy and initialize the escalation game for this pool.</p>
				</SectionBlock>
			) : undefined}

			{showFullReporting && activeReportingDetails !== undefined ? (
				<SectionBlock title='Escalation Metrics'>
					<div className='escalation-metrics'>
						<MetricField label='Current Bond'>
							<CurrencyValue value={activeReportingDetails.currentRequiredBond} suffix='REP' />
						</MetricField>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={activeReportingDetails.bindingCapital} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={activeReportingDetails.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{formatDuration(getEscalationTimeRemaining(activeReportingDetails))}</MetricField>
					</div>
					<p className='detail'>
						Game starts at <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={activeReportingDetails.startingTime} /> and currently uses a start bond of <CurrencyValue value={activeReportingDetails.startBond} suffix='REP' />.
					</p>
				</SectionBlock>
			) : undefined}

			{showFullReporting && activeReportingDetails !== undefined ? (
				<SectionBlock title='Outcome Sides'>
					<div className='escalation-sides'>
						{activeReportingDetails.sides.map(side => {
							const estimate = selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
							const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
							return <EscalationSide key={side.key} estimate={estimate} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} userStake={userStake} />
						})}
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
						<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={reportingForm.selectedOutcome} onChange={selectedOutcome => onReportingFormChange({ selectedOutcome })} disabled={reportingLocked} />
					</label>

					<label className='field'>
						<span>Report / Contribution Amount</span>
						<FormInput value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} disabled={reportingLocked} />
					</label>

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
					{selectedSide === undefined ? undefined : (
						<p className='detail'>
							Selected side has <strong>{selectedSide.userDeposits.length.toString()}</strong> withdrawable deposit entries for the connected wallet.
						</p>
					)}
					<label className='field'>
						<span>Withdraw Deposit Indexes</span>
						<FormInput value={reportingForm.withdrawDepositIndexes} onInput={event => onReportingFormChange({ withdrawDepositIndexes: event.currentTarget.value })} placeholder='Leave empty to withdraw all your deposits on the selected side' disabled={reportingLocked} />
					</label>

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
