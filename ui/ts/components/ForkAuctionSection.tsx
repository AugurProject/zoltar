import { Fragment } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { AddressValue } from './AddressValue.js'
import { ActionLauncherCard } from './ActionLauncherCard.js'
import { ChildUniverseDeploymentModal } from './ChildUniverseDeploymentModal.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EntityCard } from './EntityCard.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { LatestActionSection } from './LatestActionSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { Question } from './Question.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { UniverseLink } from './UniverseLink.js'
import { TimestampValue } from './TimestampValue.js'
import { ViewTabs } from './ViewTabs.js'
import { AUCTION_TIME_SECONDS, type ForkAuctionStageView, estimateRepPurchased, getForkAuctionStageView, getForkStageDescription, getForkStageDescriptionForState, getOutcomeActionLabel, getSystemStateLabel, getTimeRemaining, hasForkActivity, MIGRATION_TIME_SECONDS } from '../lib/forkAuction.js'
import { formatDuration } from '../lib/formatters.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import type { ListedSecurityPool } from '../types/contracts.js'
import type { ForkAuctionSectionProps, ReadinessAction } from '../types/components.js'

const UNKNOWN_VALUE = '—'
const UNAVAILABLE_UNTIL_FORK = 'Unavailable until fork'
const STAGE_VIEWS: readonly ForkAuctionStageView[] = ['initiate', 'migration', 'auction', 'settlement']
const STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Initiate',
	migration: 'Migration',
	auction: 'Auction',
	settlement: 'Settlement',
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
	accountState,
	disabled = false,
	disabledMessage,
	embedInCard = false,
	forkAuctionDetails,
	forkAuctionActiveAction,
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
	const [childUniverseModalOpen, setChildUniverseModalOpen] = useState(false)
	const lastPoolKeyRef = useRef<string | undefined>(undefined)
	const selectedStageAheadMessage = getStageAheadMessage(selectedStage, currentStage)
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
	const baseDisabledReason = disabledMessage ?? (accountState.address === undefined ? 'Connect a wallet before using fork and auction actions.' : !isMainnet ? 'Switch to Ethereum mainnet before using fork and auction actions.' : undefined)
	const childUniverseRequirements = [
		{ key: 'pool', label: 'Forked pool loaded', resolved: hasLoadedPoolContext, ...(hasLoadedPoolContext ? {} : { detail: 'Load a forked pool before creating a child universe.' }) },
		{ key: 'outcome', label: 'Outcome selected', resolved: forkAuctionForm.selectedOutcome !== undefined, ...(forkAuctionForm.selectedOutcome === undefined ? { detail: 'Select the outcome whose child universe you want to create.' } : {}) },
		{ key: 'wallet', label: 'Wallet connected', resolved: accountState.address !== undefined, ...(accountState.address !== undefined ? {} : { detail: 'Connect a wallet before creating a child universe.' }) },
		{ key: 'mainnet', label: 'Ethereum mainnet selected', resolved: isMainnet, ...(isMainnet ? {} : { detail: 'Switch to Ethereum mainnet before creating a child universe.' }) },
	]
	const createChildUniverseLauncherAction: ReadinessAction = {
		actionLabel: 'Open Child Universe Flow',
		description: 'Review the selected outcome and confirm the child-universe creation in a bounded execution modal.',
		key: 'create-child-universe',
		...(hasLoadedPoolContext ? { onAction: () => setChildUniverseModalOpen(true) } : {}),
		readiness: hasLoadedPoolContext ? 'ready' : 'blocked',
		title: `Create ${getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe`,
		...(hasLoadedPoolContext ? {} : { blocker: 'Load fork details for this pool first.' }),
	}

	const renderStageActionButton = ({ action, idleLabel, onClick, pendingLabel, tone = 'secondary' }: { action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>; idleLabel: string; onClick: () => void; pendingLabel: string; tone?: 'primary' | 'secondary' }) => (
		<TransactionActionButton idleLabel={idleLabel} pendingLabel={pendingLabel} onClick={onClick} pending={forkAuctionActiveAction === action} tone={tone} availability={{ disabled: disabled || accountState.address === undefined || !isMainnet, reason: baseDisabledReason }} />
	)

	useEffect(() => {
		if (lastPoolKeyRef.current === securityPoolAddress) return
		lastPoolKeyRef.current = securityPoolAddress
		setSelectedStage(currentStage)
	}, [currentStage, securityPoolAddress])

	useEffect(() => {
		if (forkAuctionResult?.action !== 'createChildUniverse') return
		setChildUniverseModalOpen(false)
	}, [forkAuctionResult])

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
				<SectionBlock title='Fork Trigger'>{renderWorkflowMetricGrid(initiateStatusMetrics)}</SectionBlock>

				<SectionBlock title='Fork With Own Escalation'>
					<div className='actions'>{renderStageActionButton({ action: 'forkWithOwnEscalation', idleLabel: 'Fork With Own Escalation', onClick: onForkWithOwnEscalation, pendingLabel: 'Forking with own escalation...', tone: 'primary' })}</div>
				</SectionBlock>

				<SectionBlock title='Initiate Pool Fork'>
					<div className='actions'>{renderStageActionButton({ action: 'initiateFork', idleLabel: 'Initiate Pool Fork', onClick: onInitiateFork, pendingLabel: 'Initiating pool fork...' })}</div>
				</SectionBlock>

				<SectionBlock title='Direct Universe Fork'>
					<div className='form-grid'>
						<div className='field-row'>
							<label className='field'>
								<span>Direct Fork Universe ID</span>
								<FormInput value={forkAuctionForm.directForkUniverseId} onInput={event => onForkAuctionFormChange({ directForkUniverseId: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Direct Fork Question ID</span>
								<FormInput value={forkAuctionForm.directForkQuestionId} onInput={event => onForkAuctionFormChange({ directForkQuestionId: event.currentTarget.value })} placeholder='0x...' />
							</label>
						</div>
						<div className='actions'>{renderStageActionButton({ action: 'forkUniverse', idleLabel: 'Fork Universe Directly', onClick: onForkUniverse, pendingLabel: 'Forking universe directly...' })}</div>
					</div>
				</SectionBlock>
			</fieldset>
		) : selectedStage === 'migration' ? (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<SectionBlock title='Migration Status'>{renderWorkflowMetricGrid(migrationStatusMetrics)}</SectionBlock>

				<SectionBlock title='Create Child Universe'>
					<div className='form-grid'>
						<label className='field'>
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>
						<ActionLauncherCard action={createChildUniverseLauncherAction}>
							<p className='detail'>Selected outcome: {getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)}</p>
						</ActionLauncherCard>
					</div>
				</SectionBlock>

				<SectionBlock title='Migrate REP'>
					<div className='form-grid'>
						<label className='field'>
							<span>REP Migration Outcomes</span>
							<FormInput value={forkAuctionForm.repMigrationOutcomes} onInput={event => onForkAuctionFormChange({ repMigrationOutcomes: event.currentTarget.value })} placeholder='yes,no,invalid' />
						</label>
						<div className='actions'>{renderStageActionButton({ action: 'migrateRepToZoltar', idleLabel: 'Migrate REP To Zoltar', onClick: onMigrateRepToZoltar, pendingLabel: 'Migrating REP to Zoltar...' })}</div>
					</div>
				</SectionBlock>

				<SectionBlock title='Migrate Vault'>
					<div className='form-grid'>
						<label className='field'>
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>
						<label className='field'>
							<span>Vault Address</span>
							<FormInput value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
						</label>
						<div className='actions'>{renderStageActionButton({ action: 'migrateVault', idleLabel: 'Migrate Vault', onClick: onMigrateVault, pendingLabel: 'Migrating vault...', tone: 'primary' })}</div>
					</div>
				</SectionBlock>

				<SectionBlock title='Migrate Escalation Deposits'>
					<div className='form-grid'>
						<label className='field'>
							<span>Outcome</span>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
						</label>
						<label className='field'>
							<span>Escalation Deposit Indexes</span>
							<FormInput value={forkAuctionForm.depositIndexes} onInput={event => onForkAuctionFormChange({ depositIndexes: event.currentTarget.value })} placeholder='0,1,2' />
						</label>
						<div className='actions'>{renderStageActionButton({ action: 'migrateEscalationDeposits', idleLabel: 'Migrate Escalation Deposits', onClick: onMigrateEscalationDeposits, pendingLabel: 'Migrating escalation deposits...' })}</div>
					</div>
				</SectionBlock>
			</fieldset>
		) : selectedStage === 'auction' ? (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<SectionBlock title='Auction Status'>{renderWorkflowMetricGrid(auctionStatusMetrics)}</SectionBlock>

				<SectionBlock title='Start Truth Auction'>
					<div className='actions'>{renderStageActionButton({ action: 'startTruthAuction', idleLabel: 'Start Truth Auction', onClick: onStartTruthAuction, pendingLabel: 'Starting truth auction...', tone: 'primary' })}</div>
				</SectionBlock>

				<SectionBlock title='Submit Bid'>
					<div className='form-grid'>
						<label className='field'>
							<span>Bid Tick</span>
							<FormInput value={forkAuctionForm.submitBidTick} onInput={event => onForkAuctionFormChange({ submitBidTick: event.currentTarget.value })} />
						</label>
						<label className='field'>
							<span>Bid Amount (ETH)</span>
							<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
						</label>
						{selectedAuctionPrice === undefined ? undefined : <p className='detail'>At the current clearing price, this bid would buy roughly {estimatedRep === undefined ? UNKNOWN_VALUE : <CurrencyValue value={estimatedRep} suffix='REP' />} if it clears.</p>}
						<div className='actions'>{renderStageActionButton({ action: 'submitBid', idleLabel: 'Submit Bid', onClick: onSubmitBid, pendingLabel: 'Submitting bid...' })}</div>
					</div>
				</SectionBlock>
			</fieldset>
		) : (
			<fieldset className='fork-stage-panel' disabled={disabled}>
				<SectionBlock title='Settlement Status'>{renderWorkflowMetricGrid(settlementStatusMetrics)}</SectionBlock>

				<SectionBlock title='Finalize Truth Auction'>
					<div className='actions'>{renderStageActionButton({ action: 'finalizeTruthAuction', idleLabel: 'Finalize Truth Auction', onClick: onFinalizeTruthAuction, pendingLabel: 'Finalizing truth auction...' })}</div>
				</SectionBlock>

				<SectionBlock title='Refund Losing Bid'>
					<div className='form-grid'>
						<label className='field'>
							<span>Refund Tick</span>
							<FormInput value={forkAuctionForm.refundTick} onInput={event => onForkAuctionFormChange({ refundTick: event.currentTarget.value })} />
						</label>
						<label className='field'>
							<span>Refund Bid Index</span>
							<FormInput value={forkAuctionForm.refundBidIndex} onInput={event => onForkAuctionFormChange({ refundBidIndex: event.currentTarget.value })} />
						</label>
						<div className='actions'>{renderStageActionButton({ action: 'refundLosingBids', idleLabel: 'Refund Losing Bid', onClick: onRefundLosingBids, pendingLabel: 'Refunding losing bid...', tone: 'primary' })}</div>
					</div>
				</SectionBlock>

				<SectionBlock title='Claim Auction Proceeds'>
					<div className='form-grid'>
						<label className='field'>
							<span>Vault Address</span>
							<FormInput value={forkAuctionForm.vaultAddress} onInput={event => onForkAuctionFormChange({ vaultAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
						</label>
						<div className='field-row'>
							<label className='field'>
								<span>Claim Bid Tick</span>
								<FormInput value={forkAuctionForm.claimBidTick} onInput={event => onForkAuctionFormChange({ claimBidTick: event.currentTarget.value })} />
							</label>
							<label className='field'>
								<span>Claim Bid Index</span>
								<FormInput value={forkAuctionForm.claimBidIndex} onInput={event => onForkAuctionFormChange({ claimBidIndex: event.currentTarget.value })} />
							</label>
						</div>
						<div className='actions'>{renderStageActionButton({ action: 'claimAuctionProceeds', idleLabel: 'Claim Auction Proceeds', onClick: onClaimAuctionProceeds, pendingLabel: 'Claiming auction proceeds...', tone: 'primary' })}</div>
					</div>
				</SectionBlock>

				<SectionBlock title='Withdraw Bids'>
					<div className='form-grid'>
						<div className='field-row'>
							<label className='field'>
								<span>Withdraw For Address</span>
								<FormInput value={forkAuctionForm.withdrawForAddress} onInput={event => onForkAuctionFormChange({ withdrawForAddress: event.currentTarget.value })} placeholder='Leave empty to use connected wallet' />
							</label>
							<label className='field'>
								<span>Withdraw Tick</span>
								<FormInput value={forkAuctionForm.withdrawTick} onInput={event => onForkAuctionFormChange({ withdrawTick: event.currentTarget.value })} />
							</label>
						</div>
						<label className='field'>
							<span>Withdraw Bid Index</span>
							<FormInput value={forkAuctionForm.withdrawBidIndex} onInput={event => onForkAuctionFormChange({ withdrawBidIndex: event.currentTarget.value })} />
						</label>
						<div className='actions'>{renderStageActionButton({ action: 'withdrawBids', idleLabel: 'Withdraw Bids', onClick: onWithdrawBids, pendingLabel: 'Withdrawing bids...' })}</div>
					</div>
				</SectionBlock>
			</fieldset>
		)

	const content = (
		<>
			{showSecurityPoolAddressInput ? (
				<ReadOnlyDetailAccordion title='Pool Context'>
					<div className='form-grid'>
						<LookupFieldRow
							label='Security Pool Address'
							value={forkAuctionForm.securityPoolAddress}
							onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })}
							placeholder='0x...'
							action={
								<button className='secondary' onClick={onLoadForkAuction} disabled={loadingForkAuctionDetails}>
									{loadingForkAuctionDetails ? <LoadingText>Loading fork...</LoadingText> : 'Refresh fork'}
								</button>
							}
						/>

						{hasLoadedPoolContext ? renderSummaryMetricGrid(poolSummaryMetrics) : <p className='detail'>Load a pool to inspect fork progress, migration, and the truth auction.</p>}
						{disabledMessage === undefined ? undefined : <p className='detail'>{disabledMessage}</p>}
						{forkStageDescription === undefined ? undefined : <p className='detail'>{forkStageDescription}</p>}
					</div>
				</ReadOnlyDetailAccordion>
			) : undefined}

			{question === undefined ? undefined : (
				<EntityCard title='Question' variant='record'>
					<Question question={question} />
				</EntityCard>
			)}

			{hasLoadedPoolContext ? <ReadOnlyDetailAccordion title='Live Snapshot'>{renderSummaryMetricGrid(liveSnapshotMetrics)}</ReadOnlyDetailAccordion> : undefined}

			{forkAuctionResult === undefined ? undefined : (
				<LatestActionSection
					title='Latest Fork / Auction Action'
					embedInCard={embedInCard}
					rows={[
						{ label: 'Action', value: forkAuctionResult.action },
						{ label: 'Pool', value: <AddressValue address={forkAuctionResult.securityPoolAddress} /> },
						{ label: 'Universe', value: <UniverseLink universeId={forkAuctionResult.universeId} /> },
						{ label: 'Transaction', value: <TransactionHashLink hash={forkAuctionResult.hash} /> },
					]}
				/>
			)}

			{hasLoadedPoolContext ? (
				<SectionBlock title='Lifecycle'>
					<ViewTabs
						ariaLabel='Fork lifecycle stages'
						value={selectedStage}
						onChange={setSelectedStage}
						options={STAGE_VIEWS.map(stageView => ({
							label: getStageLabel(stageView),
							value: stageView,
						}))}
					/>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
				</SectionBlock>
			) : undefined}

			{hasLoadedPoolContext ? stagePanel : undefined}

			<ChildUniverseDeploymentModal
				actionAvailability={{ disabled: disabled || accountState.address === undefined || !isMainnet, reason: baseDisabledReason }}
				description='Confirm the selected fork outcome and create its child universe in one bounded transaction flow.'
				idleLabel={`Create ${getOutcomeActionLabel(forkAuctionForm.selectedOutcome)} Child Universe`}
				isOpen={childUniverseModalOpen}
				onClose={() => setChildUniverseModalOpen(false)}
				onConfirm={onCreateChildUniverse}
				pending={forkAuctionActiveAction === 'createChildUniverse'}
				pendingLabel='Creating child universe...'
				requirements={childUniverseRequirements}
				title='Create Child Universe'
				tone='primary'
			>
				<SectionBlock headingLevel={4} title='Child Universe Context' variant='embedded'>
					<div className='workflow-metric-grid'>
						<MetricField label='Selected Outcome'>{getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)}</MetricField>
						<MetricField label='Pool'>{securityPoolAddress === undefined ? UNKNOWN_VALUE : <AddressValue address={securityPoolAddress} />}</MetricField>
						<MetricField label='Universe'>{universeId === undefined ? UNKNOWN_VALUE : <UniverseLink universeId={universeId} />}</MetricField>
						<MetricField label='Stage'>{getStageLabel(currentStage)}</MetricField>
					</div>
				</SectionBlock>
			</ChildUniverseDeploymentModal>

			<ErrorNotice message={forkAuctionError} />
		</>
	)

	if (embedInCard) {
		return content
	}

	return (
		<RouteWorkflowPanel description='Open a pool to inspect fork progress, migration, and the truth auction.' showHeader={showHeader} title='Fork & Truth Auction'>
			{content}
		</RouteWorkflowPanel>
	)
}
