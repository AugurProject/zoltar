import { formatCurrencyBalance, formatDuration, formatTimestamp } from '../lib/formatters.js'
import { AUCTION_TIME_SECONDS, estimateRepPurchased, getForkStageDescription, getOutcomeActionLabel, getSystemStateLabel, getTimeRemaining, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { parseReportingOutcomeInput } from '../lib/inputs.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import type { ForkAuctionSectionProps } from '../types/components.js'

function getTruthAuctionWindow(details: ForkAuctionSectionProps['forkAuctionDetails']) {
	if (details === undefined || details.truthAuctionStartedAt === 0n) return undefined
	return {
		startedAt: details.truthAuctionStartedAt,
		endsAt: details.truthAuctionStartedAt + AUCTION_TIME_SECONDS,
	}
}

export function ForkAuctionSection({ accountState, forkAuctionDetails, forkAuctionError, forkAuctionForm, forkAuctionResult, loadingForkAuctionDetails, onClaimAuctionProceeds, onCreateChildUniverse, onFinalizeTruthAuction, onForkAuctionFormChange, onForkWithOwnEscalation, onInitiateFork, onLoadForkAuction, onMigrateEscalationDeposits, onMigrateRepToZoltar, onMigrateVault, onRefundLosingBids, onStartTruthAuction, onSubmitBid }: ForkAuctionSectionProps) {
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = selectedAuctionPrice === undefined ? undefined : estimateRepPurchased(BigInt(forkAuctionForm.bidAmount || '0'), selectedAuctionPrice)
	const migrationTimeRemaining = forkAuctionDetails === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, forkAuctionDetails.currentTime)
	const auctionWindow = getTruthAuctionWindow(forkAuctionDetails)

	return (
		<section class="panel market-panel">
			<div class="market-header">
				<div>
					<p class="panel-label">Fork & Truth Auction</p>
					<h2>Operate child universes and truth auctions</h2>
					<p class="detail">Load any security pool to inspect its universe, fork state, migration timer, truth auction progress, and the actions needed to move REP, vaults, and auction proceeds through the fork flow.</p>
				</div>
			</div>

			<div class="market-grid">
				<div class="market-column">
					{forkAuctionDetails === undefined ? undefined : (
						<>
							<div class="status-card">
								<p class="panel-label">Loaded Pool</p>
								<ul class="status-list hashes">
									<li>
										<span>Security Pool</span>
										<strong>{forkAuctionDetails.securityPoolAddress}</strong>
									</li>
									<li>
										<span>Universe</span>
										<strong>{forkAuctionDetails.universeId.toString()}</strong>
									</li>
									<li>
										<span>Parent Pool</span>
										<strong>{forkAuctionDetails.parentSecurityPoolAddress}</strong>
									</li>
									<li>
										<span>Question ID</span>
										<strong>{forkAuctionDetails.marketDetails.questionId}</strong>
									</li>
									<li>
										<span>Market Title</span>
										<strong>{forkAuctionDetails.marketDetails.title}</strong>
									</li>
									<li>
										<span>System State</span>
										<strong>{getSystemStateLabel(forkAuctionDetails.systemState)}</strong>
									</li>
									<li>
										<span>Final Question Outcome</span>
										<strong>{getReportingOutcomeLabel(forkAuctionDetails.questionOutcome)}</strong>
									</li>
									<li>
										<span>Fork Outcome</span>
										<strong>{getReportingOutcomeLabel(forkAuctionDetails.forkOutcome)}</strong>
									</li>
								</ul>
								<p class="detail">{getForkStageDescription(forkAuctionDetails)}</p>
							</div>

							<div class="status-card">
								<p class="panel-label">Fork Metrics</p>
								<div class="escalation-metrics">
									<div>
										<span class="metric-label">REP At Fork</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.repAtFork)}</strong>
									</div>
									<div>
										<span class="metric-label">Migrated REP</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.migratedRep)}</strong>
									</div>
									<div>
										<span class="metric-label">Collateral</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.completeSetCollateralAmount)}</strong>
									</div>
									<div>
										<span class="metric-label">Fork Type</span>
										<strong>{forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'}</strong>
									</div>
									<div>
										<span class="metric-label">Migration Ends</span>
										<strong>{forkAuctionDetails.migrationEndsAt === undefined ? 'Started/finished' : formatTimestamp(forkAuctionDetails.migrationEndsAt)}</strong>
									</div>
									<div>
										<span class="metric-label">Migration Time Left</span>
										<strong>{migrationTimeRemaining === undefined ? formatDuration(MIGRATION_TIME_SECONDS) : formatDuration(migrationTimeRemaining)}</strong>
									</div>
								</div>
							</div>

							{forkAuctionDetails.truthAuction === undefined ? undefined : (
								<div class="status-card">
									<p class="panel-label">Truth Auction</p>
									<div class="escalation-metrics">
										<div>
											<span class="metric-label">Auction Address</span>
											<strong>{forkAuctionDetails.truthAuctionAddress}</strong>
										</div>
										<div>
											<span class="metric-label">Started</span>
											<strong>{formatTimestamp(forkAuctionDetails.truthAuctionStartedAt)}</strong>
										</div>
										<div>
											<span class="metric-label">Ends</span>
											<strong>{auctionWindow === undefined ? 'Not started' : formatTimestamp(auctionWindow.endsAt)}</strong>
										</div>
										<div>
											<span class="metric-label">Time Left</span>
											<strong>{forkAuctionDetails.truthAuction.timeRemaining === undefined ? formatDuration(AUCTION_TIME_SECONDS) : formatDuration(forkAuctionDetails.truthAuction.timeRemaining)}</strong>
										</div>
										<div>
											<span class="metric-label">ETH Raised / Cap</span>
											<strong>
												{formatCurrencyBalance(forkAuctionDetails.truthAuction.ethRaised)} / {formatCurrencyBalance(forkAuctionDetails.truthAuction.ethRaiseCap)}
											</strong>
										</div>
										<div>
											<span class="metric-label">REP Purchased</span>
											<strong>{formatCurrencyBalance(forkAuctionDetails.truthAuction.totalRepPurchased)}</strong>
										</div>
										<div>
											<span class="metric-label">Clearing Tick</span>
											<strong>{forkAuctionDetails.truthAuction.clearingTick?.toString() ?? 'Unavailable'}</strong>
										</div>
										<div>
											<span class="metric-label">Clearing Price</span>
											<strong>{formatCurrencyBalance(forkAuctionDetails.truthAuction.clearingPrice)}</strong>
										</div>
										<div>
											<span class="metric-label">Underfunded</span>
											<strong>{forkAuctionDetails.truthAuction.underfunded ? 'Yes' : 'No'}</strong>
										</div>
										<div>
											<span class="metric-label">Finalized</span>
											<strong>{forkAuctionDetails.truthAuction.finalized ? 'Yes' : 'No'}</strong>
										</div>
									</div>
									<p class="detail">At the current clearing price, the entered bid amount would buy roughly {estimatedRep === undefined ? 'Unavailable' : formatCurrencyBalance(estimatedRep)} REP-equivalent ownership if it clears.</p>
								</div>
							)}

							{forkAuctionResult === undefined ? undefined : (
								<div class="status-card">
									<p class="panel-label">Latest Fork / Auction Action</p>
									<p class="detail">Action: {forkAuctionResult.action}</p>
									<p class="detail">Pool: {forkAuctionResult.securityPoolAddress}</p>
									<p class="detail">Universe: {forkAuctionResult.universeId.toString()}</p>
									<p class="detail">Transaction: {forkAuctionResult.hash}</p>
								</div>
							)}
						</>
					)}
				</div>

				<div class="market-column">
					<div class="form-grid">
						<label class="field">
							<span>Security Pool Address</span>
							<input value={forkAuctionForm.securityPoolAddress} onInput={event => onForkAuctionFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
						</label>

						<div class="actions">
							<button class="secondary" onClick={onLoadForkAuction} disabled={loadingForkAuctionDetails}>
								{loadingForkAuctionDetails ? 'Loading Fork State...' : 'Load Fork & Auction State'}
							</button>
						</div>

						<label class="field">
							<span>Outcome</span>
							<select value={forkAuctionForm.selectedOutcome} onInput={event => onForkAuctionFormChange({ selectedOutcome: parseReportingOutcomeInput(event.currentTarget.value) })}>
								{REPORTING_OUTCOME_OPTIONS.map(option => (
									<option key={option.key} value={option.key}>
										{option.label}
									</option>
								))}
							</select>
						</label>

						<label class="field">
							<span>REP Migration Outcomes</span>
							<input value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder="yes,no,invalid" />
						</label>

						<label class="field">
							<span>Vault Address</span>
							<input value={forkAuctionForm.claimVaultAddress} onInput={event => onForkAuctionFormChange({ claimVaultAddress: event.currentTarget.value })} placeholder="Leave empty to use connected wallet" />
						</label>

						<label class="field">
							<span>Escalation Deposit Indexes</span>
							<input value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder="0,1,2" />
						</label>

						<div class="actions">
							<button onClick={onForkWithOwnEscalation} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Fork With Own Escalation
							</button>
							<button class="secondary" onClick={onInitiateFork} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Initiate Pool Fork
							</button>
						</div>

						<div class="actions">
							<button onClick={onCreateChildUniverse} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Create {getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe
							</button>
							<button class="secondary" onClick={onMigrateRepToZoltar} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Migrate REP To Zoltar
							</button>
						</div>

						<div class="actions">
							<button onClick={onMigrateVault} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Migrate Vault
							</button>
							<button class="secondary" onClick={onMigrateEscalationDeposits} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Migrate Escalation Deposits
							</button>
						</div>

						<label class="field">
							<span>Bid Tick</span>
							<input value={forkAuctionForm.bidTick} onInput={event => onForkAuctionFormChange({ bidTick: event.currentTarget.value })} />
						</label>
						<label class="field">
							<span>Bid Amount (ETH)</span>
							<input value={forkAuctionForm.bidAmount} onInput={event => onForkAuctionFormChange({ bidAmount: event.currentTarget.value })} />
						</label>
						<div class="actions">
							<button onClick={onStartTruthAuction} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Start Truth Auction
							</button>
							<button class="secondary" onClick={onSubmitBid} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Submit Bid
							</button>
						</div>

						<label class="field">
							<span>Refund Tick</span>
							<input value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
						</label>
						<label class="field">
							<span>Refund Bid Index</span>
							<input value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
						</label>
						<div class="actions">
							<button onClick={onRefundLosingBids} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Refund Losing Bid
							</button>
							<button class="secondary" onClick={onFinalizeTruthAuction} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Finalize Truth Auction
							</button>
						</div>

						<label class="field">
							<span>Claim Bid Index</span>
							<input value={forkAuctionForm.bidIndex} onInput={event => onForkAuctionFormChange({ bidIndex: event.currentTarget.value })} />
						</label>
						<div class="actions">
							<button onClick={onClaimAuctionProceeds} disabled={accountState.address === undefined || !accountState.isMainnet}>
								Claim Auction Proceeds
							</button>
						</div>
					</div>

					{forkAuctionError === undefined ? undefined : <p class="notice error">{forkAuctionError}</p>}
				</div>
			</div>
		</section>
	)
}
