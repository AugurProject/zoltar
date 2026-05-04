import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { EscalationSide } from './EscalationSide.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { formatDuration } from '../lib/formatters.js'
import { parseOptionalBigIntInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../types/components.js'

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
}: ReportingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const marketDetails = reportingDetails?.marketDetails ?? previewMarketDetails
	const effectiveCurrentTimestamp = reportingDetails?.currentTime ?? currentTimestamp
	const reportingLocked = lockedReason !== undefined
	const selectedAmount = parseOptionalBigIntInput(reportingForm.reportAmount)
	const totalBalance = reportingDetails === undefined ? 0n : reportingDetails.sides.reduce((sum, side) => sum + side.balance, 0n)
	const leadingOutcome = reportingDetails === undefined ? undefined : getLeadingEscalationOutcome(reportingDetails.sides)
	const selectedSide = reportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedEstimate = selectedSide === undefined || selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(selectedSide.balance, totalBalance, selectedAmount)
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
	const reportGuardMessage =
		lockedReason ??
		(accountState.address === undefined
			? 'Connect a wallet before reporting on a market.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before reporting on a market.'
				: reportingDetails === undefined
					? 'Load reporting details before reporting on an outcome.'
					: reportingForm.reportAmount.trim() === ''
						? 'Enter a report amount greater than zero.'
						: selectedAmount === undefined || selectedAmount <= 0n
							? 'Enter a valid report amount greater than zero.'
							: undefined)
	const withdrawGuardMessage =
		lockedReason ??
		(accountState.address === undefined
			? 'Connect a wallet before withdrawing escalation deposits.'
			: !isMainnet
				? 'Switch to Ethereum mainnet before withdrawing escalation deposits.'
				: reportingDetails === undefined
					? 'Load reporting details before withdrawing escalation deposits.'
					: selectedSide === undefined || selectedSide.userDeposits.length === 0
						? 'No deposits are available to withdraw on the selected side.'
						: undefined)
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

	const sections = (
		<>
			<SectionBlock title='Reporting Context'>
				{showSecurityPoolAddressInput ? (
					<label className='field'>
						<span>Security Pool Address</span>
						<input value={reportingForm.securityPoolAddress} onInput={event => onReportingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
					</label>
				) : undefined}

				<div className='actions'>
					<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails || reportingLocked} title={reportingLocked ? lockedReason : undefined}>
						{loadingReportingDetails ? <LoadingText>Loading escalation...</LoadingText> : 'Refresh reporting'}
					</button>
				</div>

				{marketDetails === undefined ? undefined : (
					<div className='workflow-metric-grid'>
						<MetricField label='Market End'>
							<TimestampValue timestamp={marketDetails.endTime} />
						</MetricField>
						{effectiveCurrentTimestamp === undefined ? undefined : <MetricField label='Reporting'>{marketDetails.endTime <= effectiveCurrentTimestamp ? 'Open' : 'Locked'}</MetricField>}
						{effectiveCurrentTimestamp === undefined || marketDetails.endTime <= effectiveCurrentTimestamp ? undefined : <MetricField label='Opens In'>{formatDuration(marketDetails.endTime - effectiveCurrentTimestamp)}</MetricField>}
					</div>
				)}

				{reportingDetails !== undefined || marketDetails === undefined ? undefined : (
					<SectionBlock headingLevel={4} title='Question' variant='embedded'>
						<Question question={marketDetails} />
					</SectionBlock>
				)}
			</SectionBlock>

			{reportingDetails === undefined ? undefined : (
				<EntityCard title='Loaded Escalation Game' variant='record' badge={<span className='badge ok'>{getEscalationPhase(reportingDetails)}</span>}>
					<ul className='status-list hashes'>
						<li>
							<span>Security Pool</span>
							<strong>
								<AddressValue address={reportingDetails.securityPoolAddress} />
							</strong>
						</li>
						<li>
							<span>Escalation Game</span>
							<strong>
								<AddressValue address={reportingDetails.escalationGameAddress} />
							</strong>
						</li>
						<li>
							<span>Universe</span>
							<strong>
								<UniverseLink universeId={reportingDetails.universeId} />
							</strong>
						</li>
						<li>
							<span>Market End</span>
							<strong>
								<TimestampValue timestamp={reportingDetails.marketDetails.endTime} />
							</strong>
						</li>
						<li>
							<span>Resolution</span>
							<strong>{getReportingOutcomeLabel(reportingDetails.resolution)}</strong>
						</li>
					</ul>
					<SectionBlock headingLevel={4} title='Question' variant='embedded'>
						<Question question={reportingDetails.marketDetails} />
					</SectionBlock>
				</EntityCard>
			)}

			{reportingDetails === undefined ? undefined : (
				<SectionBlock title='Escalation Metrics'>
					<div className='escalation-metrics'>
						<MetricField label='Current Bond'>
							<CurrencyValue value={reportingDetails.currentRequiredBond} suffix='REP' />
						</MetricField>
						<MetricField label='Binding Capital'>
							<CurrencyValue value={reportingDetails.bindingCapital} suffix='REP' />
						</MetricField>
						<MetricField label='Threshold'>
							<CurrencyValue value={reportingDetails.nonDecisionThreshold} suffix='REP' />
						</MetricField>
						<MetricField label='Time Left'>{formatDuration(getEscalationTimeRemaining(reportingDetails))}</MetricField>
					</div>
					<p className='detail'>
						Game starts at <TimestampValue timestamp={reportingDetails.startingTime} /> and currently uses a start bond of <CurrencyValue value={reportingDetails.startBond} suffix='REP' />.
					</p>
				</SectionBlock>
			)}

			{reportingDetails === undefined ? undefined : (
				<SectionBlock title='Outcome Sides'>
					<div className='escalation-sides'>
						{reportingDetails.sides.map(side => {
							const estimate = selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
							const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
							return <EscalationSide key={side.key} estimate={estimate} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} userStake={userStake} />
						})}
					</div>
				</SectionBlock>
			)}

			{latestReportingAction}

			<SectionBlock title='Report Outcome'>
				<label className='field'>
					<span>Outcome Side</span>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={reportingForm.selectedOutcome} onChange={selectedOutcome => onReportingFormChange({ selectedOutcome })} disabled={reportingLocked} />
				</label>

				<label className='field'>
					<span>Report / Contribution Amount</span>
					<input value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} disabled={reportingLocked} />
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

			<SectionBlock title='Withdraw Escalation Deposits'>
				<label className='field'>
					<span>Withdraw Deposit Indexes</span>
					<input value={reportingForm.withdrawDepositIndexes} onInput={event => onReportingFormChange({ withdrawDepositIndexes: event.currentTarget.value })} placeholder='Leave empty to withdraw all your deposits on the selected side' disabled={reportingLocked} />
				</label>

				<div className='actions'>
					<TransactionActionButton idleLabel='Withdraw Escalation Deposits' pendingLabel='Withdrawing deposits...' onClick={onWithdrawEscalation} pending={reportingActiveAction === 'withdrawEscalation'} tone='secondary' availability={{ disabled: withdrawGuardMessage !== undefined, reason: withdrawGuardMessage }} />
				</div>
			</SectionBlock>

			<ErrorNotice message={reportingError} />
		</>
	)

	if (embedInCard) {
		return sections
	}

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Reporting & Escalation</h2>
					</div>
				</div>
			) : undefined}

			<div className='workflow-stack route-workflow-stack'>{sections}</div>
		</section>
	)
}
