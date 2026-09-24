import { getReportingOutcomeLabel } from './reporting.js'
import { formatCurrencyBalance, formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import { metricUnavailablePlaceholder } from '@zoltar/ui-core-shared/copy/common.js'
import { protocolGuideHref } from '@zoltar/ui-core-shared/copy/app.js'
import type { ActiveReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { getHypotheticalClaimAmount, getReportingMinimumOutcomeChangeContribution, getStrictLeadingEscalationOutcome } from './reportingDomain.js'

export const escalationExplanationHref = new URL('explanation/escalation-game.html', protocolGuideHref).href

export function formatReportingDeadline(deadline: bigint, currentTime: bigint) {
	return `${formatTimestamp(deadline).replace(/:\d{2} UTC$/, ' UTC')} · ${formatRelativeTimestamp(deadline, currentTime)}`
}

export function getViewerPositions(details: ActiveReportingDetails) {
	const leader = getStrictLeadingEscalationOutcome(details.sides)
	const deadline = formatReportingDeadline(details.escalationEndTime, details.currentTime)
	return details.sides
		.filter(side => side.userDeposits.length > 0 || side.importedUserDeposits.length > 0)
		.map(side => {
			const deposits = [...side.userDeposits, ...side.importedUserDeposits]
			const stake = deposits.reduce((sum, deposit) => sum + deposit.amountAttoRep, 0n)
			const worth = leader === undefined ? undefined : deposits.reduce((sum, deposit) => sum + (getHypotheticalClaimAmount(details, side.key, deposit) ?? 0n), 0n)
			const leading = leader === side.key
			const minimum = getReportingMinimumOutcomeChangeContribution(details, side.key).amountAttoRep
			const lead = leading ? copy.winningStatusLead(side.label) : copy.losingStatusLead(side.label)
			const detail = leading ? copy.winningStatusDetail(formatCurrencyBalance(stake), formatCurrencyBalance(worth ?? 0n)) : copy.losingStatusDetail(minimum === undefined ? metricUnavailablePlaceholder : formatCurrencyBalance(minimum), deadline, formatCurrencyBalance(stake))
			let positionStatus = copy.losingPosition
			if (details.hasReachedNonDecision || details.systemState !== 'operational') positionStatus = copy.forkPosition
			else if (worth === undefined) positionStatus = copy.tiedPosition
			else if (leading) positionStatus = copy.winningPosition(formatCurrencyBalance(worth))
			return { side, stake, worth, leading, minimum, lead, detail, positionStatus }
		})
		.sort((a, b) => Number(b.leading) - Number(a.leading))
}

export function getViewerStatusSentence(details: ActiveReportingDetails) {
	if (details.hasReachedNonDecision || details.systemState !== 'operational') return copy.forkPosition
	const leader = getStrictLeadingEscalationOutcome(details.sides)
	if (leader === undefined) return `${copy.tieStatusLead} ${copy.tieStatusDetail(formatReportingDeadline(details.escalationEndTime, details.currentTime))}${copy.tiesResolve}${copy.tieStatusEnd}`
	const positions = getViewerPositions(details)
	if (positions.length === 0) return copy.activeNext(formatReportingDeadline(details.escalationEndTime, details.currentTime), getReportingOutcomeLabel(leader))
	return positions.map(position => `${position.lead} ${position.detail}`).join(' ')
}
