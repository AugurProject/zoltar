import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { EntityCard } from './EntityCard.js'
import { ErrorNotice } from './ErrorNotice.js'
import { EscalationSide } from './EscalationSide.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
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
	embedInCard = false,
	loadingReportingDetails,
	onLoadReporting,
	onReportOutcome,
	onReportingFormChange,
	onWithdrawEscalation,
	reportingDetails,
	reportingError,
	reportingForm,
	reportingResult,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: ReportingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedAmount = parseOptionalBigIntInput(reportingForm.reportAmount)
	const totalBalance = reportingDetails === undefined ? 0n : reportingDetails.sides.reduce((sum, side) => sum + side.balance, 0n)
	const leadingOutcome = reportingDetails === undefined ? undefined : getLeadingEscalationOutcome(reportingDetails.sides)
	const selectedSide = reportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedEstimate = selectedSide === undefined || selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(selectedSide.balance, totalBalance, selectedAmount)
	const reportAmountError = selectedAmount === undefined && reportingForm.reportAmount.trim() !== '' ? 'Enter a valid report amount to preview profit.' : undefined
	const loadedEscalationGame =
		reportingDetails === undefined ? undefined : embedInCard ? (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Loaded Escalation Game</h4>
					<span className='badge ok'>{getEscalationPhase(reportingDetails)}</span>
				</div>
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
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Question</h4>
					</div>
					<Question question={reportingDetails.marketDetails} />
				</div>
			</div>
		) : (
			<EntityCard title='Loaded Escalation Game' badge={<span className='badge ok'>{getEscalationPhase(reportingDetails)}</span>}>
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
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Question</h4>
					</div>
					<Question question={reportingDetails.marketDetails} />
				</div>
			</EntityCard>
		)
	const escalationMetrics =
		reportingDetails === undefined ? undefined : embedInCard ? (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Escalation Metrics</h4>
					<span className='badge muted'>status</span>
				</div>
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
			</div>
		) : (
			<EntityCard title='Escalation Metrics' badge={<span className='badge muted'>status</span>}>
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
			</EntityCard>
		)
	const escalationSides =
		reportingDetails === undefined ? undefined : embedInCard ? (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Outcome Sides</h4>
				</div>
				<div className='escalation-sides'>
					{reportingDetails.sides.map(side => {
						const estimate = selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
						const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
						return <EscalationSide key={side.key} estimate={estimate} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} userStake={userStake} />
					})}
				</div>
			</div>
		) : (
			<div className='escalation-sides'>
				{reportingDetails.sides.map(side => {
					const estimate = selectedAmount === undefined ? undefined : calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
					const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
					return <EscalationSide key={side.key} estimate={estimate} isLeading={leadingOutcome === side.key} isSelected={reportingForm.selectedOutcome === side.key} side={side} userStake={userStake} />
				})}
			</div>
		)
	const latestReportingAction =
		reportingResult === undefined ? undefined : embedInCard ? (
			<div className='entity-card-subsection'>
				<div className='entity-card-subsection-header'>
					<h4>Latest Reporting Action</h4>
					<span className='badge ok'>{getReportingOutcomeLabel(reportingResult.outcome)}</span>
				</div>
				<p className='detail'>Action: {reportingResult.action}</p>
				<p className='detail'>Outcome: {getReportingOutcomeLabel(reportingResult.outcome)}</p>
				<p className='detail'>
					Pool: <AddressValue address={reportingResult.securityPoolAddress} />
				</p>
				<p className='detail'>
					Universe: <UniverseLink universeId={reportingResult.universeId} />
				</p>
				<p className='detail'>
					Transaction: <TransactionHashLink hash={reportingResult.hash} />
				</p>
			</div>
		) : (
			<EntityCard title='Latest Reporting Action' badge={<span className='badge ok'>{getReportingOutcomeLabel(reportingResult.outcome)}</span>}>
				<p className='detail'>Action: {reportingResult.action}</p>
				<p className='detail'>Outcome: {getReportingOutcomeLabel(reportingResult.outcome)}</p>
				<p className='detail'>
					Pool: <AddressValue address={reportingResult.securityPoolAddress} />
				</p>
				<p className='detail'>
					Universe: <UniverseLink universeId={reportingResult.universeId} />
				</p>
				<p className='detail'>
					Transaction: <TransactionHashLink hash={reportingResult.hash} />
				</p>
			</EntityCard>
		)
	const actionsSection = (
		<div className='form-grid'>
			{showSecurityPoolAddressInput ? (
				<label className='field'>
					<span>Security Pool Address</span>
					<input value={reportingForm.securityPoolAddress} onInput={event => onReportingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
				</label>
			) : undefined}

			<div className='actions'>
				<button className='secondary' onClick={onLoadReporting} disabled={loadingReportingDetails}>
					{loadingReportingDetails ? <LoadingText>Loading escalation...</LoadingText> : 'Refresh reporting'}
				</button>
			</div>

			<label className='field'>
				<span>Outcome Side</span>
				<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={reportingForm.selectedOutcome} onChange={selectedOutcome => onReportingFormChange({ selectedOutcome })} />
			</label>

			<label className='field'>
				<span>Report / Contribution Amount</span>
				<input value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} />
			</label>

			{reportAmountError === undefined ? undefined : <p className='detail'>{reportAmountError}</p>}

			{selectedEstimate === undefined ? undefined : (
				<p className='detail'>
					If {getReportingOutcomeLabel(reportingForm.selectedOutcome)} wins and no one else contributes afterward, the current amount projects roughly <CurrencyValue value={selectedEstimate.profit} suffix='REP' /> of profit.
				</p>
			)}

			<div className='actions'>
				<button className='primary' onClick={onReportOutcome} disabled={accountState.address === undefined || !isMainnet}>
					Report / Contribute On Selected Side
				</button>
			</div>

			<label className='field'>
				<span>Withdraw Deposit Indexes</span>
				<input value={reportingForm.withdrawDepositIndexes} onInput={event => onReportingFormChange({ withdrawDepositIndexes: event.currentTarget.value })} placeholder='Leave empty to withdraw all your deposits on the selected side' />
			</label>

			<div className='actions'>
				<button className='secondary' onClick={onWithdrawEscalation} disabled={accountState.address === undefined || !isMainnet}>
					Withdraw Escalation Deposits
				</button>
			</div>
		</div>
	)

	if (embedInCard) {
		return (
			<>
				{loadedEscalationGame}
				{escalationMetrics}
				{escalationSides}
				{latestReportingAction}
				<div className='entity-card-subsection'>
					<div className='entity-card-subsection-header'>
						<h4>Actions</h4>
						<span className='badge muted'>manage</span>
					</div>
					{actionsSection}
				</div>
				<ErrorNotice message={reportingError} />
			</>
		)
	}

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Reporting & Escalation</h2>
						<p className='detail'>Open a pool after market end to report on Invalid, Yes, or No.</p>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				<div className='market-column'>
					{loadedEscalationGame}
					{escalationMetrics}
					{escalationSides}
					{latestReportingAction}
				</div>

				<div className='market-column'>
					<EntityCard title='Resolution Actions' badge={<span className='badge muted'>manage</span>}>
						{actionsSection}
					</EntityCard>

					<ErrorNotice message={reportingError} />
				</div>
			</div>
		</section>
	)
}
