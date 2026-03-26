import { formatCurrencyBalance, formatDuration, formatTimestamp } from '../lib/formatters.js'
import { parseReportingOutcomeInput } from '../lib/inputs.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome, getReportingOutcomeLabel, REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import type { ReportingSectionProps } from '../types/components.js'

function parseOptionalBigInt(value: string) {
	try {
		return value.trim() === '' ? 0n : BigInt(value)
	} catch {
		return 0n
	}
}

export function ReportingSection({ accountState, loadingReportingDetails, onLoadReporting, onReportOutcome, onReportingFormChange, onWithdrawEscalation, reportingDetails, reportingError, reportingForm, reportingResult }: ReportingSectionProps) {
	const selectedAmount = parseOptionalBigInt(reportingForm.reportAmount)
	const totalBalance = reportingDetails === undefined ? 0n : reportingDetails.sides.reduce((sum, side) => sum + side.balance, 0n)
	const leadingOutcome = reportingDetails === undefined ? undefined : getLeadingEscalationOutcome(reportingDetails.sides)
	const selectedSide = reportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedEstimate = selectedSide === undefined ? undefined : calculateEstimatedEscalationReturn(selectedSide.balance, totalBalance, selectedAmount)

	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Reporting & Escalation</p>
					<h2>Report a market outcome and participate in escalation</h2>
					<p class="detail">Load a binary market’s security pool after the market has ended. Reporting is done by staking REP on Invalid, Yes, or No through the pool’s escalation game.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					{reportingDetails === undefined ? null : (
						<>
							<div class="status-card">
								<p class="panel-label">Loaded Escalation Game</p>
								<ul class="status-list hashes">
									<li>
										<span>Security Pool</span>
										<strong>{reportingDetails.securityPoolAddress}</strong>
									</li>
									<li>
										<span>Escalation Game</span>
										<strong>{reportingDetails.escalationGameAddress}</strong>
									</li>
									<li>
										<span>Market ID</span>
										<strong>{reportingDetails.marketDetails.questionId}</strong>
									</li>
									<li>
										<span>Market Title</span>
										<strong>{reportingDetails.marketDetails.title}</strong>
									</li>
									<li>
										<span>Market End</span>
										<strong>{formatTimestamp(reportingDetails.marketDetails.endTime)}</strong>
									</li>
									<li>
										<span>Phase</span>
										<strong>{getEscalationPhase(reportingDetails)}</strong>
									</li>
									<li>
										<span>Resolution</span>
										<strong>{getReportingOutcomeLabel(reportingDetails.resolution)}</strong>
									</li>
								</ul>
							</div>

							<div class="status-card">
								<p class="panel-label">Escalation Metrics</p>
								<div class="escalation-metrics">
									<div>
										<span class="metric-label">Current Bond</span>
										<strong>{formatCurrencyBalance(reportingDetails.currentRequiredBond)}</strong>
									</div>
									<div>
										<span class="metric-label">Binding Capital</span>
										<strong>{formatCurrencyBalance(reportingDetails.bindingCapital)}</strong>
									</div>
									<div>
										<span class="metric-label">Threshold</span>
										<strong>{formatCurrencyBalance(reportingDetails.nonDecisionThreshold)}</strong>
									</div>
									<div>
										<span class="metric-label">Time Left</span>
										<strong>{formatDuration(getEscalationTimeRemaining(reportingDetails))}</strong>
									</div>
								</div>
								<p class="detail">
									Game starts at {formatTimestamp(reportingDetails.startingTime)} and currently uses a start bond of {formatCurrencyBalance(reportingDetails.startBond)} REP-equivalent stake.
								</p>
							</div>

							<div class="escalation-sides">
								{reportingDetails.sides.map(side => {
									const estimate = calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
									const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
									return (
										<div key={side.key} class={`escalation-side ${ reportingForm.selectedOutcome === side.key ? 'selected' : '' } ${ leadingOutcome === side.key ? 'leading' : '' }`}>
											<div class="escalation-side-header">
												<p class="panel-label">{side.label}</p>
												{leadingOutcome === side.key ? <span class="badge ok">Leading</span> : null}
											</div>
											<p class="detail">Total stake: {formatCurrencyBalance(side.balance)}</p>
											<p class="detail">Your stake: {formatCurrencyBalance(userStake)}</p>
											<p class="detail">Your deposits: {side.userDeposits.map(deposit => deposit.depositIndex.toString()).join(', ') || 'None'}</p>
											<p class="detail">Projected payout for current amount: {formatCurrencyBalance(estimate.payout)}</p>
											<p class="detail">Projected profit if this side wins: {formatCurrencyBalance(estimate.profit)}</p>
										</div>
									)
								})}
							</div>
						</>
					)}

					{reportingResult === undefined ? null : (
						<div class="status-card">
							<p class="panel-label">Latest Reporting Action</p>
							<p class="detail">Action: {reportingResult.action}</p>
							<p class="detail">Outcome: {getReportingOutcomeLabel(reportingResult.outcome)}</p>
							<p class="detail">Pool: {reportingResult.securityPoolAddress}</p>
							<p class="detail">Transaction: {reportingResult.hash}</p>
						</div>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Security Pool Address</span>
							<input value={reportingForm.securityPoolAddress} onInput={event => onReportingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onLoadReporting} disabled={loadingReportingDetails}>
								{loadingReportingDetails ? 'Loading Escalation...' : 'Load Reporting State'}
							</button>
						</div>

						<label class="field">
							<span>Outcome Side</span>
							<select value={reportingForm.selectedOutcome} onInput={event => onReportingFormChange({ selectedOutcome: parseReportingOutcomeInput(event.currentTarget.value) })}>
								{REPORTING_OUTCOME_OPTIONS.map(option => (
									<option key={option.key} value={option.key}>
										{option.label}
									</option>
								))}
							</select>
						</label>

						<label class="field">
							<span>Report / Contribution Amount</span>
							<input value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} />
						</label>

						{selectedEstimate === undefined ? null : (
							<p class="detail">
								If {getReportingOutcomeLabel(reportingForm.selectedOutcome)} wins and no one else contributes afterward, the current amount projects roughly {formatCurrencyBalance(selectedEstimate.profit)} of profit.
							</p>
						)}

						<div class="actions">
							<button onClick={onReportOutcome} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Report / Contribute On Selected Side
							</button>
						</div>

						<label class="field">
							<span>Withdraw Deposit Indexes</span>
							<input value={reportingForm.withdrawDepositIndexes} onInput={event => onReportingFormChange({ withdrawDepositIndexes: event.currentTarget.value })} placeholder="Leave empty to withdraw all your deposits on the selected side" />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onWithdrawEscalation} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Withdraw Escalation Deposits
							</button>
						</div>
					</div>

					{reportingError === undefined ? null : <p class="notice error">{reportingError}</p>}
				</div>
			</div>
		</section>
	)
}
