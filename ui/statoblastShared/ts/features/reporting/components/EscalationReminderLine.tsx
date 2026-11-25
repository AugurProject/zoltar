import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useEffect, useState } from 'preact/hooks'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { buildEscalationReminder } from '../lib/escalationReminder.js'
import { formatReportingDeadline, getViewerStatusSentence } from '../lib/reportingViewerStatus.js'
import { isPoolQuestionFinalized } from '../lib/reportingDomain.js'

// iCalendar timestamps use a four-digit year.
const LAST_CALENDAR_DEADLINE = 253_402_300_799n

export function EscalationReminderLine({ details }: { details: ActiveReportingDetails }) {
	const [previousDeadline, setPreviousDeadline] = useState(details.escalationEndTime)
	const [movedDeadline, setMovedDeadline] = useState<bigint | undefined>(undefined)
	const open = !isPoolQuestionFinalized(details) && !details.hasReachedNonDecision && details.systemState === 'operational' && details.currentTime <= details.escalationEndTime && details.escalationEndTime <= LAST_CALENDAR_DEADLINE
	useEffect(() => {
		setPreviousDeadline(details.escalationEndTime)
		if (!open) setMovedDeadline(undefined)
		else if (previousDeadline <= LAST_CALENDAR_DEADLINE && details.escalationEndTime !== previousDeadline) setMovedDeadline(details.escalationEndTime)
	}, [details.escalationEndTime, previousDeadline, open])
	if (!open) return undefined
	const alarmInFuture = details.currentTime + 75n * 60n < details.escalationEndTime
	const deadline = formatReportingDeadline(details.escalationEndTime, details.currentTime)
	const download = () => {
		const calendar = buildEscalationReminder({ questionLedgerAddress: details.questionLedgerAddress, escalationEndTime: details.escalationEndTime, generatedAt: BigInt(Math.floor(Date.now() / 1000)), questionTitle: details.marketDetails.title, status: getViewerStatusSentence(details), pageUrl: location.href })
		const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
		const link = document.createElement('a')
		link.href = url
		link.download = 'statoblast-escalation.ics'
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	return (
		<>
			{movedDeadline === undefined ? undefined : (
				<UserMessage
					announcement='polite'
					detail={copy.deadlineMoved(formatReportingDeadline(movedDeadline, details.currentTime))}
					actions={
						<>
							{alarmInFuture ? (
								<button className='quiet' type='button' onClick={download}>
									{copy.updateReminder}
								</button>
							) : undefined}
							<button className='quiet' type='button' aria-label={copy.dismissDeadlineNotice} onClick={() => setMovedDeadline(undefined)}>
								{copy.dismissReminderUpdate}
							</button>
						</>
					}
				/>
			)}
			{movedDeadline === undefined ? (
				<UserMessage
					detail={copy.checkBack(deadline)}
					actions={
						alarmInFuture ? (
							<button className='quiet' type='button' onClick={download}>
								{copy.addReminder}
							</button>
						) : undefined
					}
				/>
			) : undefined}
		</>
	)
}
