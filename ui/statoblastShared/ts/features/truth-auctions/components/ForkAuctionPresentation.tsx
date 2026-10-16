import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StatoblastSecurityPoolLink } from '../../security-pools/components/StatoblastSecurityPoolLink.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { getForkAuctionStageLabel, getForkAuctionStageView } from '../lib/forkAuction.js'
import { getTruthAuctionEndsAt } from '../../../protocol/truthAuctionTiming.js'
import { formatCurrencyInputBalance, formatRoundedCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { type ForkWorkflowSelectionStage } from '../../security-pools/lib/securityPoolWorkflow.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '../../../types/contracts.js'

export { clampPercentage, getFinalizeTruthAuctionGuardMessage, getMigrationStateBadge, getMigrationWindowClosedGuardMessage, getStartTruthAuctionGuardMessage, getTruthAuctionBypassReason, getTruthAuctionStateBadge, isFullReadClient } from './ForkAuctionPresentationState.js'

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
const FORK_WORKFLOW_NAV_STAGES: readonly ForkWorkflowSelectionStage[] = ['fork-triggered', 'migration', 'auction', 'settlement']
function getForkWorkflowStageLabel(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return forkAuctionCopy.forkTrigger
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

export function getTruthAuctionWindow(startedAt: bigint | undefined) {
	const endsAt = getTruthAuctionEndsAt(startedAt)
	return startedAt === undefined || endsAt === undefined ? undefined : { startedAt, endsAt }
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
export function renderTruthAuctionSettlementSelectionSummary({
	estimatedAssignedUnderwritingLimitAttoEth,
	estimatedRefundedAttoEth,
	estimatedVaultRepBackingAttoRep,
	selectedClaimCount,
	selectedRefundCount,
	selectedRowCount,
}: {
	estimatedAssignedUnderwritingLimitAttoEth: bigint | undefined
	estimatedRefundedAttoEth: bigint
	estimatedVaultRepBackingAttoRep: bigint | undefined
	selectedClaimCount: number
	selectedRefundCount: number
	selectedRowCount: number
}) {
	if (selectedRowCount === 0) return undefined

	const summaryDescription = (() => {
		if (selectedClaimCount > 0 && selectedRefundCount > 0) return forkAuctionCopy.mixedSettlementPreviewDetail
		if (selectedClaimCount > 0) return forkAuctionCopy.winningSettlementPreviewDetail
		return forkAuctionCopy.refundSettlementPreviewDetail
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
				{ label: forkAuctionCopy.estimatedUnderwritingCommitments, value: estimatedAssignedUnderwritingLimitAttoEth === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={estimatedAssignedUnderwritingLimitAttoEth} suffix={commonCopy.eth} /> },
				{ label: forkAuctionCopy.estimatedRefundedAttoEth, value: <CurrencyValue value={estimatedRefundedAttoEth} suffix={commonCopy.eth} /> },
			])}
			{roundingDescription === undefined ? undefined : <p className='detail'>{roundingDescription}</p>}
			{refundDescription === undefined ? undefined : <p className='detail'>{refundDescription}</p>}
		</WarningSurface>
	)
}

export function getForkTypeLabel(forkOwnSecurityPool: boolean) {
	return forkOwnSecurityPool ? forkAuctionCopy.ownEscalationFork : forkAuctionCopy.parentZoltarFork
}

export function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return commonCopy.metricUnavailablePlaceholder
	if (!hasPreviewForkActivity) return commonCopy.metricUnavailablePlaceholder
	if (isSyntheticForkTriggerPreview) return forkAuctionCopy.notChosen
	return getForkTypeLabel(previewPool.forkOwnSecurityPool)
}
export function getForkWorkflowStageAheadMessage(stage: ForkWorkflowSelectionStage, currentStage: ForkWorkflowSelectionStage) {
	if (getForkWorkflowStageOrder(stage) <= getForkWorkflowStageOrder(currentStage)) return undefined
	return undefined
}

function getForkWorkflowStageClassName({ currentStage, selectedStage, stage }: { currentStage: ForkWorkflowSelectionStage; selectedStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage']
	if (currentStage === stage) classNames.push('is-current')
	if (selectedStage === stage) classNames.push('is-selected')
	if (getForkWorkflowStageOrder(stage) > getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}

/** The fork stages are sub-views of the Fork & migration tab, shown as sub-tabs: the header's stage bar carries the pool's progress, so these mark only the current stage and the one on view, and dim the stages still ahead. */
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
				{FORK_WORKFLOW_NAV_STAGES.map(stage => (
					<button
						key={stage}
						aria-controls={`fork-workflow-stage-panel-${stage}`}
						aria-current={currentStage === stage ? 'step' : undefined}
						aria-selected={selectedStage === stage}
						className={getForkWorkflowStageClassName({ currentStage, selectedStage, stage })}
						id={`fork-workflow-stage-${stage}`}
						onClick={() => onStageChange?.(stage)}
						onKeyDown={event => handleKeyDown(stage, event)}
						role='tab'
						tabIndex={selectedStage === stage ? 0 : -1}
						type='button'
					>
						{getForkWorkflowStageLabel(stage)}
					</button>
				))}
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
	migratedRepLabel,
	migrationEnd,
	migrationStartedDisplay,
	repAtForkDisplay,
	settlementCollateralDisplay,
}: {
	badge: ComponentChildren
	forkAuctionDetails: ForkAuctionDetails | undefined
	forkTypeDisplay: ComponentChildren
	migratedRepDisplay: ComponentChildren
	migratedRepLabel: string
	/** When migration ends and whether it already has; undefined while the pool header's strip already shows the migration deadline. */
	migrationEnd: { display: ComponentChildren; ended: boolean } | undefined
	migrationStartedDisplay: ComponentChildren
	repAtForkDisplay: ComponentChildren
	/** Undefined while the pool header's strip already shows the settlement collateral, so the card does not repeat it. */
	settlementCollateralDisplay: ComponentChildren | undefined
}) {
	return (
		<SectionBlock badge={badge} className='fork-workflow-summary-card migration-summary-card' title={forkAuctionCopy.migrationStatus} variant='embedded'>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					{[{ label: forkAuctionCopy.repAtFork, value: repAtForkDisplay }, { label: migratedRepLabel, value: migratedRepDisplay }, ...(settlementCollateralDisplay === undefined ? [] : [{ label: forkAuctionCopy.settlementCollateral, value: settlementCollateralDisplay }])].map(metric => (
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
					{migrationEnd === undefined ? undefined : <MetricField label={migrationEnd.ended ? forkAuctionCopy.migrationEnded : forkAuctionCopy.migrationEnds}>{migrationEnd.display}</MetricField>}
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
								<StatoblastSecurityPoolLink securityPoolAddress={pool.securityPoolAddress} universeId={pool.universeId}>
									{forkAuctionCopy.openSecurityPool}
								</StatoblastSecurityPoolLink>
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
	biddingClosed,
	childSecurityPools,
	disabled,
	hasStartedTruthAuction,
	importedForkSettlementSection,
	renderSelectedOutcomeChildPoolNotice,
	selectedStage,
	selectedStageAheadMessage,
	settlementStatusMetrics,
	showChildSecurityPools,
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
	/** The auction is finalized or past its end time, so the bid form and market depth give way to the finalize step. */
	biddingClosed: boolean
	childSecurityPools: ListedSecurityPool[]
	disabled: boolean
	hasStartedTruthAuction: boolean
	importedForkSettlementSection: ComponentChildren
	renderSelectedOutcomeChildPoolNotice: () => ComponentChildren
	selectedStage: ForkWorkflowSelectionStage
	selectedStageAheadMessage: string | undefined
	settlementStatusMetrics: DisplayMetric[]
	showChildSecurityPools: boolean
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
				{selectedStageAheadMessage === undefined ? undefined : <UserMessage className='detail' detail={selectedStageAheadMessage} />}
				{auctionOutcomeSelector}
				{renderSelectedOutcomeChildPoolNotice()}
				{truthAuctionEndedNotice}
				{shouldShowVisualization ? (
					<>
						{truthAuctionHero}
						{biddingClosed ? undefined : (
							<>
								<ReadOnlyDetailAccordion defaultOpen title={forkAuctionCopy.marketDepth}>
									{truthAuctionMarketViewSection}
								</ReadOnlyDetailAccordion>
								{submitBidSection}
							</>
						)}
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
			{selectedStageAheadMessage === undefined ? undefined : <UserMessage className='detail' detail={selectedStageAheadMessage} />}
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
			{showChildSecurityPools ? renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice }) : undefined}
		</fieldset>
	)
}
