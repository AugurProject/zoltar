import { Fragment } from 'preact'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { TimestampValue } from './TimestampValue.js'
import { formatDuration } from '../lib/formatters.js'
import { AUCTION_TIME_SECONDS, estimateRepPurchased, getForkStageDescription, getForkStageDescriptionForState, getOutcomeActionLabel, getSystemStateLabel, getTimeRemaining, hasForkActivity, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'

const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = 'Unavailable until fork'

function getTruthAuctionWindow(startedAt: bigint | undefined) {
	if (startedAt === undefined || startedAt === 0n) return undefined
	return {
		startedAt,
		endsAt: startedAt + AUCTION_TIME_SECONDS,
	}
}

function renderMetricValue(value: bigint | undefined, suffix: string, fallbackText: string) {
	if (value === undefined) return fallbackText
	return <CurrencyValue value={value} suffix={suffix} />
}

function renderAddress(address: string | undefined) {
	if (address === undefined) return UNKNOWN_VALUE
	return <AddressValue address={address} />
}

function renderTimestamp(timestamp: bigint | undefined, fallbackText: string) {
	if (timestamp === undefined) return fallbackText
	return <TimestampValue timestamp={timestamp} />
}

function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? UNKNOWN_VALUE : UNAVAILABLE_UNTIL_FORK
}

function getPreviewForkType(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	return previewPool.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'
}

function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UNKNOWN_VALUE
	if (!hasPreviewForkActivity) return UNAVAILABLE_UNTIL_FORK
	if (previewPool.truthAuctionStartedAt > 0n) return 'Started/finished'
	return UNKNOWN_VALUE
}

export function ForkAuctionSection({
	accountState,
	disabled = false,
	disabledMessage,
	forkAuctionDetails,
	forkAuctionError,
	forkAuctionForm,
	forkAuctionResult,
	loadingForkAuctionDetails,
	onClaimAuctionProceeds,
	onCreateChildUniverse,
	onFinalizeTruthAuction,
	onForkAuctionFormChange,
	onForkUniverse,
	onForkWithOwnEscalation,
	onInitiateFork,
	onLoadForkAuction,
	onMigrateEscalationDeposits,
	onMigrateRepToZoltar,
	onMigrateVault,
	onRefundLosingBids,
	onStartTruthAuction,
	onSubmitBid,
	onWithdrawBids,
	previewPool,
	showHeader = true,
	showSecurityPoolAddressInput = true,
}: ForkAuctionSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = selectedAuctionPrice === undefined ? undefined : estimateRepPurchased(BigInt(forkAuctionForm.bidAmount || '0'), selectedAuctionPrice)
	const migrationTimeRemaining = forkAuctionDetails === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, forkAuctionDetails.currentTime)
	const previewAuctionWindow = getTruthAuctionWindow(previewPool?.truthAuctionStartedAt)
	const auctionWindow = forkAuctionDetails === undefined ? previewAuctionWindow : getTruthAuctionWindow(forkAuctionDetails.truthAuctionStartedAt)
	const previewQuestion = previewPool?.marketDetails
	const question = forkAuctionDetails?.marketDetails ?? previewQuestion
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const parentSecurityPoolAddress = forkAuctionDetails?.parentSecurityPoolAddress ?? previewPool?.parent
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome
	const truthAuctionAddress = forkAuctionDetails?.truthAuctionAddress ?? previewPool?.truthAuctionAddress
	const hasPreviewForkActivity = previewPool === undefined ? false : hasForkActivity(previewPool)
	const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity)
	const forkStageDescription = forkAuctionDetails === undefined ? (systemState === undefined ? undefined : getForkStageDescriptionForState(systemState)) : getForkStageDescription(forkAuctionDetails)
	const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined

	return (
		<section className='panel market-panel'>
			{showHeader ? (
				<div className='market-header'>
					<div>
						<h2>Fork & Truth Auction</h2>
						<p className='detail'>Open a pool to inspect fork progress, migration, and the truth auction.</p>
					</div>
				</div>
			) : undefined}

			<div className='market-grid'>
				<div className='market-column'>
					{securityPoolAddress === undefined ? undefined : (
						<>
							<div className='status-card'>
								<p className='panel-label'>Loaded Pool</p>
								<ul className='status-list hashes'>
									<li>
										<span>Security Pool</span>
										<strong>{renderAddress(securityPoolAddress)}</strong>
									</li>
									<li>
										<span>Universe</span>
										<strong>{universeId === undefined ? UNKNOWN_VALUE : <UniverseLink universeId={universeId} />}</strong>
									</li>
									<li>
										<span>Parent Pool</span>
										<strong>{renderAddress(parentSecurityPoolAddress)}</strong>
									</li>
									<li>
										<span>System State</span>
										<strong>{systemState === undefined ? UNKNOWN_VALUE : getSystemStateLabel(systemState)}</strong>
									</li>
									<li>
										<span>Final Question Outcome</span>
										<strong>{forkAuctionDetails === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(forkAuctionDetails.questionOutcome)}</strong>
									</li>
									<li>
										<span>Fork Outcome</span>
										<strong>{forkOutcome === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(forkOutcome)}</strong>
									</li>
								</ul>
								{question === undefined ? undefined : (
									<div className='entity-card-subsection'>
										<div className='entity-card-subsection-header'>
											<h4>Question</h4>
										</div>
										<Question question={question} />
									</div>
								)}
								{forkStageDescription === undefined ? undefined : <p className='detail'>{forkStageDescription}</p>}
							</div>

							<div className='status-card'>
								<p className='panel-label'>Fork Metrics</p>
								<div className='escalation-metrics'>
									<MetricField label='REP At Fork'>{forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' />}</MetricField>
									<MetricField label='Migrated REP'>{renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE)}</MetricField>
									<MetricField label='Collateral'>{renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'REP', UNKNOWN_VALUE)}</MetricField>
									<MetricField label='Fork Type'>{forkAuctionDetails === undefined ? getPreviewForkType(previewPool, hasPreviewForkActivity) : forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork'}</MetricField>
									<MetricField label='Migration Ends'>{forkAuctionDetails === undefined ? migrationSummaryText : forkAuctionDetails.migrationEndsAt === undefined ? 'Started/finished' : <TimestampValue timestamp={forkAuctionDetails.migrationEndsAt} />}</MetricField>
									<MetricField label='Migration Time Left'>{forkAuctionDetails === undefined ? forkOnlyFallbackText : migrationTimeRemaining === undefined ? formatDuration(MIGRATION_TIME_SECONDS) : formatDuration(migrationTimeRemaining)}</MetricField>
								</div>
							</div>

							<div className='status-card'>
								<p className='panel-label'>Truth Auction</p>
								<div className='escalation-metrics'>
									<MetricField label='Auction Address'>{renderAddress(truthAuctionAddress)}</MetricField>
									<MetricField label='Started'>
										{forkAuctionDetails === undefined
											? previewPool?.truthAuctionStartedAt === undefined || previewPool.truthAuctionStartedAt === 0n
												? 'Not started'
												: renderTimestamp(previewPool.truthAuctionStartedAt, 'Not started')
											: forkAuctionDetails.truthAuctionStartedAt === 0n
												? 'Not started'
												: renderTimestamp(forkAuctionDetails.truthAuctionStartedAt, 'Not started')}
									</MetricField>
									<MetricField label='Ends'>{auctionWindow === undefined ? 'Not started' : <TimestampValue timestamp={auctionWindow.endsAt} />}</MetricField>
									<MetricField label='Time Left'>{forkAuctionDetails?.truthAuction?.timeRemaining === undefined ? (forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : formatDuration(AUCTION_TIME_SECONDS)) : formatDuration(forkAuctionDetails.truthAuction.timeRemaining)}</MetricField>
									<MetricField label='ETH Raised / Cap'>
										{forkAuctionDetails?.truthAuction === undefined ? (
											forkOnlyFallbackText
										) : (
											<Fragment>
												<CurrencyValue value={forkAuctionDetails.truthAuction.ethRaised} suffix='ETH' /> / <CurrencyValue value={forkAuctionDetails.truthAuction.ethRaiseCap} suffix='ETH' />
											</Fragment>
										)}
									</MetricField>
									<MetricField label='REP Purchased'>{forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.truthAuction.totalRepPurchased} suffix='REP' />}</MetricField>
									<MetricField label='Clearing Tick'>{forkAuctionDetails?.truthAuction?.clearingTick?.toString() ?? (forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : UNKNOWN_VALUE)}</MetricField>
									<MetricField label='Clearing Price'>{forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : renderMetricValue(forkAuctionDetails.truthAuction.clearingPrice, 'REP', UNKNOWN_VALUE)}</MetricField>
									<MetricField label='Underfunded'>{forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : forkAuctionDetails.truthAuction.underfunded ? 'Yes' : 'No'}</MetricField>
									<MetricField label='Finalized'>{forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : forkAuctionDetails.truthAuction.finalized ? 'Yes' : 'No'}</MetricField>
								</div>
								<p className='detail'>At the current clearing price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if it clears.</p>
							</div>

							{forkAuctionResult === undefined ? undefined : (
								<div className='status-card'>
									<p className='panel-label'>Latest Fork / Auction Action</p>
									<p className='detail'>Action: {forkAuctionResult.action}</p>
									<p className='detail'>
										Pool: <AddressValue address={forkAuctionResult.securityPoolAddress} />
									</p>
									<p className='detail'>
										Universe: <UniverseLink universeId={forkAuctionResult.universeId} />
									</p>
									<p className='detail'>
										Transaction: <TransactionHashLink hash={forkAuctionResult.hash} />
									</p>
								</div>
							)}
						</>
					)}
				</div>

				<div className='market-column'>
					<div className='form-grid'>
						{showSecurityPoolAddressInput ? (
							<label className='field'>
								<span>Security Pool Address</span>
								<input value={forkAuctionForm.securityPoolAddress} onInput={event => onForkAuctionFormChange({ securityPoolAddress: event.currentTarget.value })} placeholder='0x...' />
							</label>
						) : undefined}

						<div className='actions'>
							<button className='secondary' onClick={onLoadForkAuction} disabled={loadingForkAuctionDetails}>
								{loadingForkAuctionDetails ? <LoadingText>Loading fork...</LoadingText> : 'Refresh fork'}
							</button>
						</div>

						{disabledMessage === undefined ? undefined : <p className='detail'>{disabledMessage}</p>}

						<fieldset className='fork-auction-controls' disabled={disabled}>
							<label className='field'>
								<span>Outcome</span>
								<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							</label>

							<label className='field'>
								<span>REP Migration Outcomes</span>
								<input value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder='yes,no,invalid' />
							</label>

							<label className='field'>
								<span>Vault Address</span>
								<input value={forkAuctionForm.claimVaultAddress} onInput={event => onForkAuctionFormChange({ claimVaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
							</label>

							<label className='field'>
								<span>Escalation Deposit Indexes</span>
								<input value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder='0,1,2' />
							</label>

							<div className='actions'>
								<button className='primary' onClick={onForkWithOwnEscalation} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Fork With Own Escalation
								</button>
								<button className='secondary' onClick={onInitiateFork} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Initiate Pool Fork
								</button>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Direct Fork Universe ID</span>
									<input value={forkAuctionForm.directForkUniverseId} onInput={event => onForkAuctionFormChange({ directForkUniverseId: event.currentTarget.value })} />
								</label>
								<label className='field'>
									<span>Direct Fork Question ID</span>
									<input value={forkAuctionForm.directForkQuestionId} onInput={event => onForkAuctionFormChange({ directForkQuestionId: event.currentTarget.value })} placeholder='0x...' />
								</label>
							</div>

							<div className='actions'>
								<button className='secondary' onClick={onForkUniverse} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Fork Universe Directly
								</button>
							</div>

							<div className='actions'>
								<button className='primary' onClick={onCreateChildUniverse} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Create {getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe
								</button>
								<button className='secondary' onClick={onMigrateRepToZoltar} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Migrate REP To Zoltar
								</button>
							</div>

							<div className='actions'>
								<button className='primary' onClick={onMigrateVault} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Migrate Vault
								</button>
								<button className='secondary' onClick={onMigrateEscalationDeposits} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Migrate Escalation Deposits
								</button>
							</div>

							<label className='field'>
								<span>Bid Tick</span>
								<input value={forkAuctionForm.bidTick} onInput={event => onForkAuctionFormChange({ bidTick: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Bid Amount (ETH)</span>
								<input value={forkAuctionForm.bidAmount} onInput={event => onForkAuctionFormChange({ bidAmount: event.currentTarget.value })} />
							</label>
							<div className='actions'>
								<button className='primary' onClick={onStartTruthAuction} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Start Truth Auction
								</button>
								<button className='secondary' onClick={onSubmitBid} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Submit Bid
								</button>
							</div>

							<label className='field'>
								<span>Refund Tick</span>
								<input value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Refund Bid Index</span>
								<input value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
							</label>
							<div className='actions'>
								<button className='primary' onClick={onRefundLosingBids} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Refund Losing Bid
								</button>
								<button className='secondary' onClick={onFinalizeTruthAuction} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Finalize Truth Auction
								</button>
							</div>

							<label className='field'>
								<span>Claim Bid Index</span>
								<input value={forkAuctionForm.bidIndex} onInput={event => onForkAuctionFormChange({ bidIndex: event.currentTarget.value })} />
							</label>
							<div className='actions'>
								<button className='primary' onClick={onClaimAuctionProceeds} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Claim Auction Proceeds
								</button>
							</div>

							<div className='field-row'>
								<label className='field'>
									<span>Withdraw For Address</span>
									<input value={forkAuctionForm.withdrawForAddress} onInput={event => onForkAuctionFormChange({ withdrawForAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
								</label>
								<label className='field'>
									<span>Withdraw Tick</span>
									<input value={forkAuctionForm.withdrawTick} onInput={event => onForkAuctionFormChange({ withdrawTick: event.currentTarget.value })} />
								</label>
							</div>
							<label className='field'>
								<span>Withdraw Bid Index</span>
								<input value={forkAuctionForm.withdrawBidIndex} onInput={event => onForkAuctionFormChange({ withdrawBidIndex: event.currentTarget.value })} />
							</label>
							<div className='actions'>
								<button className='secondary' onClick={onWithdrawBids} disabled={disabled || accountState.address === undefined || !isMainnet}>
									Withdraw Bids
								</button>
							</div>
						</fieldset>
					</div>

					<ErrorNotice message={forkAuctionError} />
				</div>
			</div>
		</section>
	)
}
