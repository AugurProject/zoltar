import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { useEffect, useState } from 'preact/hooks'
import type { ActiveReportingDetails } from '../../../types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { buildEscalationReminder } from '../lib/escalationReminder.js'
import { formatReportingDeadline, getViewerStatusSentence } from '../lib/reportingViewerStatus.js'
import { isPoolQuestionFinalized } from '../lib/reportingDomain.js'

export function EscalationReminderLine({ details }: { details: ActiveReportingDetails }) {
	const [previousDeadline, setPreviousDeadline] = useState(details.escalationEndTime)
	const [movedDeadline, setMovedDeadline] = useState<bigint | undefined>(undefined)
	const open = !isPoolQuestionFinalized(details) && !details.hasReachedNonDecision && details.systemState === 'operational' && details.currentTime <= details.escalationEndTime
	useEffect(() => {
		setPreviousDeadline(details.escalationEndTime)
		if (!open) setMovedDeadline(undefined)
		else if (details.escalationEndTime !== previousDeadline) setMovedDeadline(details.escalationEndTime)
	}, [details.escalationEndTime, previousDeadline, open])
	const deadline = formatReportingDeadline(details.escalationEndTime, details.currentTime)
	const download = () => {
		const calendar = buildEscalationReminder({ securityPoolAddress: details.securityPoolAddress, escalationEndTime: details.escalationEndTime, generatedAt: BigInt(Math.floor(Date.now() / 1000)), questionTitle: details.marketDetails.title, status: getViewerStatusSentence(details), pageUrl: location.href })
		const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
		const link = document.createElement('a')
		link.href = url
		link.download = 'statoblast-escalation.ics'
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 1000)
	}
	return (
		<>
			{!open || movedDeadline === undefined ? undefined : (
				<UserMessage
					announcement='polite'
					detail={copy.deadlineMoved(formatReportingDeadline(movedDeadline, details.currentTime))}
					actions={
						<>
							<button className='quiet' type='button' onClick={download}>
								{copy.updateReminder}
							</button>
							<button className='quiet' type='button' aria-label={copy.dismissDeadlineNotice} onClick={() => setMovedDeadline(undefined)}>
								{copy.dismissReminderUpdate}
							</button>
						</>
					}
				/>
			)}
			{open && movedDeadline === undefined ? (
				<UserMessage
					detail={copy.checkBack(deadline)}
					actions={
						<button className='quiet' type='button' onClick={download}>
							{copy.addReminder}
						</button>
					}
				/>
			) : undefined}
		</>
	)
}
