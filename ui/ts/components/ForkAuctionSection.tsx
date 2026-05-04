import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { TimestampValue } from './TimestampValue.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'
import { AUCTION_TIME_SECONDS, type ForkAuctionStageView, estimateRepPurchased, getForkAuctionStageView, getForkStageDescription, getForkStageDescriptionForState, getOutcomeActionLabel, getSystemStateLabel, getTimeRemaining, hasForkActivity, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { formatDuration } from '../lib/formatters.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'

const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = 'Unavailable until fork'
const STAGE_VIEWS: readonly ForkAuctionStageView[] = ['initiate', 'migration', 'auction', 'settlement']
const STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Initiate',
	migration: 'Migration',
	auction: 'Auction',
	settlement: 'Settlement',
}
const STAGE_BADGE_TONES: Record<ForkAuctionStageView, 'muted' | 'pending' | 'ok'> = {
	initiate: 'muted',
	migration: 'pending',
	auction: 'pending',
	settlement: 'ok',
}
const STAGE_ORDER: Record<ForkAuctionStageView, number> = {
	initiate: 0,
	migration: 1,
	auction: 2,
	settlement: 3,
}

type DisplayMetric = {
	label: string
	value: ComponentChildren
}

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

function getStageLabel(stage: ForkAuctionStageView) {
	return STAGE_LABELS[stage]
}

function getStageTone(stage: ForkAuctionStageView) {
	return STAGE_BADGE_TONES[stage]
}

function getStageAheadMessage(stage: ForkAuctionStageView, currentStage: ForkAuctionStageView) {
	if (STAGE_ORDER[stage] <= STAGE_ORDER[currentStage]) return undefined

	switch (stage) {
		case 'migration':
			return `This pool is currently in ${getStageLabel(currentStage)}. Migration controls become meaningful once the pool has forked.`
		case 'auction':
			return `This pool is currently in ${getStageLabel(currentStage)}. Auction controls become meaningful after migration completes and the truth auction starts.`
		case 'settlement':
			return `This pool is currently in ${getStageLabel(currentStage)}. Settlement controls become meaningful after bidding progresses or the truth auction finalizes.`
		case 'initiate':
			return undefined
		default:
			return undefined
	}
}

function renderSummaryMetricGrid(metrics: DisplayMetric[]) {
	return (
		<div className='fork-summary-grid'>
			{metrics.map(metric => (
				<MetricField key={metric.label} className='entity-metric' label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</div>
	)
}

function renderWorkflowMetricGrid(metrics: DisplayMetric[]) {
	return (
		<div className='workflow-metric-grid'>
			{metrics.map(metric => (
				<MetricField key={metric.label} label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</div>
	)
}

function estimateBidRep(bidAmount: string, selectedAuctionPrice: bigint | undefined) {
	if (selectedAuctionPrice === undefined) return undefined

	try {
		return estimateRepPurchased(BigInt(bidAmount === '' ? '0' : bidAmount), selectedAuctionPrice)
	} catch {
		return undefined
	}
}

export function ForkAuctionSection({
	activeNetworkLabel = 'Ethereum mainnet',
	accountState,
	disabled = false,
	disabledMessage,
	embedInCard = false,
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
	walletMatchesActiveNetwork = true,
}: ForkAuctionSectionProps) {
	const selectedAuctionPrice = forkAuctionDetails?.truthAuction?.clearingPrice
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, selectedAuctionPrice)
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
	const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome
	const truthAuctionAddress = forkAuctionDetails?.truthAuctionAddress ?? previewPool?.truthAuctionAddress
	const hasPreviewForkActivity = previewPool === undefined ? false : hasForkActivity(previewPool)
	const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity)
	const forkStageDescription = forkAuctionDetails === undefined ? (systemState === undefined ? undefined : getForkStageDescriptionForState(systemState)) : getForkStageDescription(forkAuctionDetails)
	const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined
	const hasLoadedPoolContext = securityPoolAddress !== undefined && systemState !== undefined
	const currentStage =
		systemState === undefined
			? 'initiate'
			: getForkAuctionStageView({
					claimingAvailable: forkAuctionDetails?.claimingAvailable ?? false,
					forkOutcome: forkOutcome ?? 'none',
					migratedRep: forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep ?? 0n,
					systemState,
					truthAuction: forkAuctionDetails?.truthAuction,
					truthAuctionStartedAt: forkAuctionDetails?.truthAuctionStartedAt ?? previewPool?.truthAuctionStartedAt ?? 0n,
				})
	const [selectedStage, setSelectedStage] = useState<ForkAuctionStageView>(currentStage)
	const lastPoolKeyRef = useRef<string | undefined>(undefined)
	const selectedStageAheadMessage = getStageAheadMessage(selectedStage, currentStage)
	const resolvedDisabledMessage = disabledMessage ?? (accountState.address !== undefined && !walletMatchesActiveNetwork ? `Switch wallet to ${activeNetworkLabel} to use fork and truth auction actions.` : undefined)
	const selectedStageBadge = <span className={`badge ${getStageTone(currentStage)}`}>{getStageLabel(currentStage)}</span>
	const truthAuctionFallback = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : UNKNOWN_VALUE
	const truthAuctionStatus = forkAuctionDetails?.truthAuction
	const startedDisplay =
		forkAuctionDetails === undefined
			? previewPool?.truthAuctionStartedAt === undefined || previewPool.truthAuctionStartedAt === 0n
				? 'Not started'
				: renderTimestamp(previewPool.truthAuctionStartedAt, 'Not started')
			: forkAuctionDetails.truthAuctionStartedAt === 0n
				? 'Not started'
				: renderTimestamp(forkAuctionDetails.truthAuctionStartedAt, 'Not started')
	const endsDisplay = auctionWindow === undefined ? 'Not started' : <TimestampValue timestamp={auctionWindow.endsAt} />
	const timeLeftDisplay = forkAuctionDetails?.truthAuction?.timeRemaining === undefined ? (forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : formatDuration(AUCTION_TIME_SECONDS)) : formatDuration(forkAuctionDetails.truthAuction.timeRemaining)
	const ethRaisedCapDisplay =
		forkAuctionDetails?.truthAuction === undefined ? (
			forkOnlyFallbackText
		) : (
			<Fragment>
				<CurrencyValue value={forkAuctionDetails.truthAuction.ethRaised} suffix='ETH' /> / <CurrencyValue value={forkAuctionDetails.truthAuction.ethRaiseCap} suffix='ETH' />
			</Fragment>
		)
	const clearingPriceDisplay = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : renderMetricValue(forkAuctionDetails.truthAuction.clearingPrice, 'REP', UNKNOWN_VALUE)
	const finalizedDisplay = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : forkAuctionDetails.truthAuction.finalized ? 'Yes' : 'No'
	const underfundedDisplay = forkAuctionDetails?.truthAuction === undefined ? forkOnlyFallbackText : forkAuctionDetails.truthAuction.underfunded ? 'Yes' : 'No'
	const claimingAvailableDisplay = forkAuctionDetails === undefined ? (hasPreviewForkActivity ? UNKNOWN_VALUE : UNAVAILABLE_UNTIL_FORK) : forkAuctionDetails.claimingAvailable ? 'Yes' : 'No'

	useEffect(() => {
		if (lastPoolKeyRef.current === securityPoolAddress) return
		lastPoolKeyRef.current = securityPoolAddress
		setSelectedStage(currentStage)
	}, [currentStage, securityPoolAddress])

	const poolSummaryMetrics: DisplayMetric[] = [
		{ label: 'Security Pool', value: renderAddress(securityPoolAddress) },
		{ label: 'Universe', value: universeId === undefined ? UNKNOWN_VALUE : <UniverseLink universeId={universeId} /> },
		{ label: 'Parent Pool', value: renderAddress(parentSecurityPoolAddress) },
		{ label: 'System State', value: systemState === undefined ? UNKNOWN_VALUE : getSystemStateLabel(systemState) },
		{ label: 'Fork Type', value: forkAuctionDetails === undefined ? getPreviewForkType(previewPool, hasPreviewForkActivity) : forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork' },
		{ label: 'Question Outcome', value: questionOutcome === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(questionOutcome) },
		{ label: 'Fork Outcome', value: forkOutcome === undefined ? UNKNOWN_VALUE : getReportingOutcomeLabel(forkOutcome) },
		{ label: 'Collateral', value: renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'ETH', UNKNOWN_VALUE) },
	]

	const liveSnapshotMetrics: DisplayMetric[] =
		selectedStage === 'initiate'
			? [
					{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
					{ label: 'Fork Type', value: forkAuctionDetails === undefined ? getPreviewForkType(previewPool, hasPreviewForkActivity) : forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork' },
					{ label: 'Parent Pool', value: renderAddress(parentSecurityPoolAddress) },
					{ label: 'Migration Window', value: formatDuration(MIGRATION_TIME_SECONDS) },
				]
			: selectedStage === 'migration'
				? [
						{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
						{ label: 'Migrated REP', value: renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE) },
						{ label: 'Migration Ends', value: forkAuctionDetails === undefined ? migrationSummaryText : forkAuctionDetails.migrationEndsAt === undefined ? 'Started/finished' : <TimestampValue timestamp={forkAuctionDetails.migrationEndsAt} /> },
						{ label: 'Time Left', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : migrationTimeRemaining === undefined ? formatDuration(MIGRATION_TIME_SECONDS) : formatDuration(migrationTimeRemaining) },
					]
				: selectedStage === 'auction'
					? [
							{ label: 'Started', value: startedDisplay },
							{ label: 'Ends', value: endsDisplay },
							{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
							{ label: 'Clearing Price', value: clearingPriceDisplay },
						]
					: [
							{ label: 'Finalized', value: finalizedDisplay },
							{ label: 'Underfunded', value: underfundedDisplay },
							{ label: 'Auctioned Allowance', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionedSecurityBondAllowance} suffix='ETH' /> },
							{ label: 'Claiming Available', value: claimingAvailableDisplay },
						]

	const initiateStatusMetrics: DisplayMetric[] = [
		{ label: 'Current Stage', value: getStageLabel(currentStage) },
		{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
		{ label: 'Fork Type', value: forkAuctionDetails === undefined ? getPreviewForkType(previewPool, hasPreviewForkActivity) : forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork' },
		{ label: 'Migration Window', value: formatDuration(MIGRATION_TIME_SECONDS) },
	]

	const migrationStatusMetrics: DisplayMetric[] = [
		{ label: 'REP At Fork', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.repAtFork} suffix='REP' /> },
		{ label: 'Migrated REP', value: renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, 'REP', UNKNOWN_VALUE) },
		{ label: 'Collateral', value: renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, 'ETH', UNKNOWN_VALUE) },
		{ label: 'Migration Ends', value: forkAuctionDetails === undefined ? migrationSummaryText : forkAuctionDetails.migrationEndsAt === undefined ? 'Started/finished' : <TimestampValue timestamp={forkAuctionDetails.migrationEndsAt} /> },
		{ label: 'Time Left', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : migrationTimeRemaining === undefined ? formatDuration(MIGRATION_TIME_SECONDS) : formatDuration(migrationTimeRemaining) },
		{ label: 'Fork Type', value: forkAuctionDetails === undefined ? getPreviewForkType(previewPool, hasPreviewForkActivity) : forkAuctionDetails.forkOwnSecurityPool ? 'Own escalation fork' : 'Parent/Zoltar fork' },
	]

	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: 'Auction Address', value: renderAddress(truthAuctionAddress) },
		{ label: 'Started', value: startedDisplay },
		{ label: 'Ends', value: endsDisplay },
		{ label: 'Time Left', value: timeLeftDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> },
		{ label: 'Clearing Tick', value: truthAuctionStatus?.clearingTick?.toString() ?? truthAuctionFallback },
		{ label: 'Clearing Price', value: clearingPriceDisplay },
		{ label: 'Min Bid Size', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix='ETH' /> },
		{ label: 'Max REP Being Sold', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix='REP' /> },
		{ label: 'Finalized', value: finalizedDisplay },
		{ label: 'Underfunded', value: underfundedDisplay },
	]

	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: 'Finalized', value: finalizedDisplay },
		{ label: 'Underfunded', value: underfundedDisplay },
		{ label: 'Auctioned Allowance', value: forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionedSecurityBondAllowance} suffix='ETH' /> },
		{ label: 'Claiming Available', value: claimingAvailableDisplay },
		{ label: 'ETH Raised / Cap', value: ethRaisedCapDisplay },
		{ label: 'REP Purchased', value: truthAuctionStatus === undefined ? forkOnlyFallbackText : <CurrencyValue value={truthAuctionStatus.totalRepPurchased} suffix='REP' /> },
	]

	const stagePanel =
		selectedStage === 'initiate' ? (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<WorkflowSubsection title='Fork Trigger' badge={<span className='badge muted'>{systemState === undefined ? UNKNOWN_VALUE : getSystemStateLabel(systemState)}</span>} className='fork-stage-metrics'>
					{renderWorkflowMetricGrid(initiateStatusMetrics)}
					<div className='actions'>
						<button className='primary' onClick={onForkWithOwnEscalation} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
							Fork With Own Escalation
						</button>
						<button className='secondary' onClick={onInitiateFork} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
							Initiate Pool Fork
						</button>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Direct Universe Fork' className='fork-stage-actions'>
					<div className='form-grid'>
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
							<button className='secondary' onClick={onForkUniverse} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Fork Universe Directly
							</button>
						</div>
					</div>
				</WorkflowSubsection>
			</fieldset>
		) : selectedStage === 'migration' ? (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<WorkflowSubsection title='Migration Status' badge={<span className='badge pending'>Window open</span>} className='fork-stage-metrics'>
					{renderWorkflowMetricGrid(migrationStatusMetrics)}
				</WorkflowSubsection>

				<WorkflowSubsection title='Create Child Universe' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>
						<div className='actions'>
							<button className='primary' onClick={onCreateChildUniverse} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Create {getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Migrate REP' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>REP Migration Outcomes</span>
							<input value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder='yes,no,invalid' />
						</label>
						<div className='actions'>
							<button className='secondary' onClick={onMigrateRepToZoltar} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Migrate REP To Zoltar
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Migrate Vault / Deposits' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>
						<label className='field'>
							<span>Vault Address</span>
							<input value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
						</label>
						<label className='field'>
							<span>Escalation Deposit Indexes</span>
							<input value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder='0,1,2' />
						</label>
						<div className='actions'>
							<button className='primary' onClick={onMigrateVault} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Migrate Vault
							</button>
							<button className='secondary' onClick={onMigrateEscalationDeposits} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Migrate Escalation Deposits
							</button>
						</div>
					</div>
				</WorkflowSubsection>
			</fieldset>
		) : selectedStage === 'auction' ? (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<WorkflowSubsection title='Auction Status' badge={<span className='badge pending'>Live auction</span>} className='fork-stage-metrics'>
					{renderWorkflowMetricGrid(auctionStatusMetrics)}
				</WorkflowSubsection>

				<WorkflowSubsection title='Start Truth Auction' className='fork-stage-actions'>
					<div className='form-grid'>
						<div className='actions'>
							<button className='primary' onClick={onStartTruthAuction} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Start Truth Auction
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Submit Bid' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>Bid Tick</span>
							<input value={forkAuctionForm.submitBidTick} onInput={event => onForkAuctionFormChange({ submitBidTick: event.currentTarget.value })} />
						</label>
						<label className='field'>
							<span>Bid Amount (ETH)</span>
							<input value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
						</label>
						{selectedAuctionPrice === undefined ? undefined : <p className='detail'>At the current clearing price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if it clears.</p>}
						<div className='actions'>
							<button className='secondary' onClick={onSubmitBid} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Submit Bid
							</button>
						</div>
					</div>
				</WorkflowSubsection>
			</fieldset>
		) : (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<WorkflowSubsection title='Settlement Status' badge={<span className='badge ok'>Claims / cleanup</span>} className='fork-stage-metrics'>
					{renderWorkflowMetricGrid(settlementStatusMetrics)}
				</WorkflowSubsection>

				<WorkflowSubsection title='Finalize Truth Auction' className='fork-stage-actions'>
					<div className='form-grid'>
						<div className='actions'>
							<button className='secondary' onClick={onFinalizeTruthAuction} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Finalize Truth Auction
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Refund Losing Bid' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>Refund Tick</span>
							<input value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
						</label>
						<label className='field'>
							<span>Refund Bid Index</span>
							<input value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
						</label>
						<div className='actions'>
							<button className='primary' onClick={onRefundLosingBids} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Refund Losing Bid
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Claim Auction Proceeds' className='fork-stage-actions'>
					<div className='form-grid'>
						<label className='field'>
							<span>Vault Address</span>
							<input value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>Claim Bid Tick</span>
								<input value={forkAuctionForm.claimBidTick} onInput={event => onForkAuctionFormChange({ claimBidTick: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Claim Bid Index</span>
								<input value={forkAuctionForm.claimBidIndex} onInput={event => onForkAuctionFormChange({ claimBidIndex: event.currentTarget.value })} />
							</label>
						</div>
						<div className='actions'>
							<button className='primary' onClick={onClaimAuctionProceeds} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Claim Auction Proceeds
							</button>
						</div>
					</div>
				</WorkflowSubsection>

				<WorkflowSubsection title='Withdraw Bids' className='fork-stage-actions'>
					<div className='form-grid'>
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
							<button className='secondary' onClick={onWithdrawBids} disabled={disabled || accountState.address === undefined || !walletMatchesActiveNetwork}>
								Withdraw Bids
							</button>
						</div>
					</div>
				</WorkflowSubsection>
			</fieldset>
		)

	const content = (
		<>
			<WorkflowSubsection title='Pool Summary' badge={selectedStageBadge}>
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

					{hasLoadedPoolContext ? renderSummaryMetricGrid(poolSummaryMetrics) : <p className='detail'>Load a pool to inspect fork progress, migration, and the truth auction.</p>}
					{resolvedDisabledMessage === undefined ? undefined : <p className='detail'>{resolvedDisabledMessage}</p>}
					{forkStageDescription === undefined ? undefined : <p className='detail'>{forkStageDescription}</p>}
				</div>
			</WorkflowSubsection>

			{question === undefined ? undefined : (
				<WorkflowSubsection title='Question'>
					<Question question={question} />
				</WorkflowSubsection>
			)}

			{hasLoadedPoolContext ? (
				<WorkflowSubsection title='Live Snapshot' badge={<span className='badge muted'>{getStageLabel(selectedStage)}</span>}>
					{renderSummaryMetricGrid(liveSnapshotMetrics)}
				</WorkflowSubsection>
			) : undefined}

			{forkAuctionResult === undefined ? undefined : (
				<LatestActionSection
					title='Latest Fork / Auction Action'
					embedInCard
					badge={<span className='badge ok'>{forkAuctionResult.action}</span>}
					rows={[
						{ label: 'Action', value: forkAuctionResult.action },
						{ label: 'Pool', value: <AddressValue address={forkAuctionResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={forkAuctionResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={forkAuctionResult.hash} /> },
					]}
				/>
			)}

			{hasLoadedPoolContext ? (
				<WorkflowSubsection title='Lifecycle' badge={<span className={`badge ${getStageTone(currentStage)}`}>{getStageLabel(currentStage)}</span>}>
					<div className='subtab-nav fork-stage-nav' role='tablist' aria-label='Fork lifecycle stages'>
						{STAGE_VIEWS.map(stageView => (
							<button key={stageView} className={`subtab-link ${selectedStage === stageView ? 'active' : ''}`} type='button' onClick={() => setSelectedStage(stageView)} aria-pressed={selectedStage === stageView}>
								{getStageLabel(stageView)}
							</button>
						))}
					</div>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
				</WorkflowSubsection>
			) : undefined}

			{hasLoadedPoolContext ? stagePanel : undefined}

			<ErrorNotice message={forkAuctionError} />
		</>
	)

	if (embedInCard) {
		return content
	}

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
					<EntityCard title='Fork & Truth Auction' badge={hasLoadedPoolContext ? selectedStageBadge : undefined}>
						{content}
					</EntityCard>
				</div>
			</div>
		</section>
	)
}
