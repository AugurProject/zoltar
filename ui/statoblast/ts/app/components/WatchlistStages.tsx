import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/watchlist.js'
import { getReportingOutcomeLabel } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reporting.js'
import type { WatchlistRow } from '@zoltar/ui-statoblast-shared/protocol/watchlistRows.js'

function stageDate(lead: string, timestamp: bigint | undefined) {
	if (timestamp === undefined || timestamp === 0n) return undefined
	return (
		<div className='statoblast-watchlist-stage-date'>
			{lead}
			<TimestampValue timestamp={timestamp} relative={false} />
		</div>
	)
}

function wasTradingOrReporting(row: WatchlistRow) {
	if (row.question === undefined || row.forkedAt === undefined || row.forkedAt === 0n) return undefined
	if (row.question.marketDetails.endTime > row.forkedAt) return copy.wasTrading
	if (row.escalationEnd !== undefined && row.escalationEnd >= row.forkedAt) return copy.wasInResponseWindow
	return undefined
}

export function WatchlistQuestionStage({ row, reason }: { row: WatchlistRow | undefined; reason: string | undefined }) {
	if (reason !== undefined) return <Badge tone='warning'>{reason}</Badge>
	const question = row?.question
	if (row === undefined || question === undefined) return <Badge>{copy.checking}</Badge>
	if (question.questionOutcome !== 'none') {
		const balanceKey = { yes: 'yesAttoShares', no: 'noAttoShares', invalid: 'invalidAttoShares' } as const
		return (
			<>
				<Badge tone='ok'>{copy.formatResolvedAs(getReportingOutcomeLabel(question.questionOutcome))}</Badge>
				{(row.shares?.[balanceKey[question.questionOutcome]] ?? 0n) > 0n && <div className='statoblast-watchlist-stage-date'>{copy.sharesRedeemable}</div>}
			</>
		)
	}
	if (question.universeHasForked) {
		if (row.forkQuestionId === undefined) return <Badge>{copy.frozen}</Badge>
		if (row.entity.kind === 'question' && row.forkQuestionId === row.entity.questionId) {
			return (
				<>
					<Badge tone='danger'>{copy.forkQuestion}</Badge>
					<div className='statoblast-watchlist-stage-date'>{copy.forkQuestionResolution}</div>
				</>
			)
		}
		const canMoveShares = row.shares !== undefined && Object.values(row.shares).some(amount => amount > 0n)
		const prior = wasTradingOrReporting(row)
		return (
			<>
				{canMoveShares ? <div className='statoblast-watchlist-stage-date'>{copy.migrateShares}</div> : <Badge>{copy.frozen}</Badge>}
				{prior !== undefined && <div className='statoblast-watchlist-stage-date'>{prior}</div>}
				{(row.reportingPrincipal ?? 0n) > 0n && <div className='statoblast-watchlist-stage-date'>{copy.depositsCarryOver}</div>}
			</>
		)
	}
	if (row.nonDecision) return <Badge tone='danger'>{copy.endedUndecided}</Badge>
	if (question.ordinaryEscalationGameStarted || (row.escalationEnd ?? 0n) > 0n) {
		return (
			<>
				<Badge tone='warning'>{copy.responseWindow}</Badge>
				{stageDate(copy.responseEndsLead, row.escalationEnd)}
			</>
		)
	}
	if (row.observedAt !== undefined && row.observedAt >= question.marketDetails.endTime) return <Badge tone='warning'>{copy.reportingOpen}</Badge>
	return (
		<>
			<Badge>{copy.trading}</Badge>
			{stageDate(copy.reportingOpensLead, question.marketDetails.endTime)}
		</>
	)
}

export function WatchlistPoolForkStage({ row }: { row: WatchlistRow | undefined }) {
	if (row === undefined || row.forkedAt === undefined || row.forkedAt === 0n) return <Badge>{copy.checking}</Badge>
	const { forkChoiceRecorded, forkChoiceOutcome, forkChoiceDeadline, forkBranchReady, forkBranchStarted, observedAt } = row
	if (forkChoiceRecorded) {
		if (forkBranchReady) return <Badge tone='ok'>{forkChoiceOutcome === undefined ? copy.branchActive : copy.formatBranchActive(forkChoiceOutcome)}</Badge>
		if (forkBranchStarted) return <Badge tone='warning'>{forkChoiceOutcome === undefined ? copy.branchRecapitalizing : copy.formatBranchRecapitalizing(forkChoiceOutcome)}</Badge>
		return (
			<>
				<Badge tone='ok'>{forkChoiceOutcome === undefined ? copy.branchChosen : copy.formatMovingTo(forkChoiceOutcome)}</Badge>
				{forkChoiceDeadline !== undefined && observedAt !== undefined && observedAt < forkChoiceDeadline && stageDate(copy.migrationOpensLead, forkChoiceDeadline)}
			</>
		)
	}
	if (forkChoiceRecorded === false && (row.pledged ?? 0n) > 0n && forkChoiceDeadline !== undefined && observedAt !== undefined) {
		if (observedAt >= forkChoiceDeadline) return <Badge tone='warning'>{copy.choiceWindowClosed}</Badge>
		return (
			<>
				<Badge tone='danger'>{copy.chooseChildUniverse}</Badge>
				{stageDate(copy.forkChoiceByLead, forkChoiceDeadline)}
				<div className='statoblast-watchlist-stage-date'>
					{copy.forkChoiceConsequenceLead}
					<CurrencyValue value={row.pledged} suffix={copy.rep} />
					{copy.forkChoiceConsequenceTail}
				</div>
			</>
		)
	}
	return <Badge>{copy.frozen}</Badge>
}
