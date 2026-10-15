import { getDisplayedLeadingEscalationOutcome, getReportingOutcomeLabel } from './reporting.js'
import { formatAmountDisplay, formatRelativeTimestamp, formatTimestamp, type AmountRounding } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { protocolGuideHref } from '@zoltar/ui-core-shared/copy/app.js'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { getHypotheticalClaimAmount, getReportingMinimumOutcomeChangeContribution } from './reportingDomain.js'

export const escalationExplanationHref = new URL('explanation/escalation-game.html', protocolGuideHref).href

export function formatReportingDeadline(deadline: bigint, currentTime: bigint) {
	return `${formatTimestamp(deadline).replace(/:\d{2} UTC$/, ' UTC')} · ${formatRelativeTimestamp(deadline, currentTime)}`
}

/**
 * The viewer's position on each side they backed. `renderAmount` presents a REP amount, with its unit, inside the status
 * sentences: the UI passes a rounded value that shows the exact amount on hover, and plain text passes a rounded string.
 * The minimum to take the lead is rendered rounding `up`, so adding the shown figure always takes the lead.
 */
export function getViewerPositions<Amount>(details: ActiveReportingDetails, renderAmount: (attoRep: bigint, rounding?: AmountRounding) => Amount) {
	const leader = getDisplayedLeadingEscalationOutcome(details.sides)
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
			const detail: copy.CopyParts<Amount> = leading ? copy.winningStatusDetail(renderAmount(stake), renderAmount(worth ?? 0n)) : copy.losingStatusDetail(minimum === undefined ? undefined : renderAmount(minimum, 'up'), deadline, renderAmount(stake))
			let positionStatus: copy.CopyParts<Amount> = [copy.losingPosition]
			if (details.hasReachedNonDecision || details.systemState !== 'operational') positionStatus = [copy.forkPosition]
			else if (worth === undefined) positionStatus = [copy.tiedPosition]
			else if (leading) positionStatus = copy.winningPosition(renderAmount(worth))
			return { side, stake, worth, leading, minimum, lead, detail, positionStatus }
		})
		.sort((a, b) => Number(b.leading) - Number(a.leading))
}

/** A REP amount as rounded plain text, for sentences outside the page such as a calendar reminder. */
function formatRoundedRep(attoRep: bigint, rounding: AmountRounding = 'nearest') {
	return `${formatAmountDisplay(attoRep, { rounding })} ${commonCopy.rep}`
}

export function getViewerStatusSentence(details: ActiveReportingDetails) {
	if (details.hasReachedNonDecision || details.systemState !== 'operational') return copy.forkPosition
	const leader = getDisplayedLeadingEscalationOutcome(details.sides)
	if (details.sides.every(side => side.balance === 0n)) return `${copy.tieStatusLead} ${copy.zeroBalanceStatusDetail}`
	if (leader === undefined) return `${copy.tieStatusLead} ${copy.tieStatusDetail(formatReportingDeadline(details.escalationEndTime, details.currentTime))}${copy.tiesResolve}${copy.tieStatusEnd}`
	const positions = getViewerPositions(details, formatRoundedRep)
	if (positions.length === 0) return copy.formatLeaderWinsNext(formatReportingDeadline(details.escalationEndTime, details.currentTime), getReportingOutcomeLabel(leader))
	return positions.map(position => `${position.lead} ${position.detail.join('')}`).join(' ')
}
