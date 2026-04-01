import { EnumDropdown } from './EnumDropdown.js'
import { QuestionSummaryHeader } from './QuestionSummary.js'
import { UniverseLink } from './UniverseLink.js'
import { formatCurrencyBalance, formatDuration, formatTimestamp } from '../lib/formatters.js'
import { AUCTION_TIME_SECONDS, estimateRepPurchased, getForkStageDescription, getOutcomeActionLabel, getSystemStateLabel, getTimeRemaining, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingOutcomeLabel, REPORTING_OUTCOME_OPTIONS } from '../lib/reporting.js'
import type { ForkAuctionSectionProps } from '../types/components.js'

function getTruthAuctionWindow(details: ForkAuctionSectionProps['forkAuctionDetails']) {
	if (details === undefined || details.truthAuctionStartedAt === 0n) return undefined
	return {
		startedAt: details.truthAuctionStartedAt,
		endsAt: details.truthAuctionStartedAt + AUCTION_TIME_SECONDS,
	}
}

export function ForkAuctionSection({ accountState, forkAuctionDetails, forkAuctionError, forkAuctionForm, forkAuctionResult, loadingForkAuctionDetails, onClaimAuctionProceeds, onCreateChildUniverse, onFinalizeTruthAuction, onForkAuctionFormChange, onForkUniverse, onForkWithOwnEscalation, onInitiateFork, onLoadForkAuction, onMigrateEscalationDeposits, onMigrateRepToZoltar, onMigrateVault, onRefundLosingBids, onStartTruthAuction, onSubmitBid, onWithdrawBids, showHeader = true, showSecurityPoolAddressInput = true }: ForkAuctionSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = selectedAuctionPrice === undefined ? undefined : estimateRepPurchased(BigInt(forkAuctionForm.bidAmount || '0'), selectedAuctionPrice)
	const migrationTimeRemaining = forkAuctionDetails === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, forkAuctionDetails.currentTime)
	const auctionWindow = getTruthAuctionWindow(forkAuctionDetails)

	return (
		<section className="panel market-panel">
			{showHeader ? (
				<div className="market-header">
					<div>
						<h2>Fork & Truth Auction</h2>
						<p className="detail">Load any security pool to inspect its universe, fork state, migration timer, truth auction progress, and the actions needed to move REP, vaults, and auction proceeds through the fork flow.</p>
					</div>
				</div>
			) : undefined}

			<div className="market-grid">
				<div className="market-column">
					{forkAuctionDetails === undefined ? undefined : (
						<>
							<div className="status-card">
								<p className="panel-label">Loaded Pool</p>
								<ul className="status-list hashes">
									<li>
										<span>Security Pool</span>
										<strong>{forkAuctionDetails.securityPoolAddress}</strong>
									</li>
									<li>
										<span>Universe</span>
										<strong>
											<UniverseLink universeId={forkAuctionDetails.universeId} />
										</strong>
									</li>
									<li>
										<span>Parent Pool</span>
										<strong>{forkAuctionDetails.parentSecurityPoolAddress}</strong>
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
								<div className="entity-card-subsection">
									<div className="entity-card-subsection-header">
										<h4>Question</h4>
										<span className="badge muted">{forkAuctionDetails.marketDetails.marketType}</span>
									</div>
									<QuestionSummaryHeader description={forkAuctionDetails.marketDetails.description.trim() === '' ? 'No description provided.' : forkAuctionDetails.marketDetails.description} questionId={forkAuctionDetails.marketDetails.questionId} title={forkAuctionDetails.marketDetails.title.trim() === '' ? 'Untitled question' : forkAuctionDetails.marketDetails.title} />
								</div>
								<p className="detail">{getForkStageDescription(forkAuctionDetails)}</p>
							</div>

							<div className="status-card">
								<p className="panel-label">Fork Metrics</p>
								<div className="escalation-metrics">
									<div>
										<span className="metric-label">REP At Fork</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.repAtFork)}</strong>
									</div>
									<div>
										<span className="metric-label">Migrated REP</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.migratedRep)}</strong>
									</div>
									<div>
										<span className="metric-label">Collateral</span>
										<strong>{formatCurrencyBalance(forkAuctionDetails.completeSetCollateralAmount)}</strong>
									</div>
									<div>
										<span className="metric-label">Fork Type</span>
										<strong>{forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'}</strong>
									</div>
									<div>
										<span className="metric-label">Migration Ends</span>
										<strong>{forkAuctionDetails.migrationEndsAt === undefined ? 'Started/finished' : formatTimestamp(forkAuctionDetails.migrationEndsAt)}</strong>
									</div>
									<div>
										<span className="metric-label">Migration Time Left</span>
										<strong>{migrationTimeRemaining === undefined ? formatDuration(MIGRATION_TIME_SECONDS) : formatDuration(migrationTimeRemaining)}</strong>
									</div>
								</div>
							</div>

							{forkAuctionDetails.truthAuction === undefined ? undefined : (
								<div className="status-card">
									<p className="panel-label">Truth Auction</p>
									<div className="escalation-metrics">
										<div>
											<span className="metric-label">Auction Address</span>
											<strong>{forkAuctionDetails.truthAuctionAddress}</strong>
										</div>
										<div>
											<span className="metric-label">Started</span>
											<strong>{formatTimestamp(forkAuctionDetails.truthAuctionStartedAt)}</strong>
										</div>
										<div>
											<span className="metric-label">Ends</span>
											<strong>{auctionWindow === undefined ? 'Not started' : formatTimestamp(auctionWindow.endsAt)}</strong>
										</div>
										<div>
											<span className="metric-label">Time Left</span>
											<strong>{forkAuctionDetails.truthAuction.timeRemaining === undefined ? formatDuration(AUCTION_TIME_SECONDS) : formatDuration(forkAuctionDetails.truthAuction.timeRemaining)}</strong>
										</div>
										<div>
											<span className="metric-label">ETH Raised / Cap</span>
											<strong>
												{formatCurrencyBalance(forkAuctionDetails.truthAuction.ethRaised)} / {formatCurrencyBalance(forkAuctionDetails.truthAuction.ethRaiseCap)}
											</strong>
										</div>
										<div>
											<span className="metric-label">REP Purchased</span>
											<strong>{formatCurrencyBalance(forkAuctionDetails.truthAuction.totalRepPurchased)}</strong>
										</div>
										<div>
											<span className="metric-label">Clearing Tick</span>
											<strong>{forkAuctionDetails.truthAuction.clearingTick?.toString() ?? 'Unavailable'}</strong>
										</div>
										<div>
											<span className="metric-label">Clearing Price</span>
											<strong>{formatCurrencyBalance(forkAuctionDetails.truthAuction.clearingPrice)}</strong>
										</div>
										<div>
											<span className="metric-label">Underfunded</span>
											<strong>{forkAuctionDetails.truthAuction.underfunded ? 'Yes' : 'No'}</strong>
										</div>
										<div>
											<span className="metric-label">Finalized</span>
											<strong>{forkAuctionDetails.truthAuction.finalized ? 'Yes' : 'No'}</strong>
										</div>
									</div>
									<p className="detail">At the current clearing price, the entered bid amount would buy roughly {estimatedRep === undefined ? 'Unavailable' : formatCurrencyBalance(estimatedRep)} REP-equivalent ownership if it clears.</p>
								</div>
							)}

							{forkAuctionResult === undefined ? undefined : (
								<div className="status-card">
									<p className="panel-label">Latest Fork / Auction Action</p>
									<p className="detail">Action: {forkAuctionResult.action}</p>
									<p className="detail">Pool: {forkAuctionResult.securityPoolAddress}</p>
									<p className="detail">
										Universe: <UniverseLink universeId={forkAuctionResult.universeId} />
									</p>
									<p className="detail">Transaction: {forkAuctionResult.hash}</p>
								</div>
							)}
						</>
					)}
				</div>

				<div className="market-column">
					<div className="form-grid">
						{showSecurityPoolAddressInput ? (
							<label className="field">
								<span>Security Pool Address</span>
								<input value={forkAuctionForm.securityPoolAddress} onInput={event => onForkAuctionFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder="0x..." />
							</label>
						) : undefined}

						<div className="actions">
							<button className="secondary" onClick={onLoadForkAuction} disabled={loadingForkAuctionDetails}>
								{loadingForkAuctionDetails ? 'Loading Fork State...' : 'Load Fork & Auction State'}
							</button>
						</div>

						<label className="field">
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_OPTIONS.map(option => ({ value: option.key, label: option.label }))} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>

						<label className="field">
							<span>REP Migration Outcomes</span>
							<input value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder="yes,no,invalid" />
						</label>

						<label className="field">
							<span>Vault Address</span>
							<input value={forkAuctionForm.claimVaultAddress} onInput={event => onForkAuctionFormChange({ claimVaultAddress: event.currentTarget.value })} placeholder="Leave empty to use connected wallet" />
						</label>

						<label className="field">
							<span>Escalation Deposit Indexes</span>
							<input value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder="0,1,2" />
						</label>

						<div className="actions">
							<button onClick={onForkWithOwnEscalation} disabled={accountState.address === undefined || !isMainnet}>
								Fork With Own Escalation
							</button>
							<button className="secondary" onClick={onInitiateFork} disabled={accountState.address === undefined || !isMainnet}>
								Initiate Pool Fork
							</button>
						</div>

						<div className="field-row">
							<label className="field">
								<span>Direct Fork Universe ID</span>
								<input value={forkAuctionForm.directForkUniverseId} onInput={event => onForkAuctionFormChange({ directForkUniverseId: event.currentTarget.value })} />
							</label>
							<label className="field">
								<span>Direct Fork Question ID</span>
								<input value={forkAuctionForm.directForkQuestionId} onInput={event => onForkAuctionFormChange({ directForkQuestionId: event.currentTarget.value })} placeholder="0x..." />
							</label>
						</div>

						<div className="actions">
							<button className="secondary" onClick={onForkUniverse} disabled={accountState.address === undefined || !isMainnet}>
								Fork Universe Directly
							</button>
						</div>

						<div className="actions">
							<button onClick={onCreateChildUniverse} disabled={accountState.address === undefined || !isMainnet}>
								Create {getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe
							</button>
							<button className="secondary" onClick={onMigrateRepToZoltar} disabled={accountState.address === undefined || !isMainnet}>
								Migrate REP To Zoltar
							</button>
						</div>

						<div className="actions">
							<button onClick={onMigrateVault} disabled={accountState.address === undefined || !isMainnet}>
								Migrate Vault
							</button>
							<button className="secondary" onClick={onMigrateEscalationDeposits} disabled={accountState.address === undefined || !isMainnet}>
								Migrate Escalation Deposits
							</button>
						</div>

						<label className="field">
							<span>Bid Tick</span>
							<input value={forkAuctionForm.bidTick} onInput={event => onForkAuctionFormChange({ bidTick: event.currentTarget.value })} />
						</label>
						<label className="field">
							<span>Bid Amount (ETH)</span>
							<input value={forkAuctionForm.bidAmount} onInput={event => onForkAuctionFormChange({ bidAmount: event.currentTarget.value })} />
						</label>
						<div className="actions">
							<button onClick={onStartTruthAuction} disabled={accountState.address === undefined || !isMainnet}>
								Start Truth Auction
							</button>
							<button className="secondary" onClick={onSubmitBid} disabled={accountState.address === undefined || !isMainnet}>
								Submit Bid
							</button>
						</div>

						<label className="field">
							<span>Refund Tick</span>
							<input value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
						</label>
						<label className="field">
							<span>Refund Bid Index</span>
							<input value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
						</label>
						<div className="actions">
							<button onClick={onRefundLosingBids} disabled={accountState.address === undefined || !isMainnet}>
								Refund Losing Bid
							</button>
							<button className="secondary" onClick={onFinalizeTruthAuction} disabled={accountState.address === undefined || !isMainnet}>
								Finalize Truth Auction
							</button>
						</div>

						<label className="field">
							<span>Claim Bid Index</span>
							<input value={forkAuctionForm.bidIndex} onInput={event => onForkAuctionFormChange({ bidIndex: event.currentTarget.value })} />
						</label>
						<div className="actions">
							<button onClick={onClaimAuctionProceeds} disabled={accountState.address === undefined || !isMainnet}>
								Claim Auction Proceeds
							</button>
						</div>

						<div className="field-row">
							<label className="field">
								<span>Withdraw For Address</span>
								<input value={forkAuctionForm.withdrawForAddress} onInput={event => onForkAuctionFormChange({ withdrawForAddress: event.currentTarget.value })} placeholder="Leave empty to use connected wallet" />
							</label>
							<label className="field">
								<span>Withdraw Tick</span>
								<input value={forkAuctionForm.withdrawTick} onInput={event => onForkAuctionFormChange({ withdrawTick: event.currentTarget.value })} />
							</label>
						</div>
						<label className="field">
							<span>Withdraw Bid Index</span>
							<input value={forkAuctionForm.withdrawBidIndex} onInput={event => onForkAuctionFormChange({ withdrawBidIndex: event.currentTarget.value })} />
						</label>
						<div className="actions">
							<button className="secondary" onClick={onWithdrawBids} disabled={accountState.address === undefined || !isMainnet}>
								Withdraw Bids
							</button>
						</div>
					</div>

					{forkAuctionError === undefined ? undefined : <p className="notice error">{forkAuctionError}</p>}
				</div>
			</div>
		</section>
	)
}
