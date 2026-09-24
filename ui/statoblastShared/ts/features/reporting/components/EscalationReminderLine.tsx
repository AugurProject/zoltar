import { useEffect, useState } from 'preact/hooks'
import type { ActiveReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { buildEscalationReminder } from '../lib/escalationReminder.js'
import { formatReportingDeadline, getViewerStatusSentence } from '../lib/reportingViewerStatus.js'
import { isPoolQuestionFinalized } from '../lib/reportingDomain.js'

export function EscalationReminderLine({ details }: { details: ActiveReportingDetails }) {
	const [previousDeadline, setPreviousDeadline] = useState(details.escalationEndTime)
	const [movedDeadline, setMovedDeadline] = useState<bigint | undefined>(undefined)
	const [dismissed, setDismissed] = useState(false)
	useEffect(() => {
		if (details.escalationEndTime === previousDeadline) return
		setPreviousDeadline(details.escalationEndTime)
		if (!dismissed) setMovedDeadline(details.escalationEndTime)
	}, [details.escalationEndTime, previousDeadline, dismissed])
	const deadline = formatReportingDeadline(details.escalationEndTime, details.currentTime)
	const open = !isPoolQuestionFinalized(details) && !details.hasReachedNonDecision && details.systemState === 'operational'
	const download = () => {
		const calendar = buildEscalationReminder({ securityPoolAddress: details.securityPoolAddress, escalationEndTime: details.escalationEndTime, currentTime: details.currentTime, questionTitle: details.marketDetails.title, status: getViewerStatusSentence(details), pageUrl: location.href })
		const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
		const link = document.createElement('a')
		link.href = url
		link.download = 'statoblast-escalation.ics'
		link.click()
		setTimeout(() => URL.revokeObjectURL(url), 0)
	}
	return (
		<>
			{movedDeadline === undefined || dismissed ? undefined : (
				<div className='notice notice-stack-item warning closeable' role='status'>
					<button className='notice-dismiss' type='button' aria-label={copy.dismissDeadlineNotice} onClick={() => setDismissed(true)}>
						<span className='notice-dismiss-icon' aria-hidden='true' />
					</button>
					{copy.deadlineMoved(formatReportingDeadline(movedDeadline, details.currentTime))}
				</div>
			)}
			{open ? (
				<div>
					<p className='detail'>{copy.checkBack(deadline)}</p>
					<button className='quiet' type='button' onClick={download}>
						{copy.addReminder}
					</button>
				</div>
			) : undefined}
		</>
	)
}
