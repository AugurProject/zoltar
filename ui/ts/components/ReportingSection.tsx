import { formatCurrencyBalance, formatDuration, formatTimestamp } from '../lib/formatters.js'
import { parseReportingOutcomeInput } from '../lib/inputs.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import { calculateEstimatedEscalationReturn, getEscalationPhase, getEscalationTimeRemaining, getLeadingEscalationOutcome } from '../lib/reportingDomain.js'
import type { ReportingSectionProps } from '../types/components.js'

function parseOptionalBigInt(value: string) {
	try {
		return value.trim() === '' ? 0n : BigInt(value)
	} catch {
		return 0n
	}
}

export function ReportingSection({ accountState, loadingReportingDetails, onLoadReporting, onReportOutcome, onReportingFormChange, onWithdrawEscalation, reportingDetails, reportingError, reportingForm, reportingResult }: ReportingSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedAmount = parseOptionalBigInt(reportingForm.reportAmount)
	const totalBalance = reportingDetails === undefined ? 0n : reportingDetails.sides.reduce((sum, side) => sum + side.balance, 0n)
	const leadingOutcome = reportingDetails === undefined ? undefined : getLeadingEscalationOutcome(reportingDetails.sides)
	const selectedSide = reportingDetails?.sides.find(side => side.key === reportingForm.selectedOutcome)
	const selectedEstimate = selectedSide === undefined ? undefined : calculateEstimatedEscalationReturn(selectedSide.balance, totalBalance, selectedAmount)

	return (
		<section className="panel market-panel">
			<div className="market-header">
				<div>
					<p className="panel-label">Reporting & Escalation</p>
					<h2>Report a market outcome and participate in escalation</h2>
					<p className="detail">Load a binary market’s security pool after the market has ended. Reporting is done by staking REP on Invalid, Yes, or No through the pool’s escalation game.</p>
				</div>
			</div>

			<div className="market-grid">
				<div className="market-column">
					{reportingDetails === undefined ? undefined : (
						<>
							<div className="status-card">
								<p className="panel-label">Loaded Escalation Game</p>
								<ul className="status-list hashes">
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
										<span>Universe</span>
										<strong>{reportingDetails.universeId.toString()}</strong>
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

							<div className="status-card">
								<p className="panel-label">Escalation Metrics</p>
								<div className="escalation-metrics">
									<div>
										<span className="metric-label">Current Bond</span>
										<strong>{formatCurrencyBalance(reportingDetails.currentRequiredBond)}</strong>
									</div>
									<div>
										<span className="metric-label">Binding Capital</span>
										<strong>{formatCurrencyBalance(reportingDetails.bindingCapital)}</strong>
									</div>
									<div>
										<span className="metric-label">Threshold</span>
										<strong>{formatCurrencyBalance(reportingDetails.nonDecisionThreshold)}</strong>
									</div>
									<div>
										<span className="metric-label">Time Left</span>
										<strong>{formatDuration(getEscalationTimeRemaining(reportingDetails))}</strong>
									</div>
								</div>
								<p className="detail">
									Game starts at {formatTimestamp(reportingDetails.startingTime)} and currently uses a start bond of {formatCurrencyBalance(reportingDetails.startBond)} REP-equivalent stake.
								</p>
							</div>

							<div className="escalation-sides">
								{reportingDetails.sides.map(side => {
									const estimate = calculateEstimatedEscalationReturn(side.balance, totalBalance, selectedAmount)
									const userStake = side.userDeposits.reduce((sum, deposit) => sum + deposit.amount, 0n)
									return (
										<div key={side.key} className={`escalation-side ${ reportingForm.selectedOutcome === side.key ? 'selected' : '' } ${ leadingOutcome === side.key ? 'leading' : '' }`}>
											<div className="escalation-side-header">
												<p className="panel-label">{side.label}</p>
												{leadingOutcome === side.key ? <span className="badge ok">Leading</span> : undefined}
											</div>
											<p className="detail">Total stake: {formatCurrencyBalance(side.balance)}</p>
											<p className="detail">Your stake: {formatCurrencyBalance(userStake)}</p>
											<p className="detail">Your deposits: {side.userDeposits.map(deposit => deposit.depositIndex.toString()).join(', ') || 'None'}</p>
											<p className="detail">Projected payout for current amount: {formatCurrencyBalance(estimate.payout)}</p>
											<p className="detail">Projected profit if this side wins: {formatCurrencyBalance(estimate.profit)}</p>
										</div>
									)
								})}
							</div>
						</>
					)}

					{reportingResult === undefined ? undefined : (
						<div className="status-card">
							<p className="panel-label">Latest Reporting Action</p>
							<p className="detail">Action: {reportingResult.action}</p>
							<p className="detail">Outcome: {getReportingOutcomeLabel(reportingResult.outcome)}</p>
							<p className="detail">Pool: {reportingResult.securityPoolAddress}</p>
							<p className="detail">Universe: {reportingResult.universeId.toString()}</p>
							<p className="detail">Transaction: {reportingResult.hash}</p>
						</div>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						<label className="field">
							<span>Security Pool Address</span>
							<input value={reportingForm.securityPoolAddress} onInput={event => onReportingFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onLoadReporting} disabled={loadingReportingDetails}>
								{loadingReportingDetails ? 'Loading Escalation...' : 'Load Reporting State'}
							</button>
						</div>

						<label className="field">
							<span>Outcome Side</span>
							<select value={reportingForm.selectedOutcome} onInput={event => onReportingFormChange({ selectedOutcome: parseReportingOutcomeInput(event.currentTarget.value) })}>
								{REPORTING_OUTCOME_OPTIONS.map(option => (
									<option key={option.key} value={option.key}>
										{option.label}
									</option>
								))}
							</select>
						</label>

						<label className="field">
							<span>Report / Contribution Amount</span>
							<input value={reportingForm.reportAmount} onInput={event => onReportingFormChange({ reportAmount: event.currentTarget.value })} />
						</label>

						{selectedEstimate === undefined ? undefined : (
							<p className="detail">
								If {getReportingOutcomeLabel(reportingForm.selectedOutcome)} wins and no one else contributes afterward, the current amount projects roughly {formatCurrencyBalance(selectedEstimate.profit)} of profit.
							</p>
						)}

						<div className="actions">
							<button onClick={onReportOutcome} disabled={accountState.address === undefined || !isMainnet}>
								Report / Contribute On Selected Side
							</button>
						</div>

						<label className="field">
							<span>Withdraw Deposit Indexes</span>
							<input value={reportingForm.withdrawDepositIndexes} onInput={event => onReportingFormChange({ withdrawDepositIndexes: event.currentTarget.value })} placeholder="Leave empty to withdraw all your deposits on the selected side" />
						</label>

						<div className="actions">
							<button className="secondary" onClick={onWithdrawEscalation} disabled={accountState.address === undefined || !isMainnet}>
								Withdraw Escalation Deposits
							</button>
						</div>
					</div>

					{reportingError === undefined ? undefined : <p className="notice error">{reportingError}</p>}
				</div>
			</div>
		</section>
	)
}
