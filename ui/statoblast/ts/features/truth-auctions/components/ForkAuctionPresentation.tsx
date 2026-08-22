import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '@zoltar/ui-zoltar/copy/forkAuction.js'
import { Fragment, type ComponentChildren } from 'preact'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView } from '../lib/forkAuction.js'
import { estimateRepPurchased } from '../lib/truthAuctionBook.js'
import { formatCurrencyInputBalance, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import { type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import { getVisualRatio } from '@zoltar/ui-core-shared/lib/visualMetrics.js'
import type { ForkAuctionDetails, ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js'

function sameBigIntArray(left: bigint[], right: bigint[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

export function sameBigIntRecord(left: Record<ReportingOutcomeKey, bigint[]>, right: Record<ReportingOutcomeKey, bigint[]>) {
	return sameBigIntArray(left.invalid, right.invalid) && sameBigIntArray(left.yes, right.yes) && sameBigIntArray(left.no, right.no)
}

export type DisplayMetric = {
	label: string
	value: ComponentChildren
}
type TruthAuctionStateBadge = {
	label: string
	tone: 'blocked' | 'muted' | 'ok' | 'pending'
}

type MigrationStateBadge = {
	label: string
	tone: 'muted' | 'ok' | 'pending'
}

export const FORK_MIGRATION_DURATION = 4_838_400n
const FORK_WORKFLOW_NAV_STAGES: readonly ForkWorkflowSelectionStage[] = ['fork-triggered', 'migration', 'auction', 'settlement']
function getForkWorkflowStageLabel(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return forkAuctionCopy.forkReadiness
		case 'migration':
			return forkAuctionCopy.migration
		case 'auction':
			return commonCopy.truthAuction
		case 'settlement':
			return commonCopy.settlement
		default:
			return assertNever(stage)
	}
}

function getForkWorkflowStageOrder(stage: ForkWorkflowSelectionStage) {
	return FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
}

function getForkWorkflowStageIcon(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-triggered' />
		case 'migration':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-migration' />
		case 'auction':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-auction' />
		case 'settlement':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-settlement' />
		default:
			return assertNever(stage)
	}
}

export function getTruthAuctionWindow(startedAt: bigint | undefined) {
	if (startedAt === undefined || startedAt === 0n) return undefined
	return {
		startedAt,
		endsAt: startedAt + AUCTION_TIME_SECONDS,
	}
}
export function renderMetricValue(value: bigint | undefined, suffix: string, fallbackText: string) {
	if (value === undefined) return fallbackText
	return <CurrencyValue value={value} suffix={suffix} />
}

export function renderTruthAuctionPriceValue(value: bigint | undefined, fallbackText: string = commonCopy.metricUnavailablePlaceholder) {
	if (value === undefined) return fallbackText
	const formattedPrice = formatRoundedCurrencyBalance(value, 18, 4)
	const exactPrice = formatCurrencyInputBalance(value)
	return (
		<span className='truth-auction-price-value' title={forkAuctionCopy.formatEthPerRepValue(exactPrice)}>
			{formattedPrice} {forkAuctionCopy.ethRep}
		</span>
	)
}
export function renderAddress(address: string | undefined) {
	if (address === undefined) return commonCopy.metricUnavailablePlaceholder
	return <AddressValue address={address} />
}
export function renderTimestamp({ displayTimestamp, fallbackText }: { displayTimestamp: bigint | undefined; fallbackText: string }) {
	if (displayTimestamp === undefined) return fallbackText
	return <TimestampValue timestamp={displayTimestamp} />
}
export function renderTruthAuctionCapacityOwnershipNotice(showRefundOnlySettlementCopy = false) {
	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' surface='flat' variant='compact'>
				<p className='detail'>
					<strong>{forkAuctionCopy.refundSettlementDetail}</strong> {forkAuctionCopy.formatFinalizedRefundOnlySettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' surface='flat' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.formatWinningClaimCapacityOwnershipHeadline(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}</strong> {forkAuctionCopy.formatWinningClaimSettlementNotice(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)}
			</p>
		</WarningSurface>
	)
}

export function renderTruthAuctionSettlementSelectionSummary({
	estimatedAssignedCapacityOwnershipAttoRep,
	estimatedRefundedAttoEth,
	estimatedVaultRepBackingAttoRep,
	selectedClaimCount,
	selectedRefundCount,
	selectedRowCount,
}: {
	estimatedAssignedCapacityOwnershipAttoRep: bigint | undefined
	estimatedRefundedAttoEth: bigint
	estimatedVaultRepBackingAttoRep: bigint | undefined
	selectedClaimCount: number
	selectedRefundCount: number
	selectedRowCount: number
}) {
	if (selectedRowCount === 0) return undefined

	const summaryDescription = (() => {
		if (selectedClaimCount > 0 && selectedRefundCount > 0) {
			return forkAuctionCopy.formatMixedSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		if (selectedClaimCount > 0) {
			return forkAuctionCopy.formatWinningSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		return forkAuctionCopy.formatRefundSettlementPreviewDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
	})()

	const refundDescription = estimatedRefundedAttoEth > 0n ? forkAuctionCopy.truthAuctionRefundEstimateDetail : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedVaultRepBackingAttoRep === undefined) {
			roundingDescription = forkAuctionCopy.underfundedWinningClaimUnavailable
		} else {
			roundingDescription = forkAuctionCopy.settlementRoundingNotice
		}
	}

	return (
		<WarningSurface as='section' surface='flat' variant='compact'>
			<p className='detail'>
				<strong>{forkAuctionCopy.selectedBidSettlementPreview}</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: forkAuctionCopy.selectedBids, value: selectedRowCount.toString() },
				{ label: forkAuctionCopy.selectedWinningBids, value: selectedClaimCount.toString() },
				{ label: forkAuctionCopy.selectedRefundRows, value: selectedRefundCount.toString() },
				{ label: forkAuctionCopy.estimatedVaultRepBackingAttoRep, value: estimatedVaultRepBackingAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedVaultRepBackingAttoRep} suffix={commonCopy.rep} /> },
				{ label: forkAuctionCopy.formatEstimatedValue(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL), value: estimatedAssignedCapacityOwnershipAttoRep === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedAssignedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
				{ label: forkAuctionCopy.estimatedRefundedAttoEth, value: <CurrencyValue value={estimatedRefundedAttoEth} suffix={commonCopy.eth} /> },
			])}
			{roundingDescription === undefined ? undefined : <p className='detail'>{roundingDescription}</p>}
			{refundDescription === undefined ? undefined : <p className='detail'>{refundDescription}</p>}
		</WarningSurface>
	)
}

export function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? commonCopy.metricUnavailablePlaceholder : forkAuctionCopy.forkUnavailablePlaceholder
}

export function getForkTypeLabel(forkOwnSecurityPool: boolean) {
	return forkOwnSecurityPool ? forkAuctionCopy.ownEscalationFork : forkAuctionCopy.parentZoltarFork
}

export function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return commonCopy.metricUnavailablePlaceholder
	if (!hasPreviewForkActivity) return forkAuctionCopy.forkUnavailablePlaceholder
	if (isSyntheticForkTriggerPreview) return forkAuctionCopy.notChosen
	return getForkTypeLabel(previewPool.forkOwnSecurityPool)
}
export function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return commonCopy.metricUnavailablePlaceholder
	if (!hasPreviewForkActivity) return forkAuctionCopy.forkUnavailablePlaceholder
	if (previewPool.truthAuctionStartedAt > 0n) return commonCopy.metricUnavailablePlaceholder
	return commonCopy.metricUnavailablePlaceholder
}
export function getForkWorkflowStageAheadMessage(stage: ForkWorkflowSelectionStage, currentStage: ForkWorkflowSelectionStage) {
	if (getForkWorkflowStageOrder(stage) <= getForkWorkflowStageOrder(currentStage)) return undefined
	return undefined
}

function getForkWorkflowStageClassName({ currentStage, selectedStage, stage }: { currentStage: ForkWorkflowSelectionStage; selectedStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage']
	if (currentStage === stage) classNames.push('is-current')
	if (selectedStage === stage) classNames.push('is-selected')
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) > getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}

function getForkWorkflowSeparatorClassName({ currentStage, stage }: { currentStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage-separator']
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) >= getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}

export function ForkWorkflowStageNavigator({ currentStage, onStageChange, selectedStage }: { currentStage: ForkWorkflowSelectionStage; onStageChange: ((stage: ForkWorkflowSelectionStage) => void) | undefined; selectedStage: ForkWorkflowSelectionStage }) {
	const handleKeyDown = (stage: ForkWorkflowSelectionStage, event: KeyboardEvent) => {
		const currentStageIndex = FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
		if (currentStageIndex === -1) return
		const nextStage = (() => {
			if (event.key === 'ArrowRight') return FORK_WORKFLOW_NAV_STAGES[Math.min(currentStageIndex + 1, FORK_WORKFLOW_NAV_STAGES.length - 1)]
			if (event.key === 'ArrowLeft') return FORK_WORKFLOW_NAV_STAGES[Math.max(currentStageIndex - 1, 0)]
			if (event.key === 'Home') return FORK_WORKFLOW_NAV_STAGES[0]
			if (event.key === 'End') return FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1]
			return undefined
		})()
		if (nextStage === undefined) return
		event.preventDefault()
		onStageChange?.(nextStage)
		const nextTab = document.getElementById(`fork-workflow-stage-${nextStage}`)
		if (nextTab instanceof HTMLElement) nextTab.focus()
	}

	return (
		<div className='fork-workflow-stage-nav-shell'>
			<div aria-label={forkAuctionCopy.forkLifecycleStages} className='fork-workflow-stage-nav' role='tablist'>
				{FORK_WORKFLOW_NAV_STAGES.map(stage => {
					const stageLabel = getForkWorkflowStageLabel(stage)
					return (
						<Fragment key={stage}>
							<button
								aria-controls={`fork-workflow-stage-panel-${stage}`}
								aria-current={currentStage === stage ? 'step' : undefined}
								aria-label={stageLabel}
								aria-selected={selectedStage === stage}
								className={getForkWorkflowStageClassName({ currentStage, selectedStage, stage })}
								id={`fork-workflow-stage-${stage}`}
								onClick={() => onStageChange?.(stage)}
								onKeyDown={event => handleKeyDown(stage, event)}
								role='tab'
								tabIndex={selectedStage === stage ? 0 : -1}
								type='button'
							>
								{getForkWorkflowStageIcon(stage)}
								<span className='fork-workflow-stage-copy'>
									<strong>{stageLabel}</strong>
									{selectedStage === stage ? <span className='fork-workflow-stage-indicator'>{forkAuctionCopy.viewing}</span> : undefined}
								</span>
							</button>
							{stage === FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1] ? undefined : (
								<span aria-hidden='true' className={getForkWorkflowSeparatorClassName({ currentStage, stage })}>
									→
								</span>
							)}
						</Fragment>
					)
				})}
			</div>
		</div>
	)
}
export function renderWorkflowMetricGrid(metrics: DisplayMetric[]) {
	return (
		<MetricGrid>
			{metrics.map(metric => (
				<MetricField key={metric.label} label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</MetricGrid>
	)
}

export function ForkAuctionMigrationSummaryCard({
	badge,
	forkAuctionDetails,
	forkTypeDisplay,
	migratedRepDisplay,
	migrationEndsDisplay,
	migrationStartedDisplay,
	repAtForkDisplay,
	settlementCollateralDisplay,
}: {
	badge: ComponentChildren
	forkAuctionDetails: ForkAuctionDetails | undefined
	forkTypeDisplay: ComponentChildren
	migratedRepDisplay: ComponentChildren
	migrationEndsDisplay: ComponentChildren
	migrationStartedDisplay: ComponentChildren
	repAtForkDisplay: ComponentChildren
	settlementCollateralDisplay: ComponentChildren
}) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card migration-summary-card' title={forkAuctionCopy.migrationStatus} variant='embedded'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					{[
						{ label: forkAuctionCopy.repAtFork, value: repAtForkDisplay },
						{ label: forkAuctionCopy.migratedAttoRep, value: migratedRepDisplay },
						{ label: forkAuctionCopy.settlementCollateral, value: settlementCollateralDisplay },
					].map(metric => (
						<div className='fork-workflow-summary-stat-group' key={metric.label}>
							<div className='fork-workflow-summary-stat-copy'>
								<span>{metric.label}</span>
								<strong>{metric.value}</strong>
							</div>
						</div>
					))}
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={forkAuctionCopy.migrationStarted}>{migrationStartedDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.migrationEnds}>{migrationEndsDisplay}</MetricField>
					<MetricField label={forkAuctionCopy.forkType}>{forkTypeDisplay}</MetricField>
				</div>
			</div>
			{forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={forkAuctionCopy.advancedDiagnostics}>
					<div className='fork-workflow-summary-metrics'>
						<MetricField label={forkAuctionCopy.totalPoolHeldRepAtForkAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtForkAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escalationChildRepPerSelectedOutcomeAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escalationChildRepPerSelectedOutcomeAttoRep} suffix={commonCopy.rep} />
						</MetricField>
						<MetricField label={forkAuctionCopy.escrowSourceRepAtForkAttoRep}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtForkAttoRep} suffix={commonCopy.rep} />
						</MetricField>
					</div>
				</ReadOnlyDetailAccordion>
			)}
		</SectionBlock>
	)
}

function renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice }: { auctionOutcomeSelector: ComponentChildren; childSecurityPools: ListedSecurityPool[]; renderSelectedOutcomeChildPoolNotice: () => ComponentChildren }) {
	return (
		<SectionBlock density='compact' headingLevel={4} title={forkAuctionCopy.childSecurityPools} variant='embedded'>
			{auctionOutcomeSelector}
			{renderSelectedOutcomeChildPoolNotice()}
			{childSecurityPools.length === 0 ? null : (
				<div className='fork-workflow-child-pool-list'>
					{childSecurityPools.map(pool => (
						<article className='fork-workflow-child-pool-card' key={pool.securityPoolAddress}>
							<div className='fork-workflow-child-pool-card-copy'>
								<strong>{pool.questionOutcome === 'none' ? forkAuctionCopy.pendingOutcome : getReportingOutcomeLabel(pool.questionOutcome)}</strong>
								<span>{pool.systemState === 'operational' ? commonCopy.operational : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedAttoRep: pool.migratedAttoRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
							</div>
							<div className='fork-workflow-child-pool-card-meta'>
								<span>
									<AddressValue address={pool.securityPoolAddress} />
								</span>
								<SecurityPoolLink securityPoolAddress={pool.securityPoolAddress} universeId={pool.universeId}>
									{forkAuctionCopy.openSecurityPool}
								</SecurityPoolLink>
							</div>
						</article>
					))}
				</div>
			)}
		</SectionBlock>
	)
}

export function ForkAuctionOutcomeStage({
	auctionOutcomeSelector,
	auctionStatusMetrics,
	auctionWideBidsSection,
	auctionWideBidsStatusSection,
	childSecurityPools,
	disabled,
	hasStartedTruthAuction,
	importedForkSettlementSection,
	renderSelectedOutcomeChildPoolNotice,
	selectedStage,
	selectedStageAheadMessage,
	settlementStatusMetrics,
	shouldShowVisualization,
	startTruthAuctionSection,
	submitBidSection,
	truthAuctionEndedNotice,
	truthAuctionHero,
	truthAuctionMarketViewSection,
	truthAuctionSettlementSection,
	truthAuctionStateBadgeElement,
	viewerTruthAuctionBidsSection,
}: {
	auctionOutcomeSelector: ComponentChildren
	auctionStatusMetrics: DisplayMetric[]
	auctionWideBidsSection: ComponentChildren
	auctionWideBidsStatusSection: ComponentChildren
	childSecurityPools: ListedSecurityPool[]
	disabled: boolean
	hasStartedTruthAuction: boolean
	importedForkSettlementSection: ComponentChildren
	renderSelectedOutcomeChildPoolNotice: () => ComponentChildren
	selectedStage: ForkWorkflowSelectionStage
	selectedStageAheadMessage: string | undefined
	settlementStatusMetrics: DisplayMetric[]
	shouldShowVisualization: boolean
	startTruthAuctionSection: ComponentChildren
	submitBidSection: ComponentChildren
	truthAuctionEndedNotice: ComponentChildren
	truthAuctionHero: ComponentChildren
	truthAuctionMarketViewSection: ComponentChildren
	truthAuctionSettlementSection: ComponentChildren
	truthAuctionStateBadgeElement: ComponentChildren
	viewerTruthAuctionBidsSection: ComponentChildren
}) {
	if (selectedStage === 'auction') {
		return (
			<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
				{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
				{auctionOutcomeSelector}
				{renderSelectedOutcomeChildPoolNotice()}
				{truthAuctionEndedNotice}
				{shouldShowVisualization ? (
					<>
						{truthAuctionHero}
						<ReadOnlyDetailAccordion title={forkAuctionCopy.marketDepth}>{truthAuctionMarketViewSection}</ReadOnlyDetailAccordion>
						{submitBidSection}
						{viewerTruthAuctionBidsSection}
						{auctionWideBidsSection}
					</>
				) : (
					<>
						<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.truthAuctionStatus} variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>
						{hasStartedTruthAuction ? undefined : startTruthAuctionSection}
						{submitBidSection}
						{auctionWideBidsStatusSection}
					</>
				)}
			</fieldset>
		)
	}
	if (selectedStage !== 'settlement') return undefined
	return (
		<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
			{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
			{truthAuctionEndedNotice}
			{shouldShowVisualization ? (
				<>
					{truthAuctionHero}
					{viewerTruthAuctionBidsSection}
				</>
			) : (
				<>
					<SectionBlock badge={truthAuctionStateBadgeElement} title={forkAuctionCopy.settlementStatus} variant='embedded'>
						{renderWorkflowMetricGrid(settlementStatusMetrics)}
					</SectionBlock>
					{auctionWideBidsStatusSection}
				</>
			)}
			{truthAuctionSettlementSection}
			{importedForkSettlementSection}
			{renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice })}
		</fieldset>
	)
}

export function estimateBidRep(bidAmount: string, bidPrice: bigint | undefined) {
	if (bidPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, bidPrice)
}
export function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= migrationEndsAt) return forkAuctionCopy.truthAuctionMigrationPendingDetail
	return undefined
}

export function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return forkAuctionCopy.migrationTimingIsUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp > migrationEndsAt) return forkAuctionCopy.parentMigrationExpiredDetail
	return undefined
}

export function getTruthAuctionBypassReason({ migratedAttoRep, parentSettlementCollateralAttoEthAmount, auctionableAttoRepAtFork }: { migratedAttoRep: bigint; parentSettlementCollateralAttoEthAmount: bigint | undefined; auctionableAttoRepAtFork: bigint | undefined }) {
	if (parentSettlementCollateralAttoEthAmount === 0n) return forkAuctionCopy.truthAuctionNoCollateralDetail
	if (auctionableAttoRepAtFork === undefined) return undefined
	if (auctionableAttoRepAtFork === 0n) return forkAuctionCopy.truthAuctionNoRepDetail
	if (migratedAttoRep >= auctionableAttoRepAtFork) return forkAuctionCopy.childUniverseFullyMigratedDetail
	return undefined
}

export function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return forkAuctionCopy.loadingTruthAuction
	if (truthAuction.finalized) return forkAuctionCopy.truthAuctionFinalizedReason
	if (truthAuctionEndsAt === undefined) return forkAuctionCopy.auctionEndTimeUnavailable
	if (currentTimestamp === undefined) return forkAuctionCopy.loadingCurrentChainTime
	if (currentTimestamp <= truthAuctionEndsAt) return forkAuctionCopy.auctionOngoingReason
	return undefined
}

export function clampPercentage(value: bigint, maxValue: bigint) {
	return (getVisualRatio({ value, maxValue }) ?? 0) * 100
}

export function getTruthAuctionStateBadge({
	hasSelectedAuctionChildPool,
	isStartTruthAuctionInProgress,
	startTruthAuctionCountdown,
	truthAuction,
	truthAuctionStartedAt,
}: {
	hasSelectedAuctionChildPool: boolean
	isStartTruthAuctionInProgress: boolean
	startTruthAuctionCountdown: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
	truthAuctionStartedAt: bigint
}): TruthAuctionStateBadge {
	if (truthAuction === undefined) {
		if (isStartTruthAuctionInProgress || (hasSelectedAuctionChildPool && truthAuctionStartedAt === 0n && startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)) {
			return { label: commonCopy.pending, tone: 'pending' }
		}
		if (truthAuctionStartedAt > 0n) return { label: forkAuctionCopy.started, tone: 'pending' }
		return { label: forkAuctionCopy.inactive, tone: 'muted' }
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
			return { label: forkAuctionCopy.clearing, tone: 'pending' }
		}
		return { label: forkAuctionCopy.open, tone: 'pending' }
	}
	if (truthAuction.underfunded) return { label: forkAuctionCopy.shortfall, tone: 'blocked' }
	if (truthAuction.hitCap) return { label: commonCopy.settled, tone: 'ok' }
	return { label: forkAuctionCopy.unfilled, tone: 'muted' }
}

export function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }): MigrationStateBadge {
	if (migrationEndsAt === undefined) return { label: forkAuctionCopy.notStartedBadgeLabel, tone: 'muted' }
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: forkAuctionCopy.closed, tone: 'ok' }
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: forkAuctionCopy.closed, tone: 'ok' }
	return { label: forkAuctionCopy.open, tone: 'pending' }
}

export function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}
