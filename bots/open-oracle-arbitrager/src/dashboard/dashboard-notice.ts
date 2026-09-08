import type { PublicOperatorSnapshot } from '#state/operator-state'
import { marketAvailabilityPresentation, pollRetryStatus } from './dashboard-format.ts'

export function operatorNoticePresentation(snapshot: PublicOperatorSnapshot) {
	let noticeTitle = 'Dry-run mode'
	let noticeCopy = 'Opportunities are monitored, but this process cannot submit transactions. Enable runtime.execute in the configuration to change modes.'
	let noticeTone = 'info'
	if (snapshot.execute) {
		noticeTitle = 'Execution mode is locally armed'
		noticeCopy = 'The local wallet can submit disputes when every strategy, timing, inventory, state, and delivery guard passes.'
		noticeTone = 'warning'
	}
	if (!snapshot.operatorCapable) {
		noticeTitle = 'Operator not ready'
		noticeCopy = 'Check the latest poll and execution settings before starting new work.'
		if (snapshot.lastPollAt === undefined) noticeCopy = 'Waiting for the first successful poll. Check RPC connectivity in Settings if polling does not complete.'
		else if (snapshot.execute && snapshot.wallet === undefined) noticeCopy = 'Configure a local signer in Settings before starting execution.'
		noticeTone = 'warning'
	}
	if (snapshot.paused) {
		noticeTitle = 'Bot paused'
		noticeCopy = 'New entries are paused. Settlement and withdrawal continue for already-funded positions so capital is not stranded.'
		noticeTone = 'warning'
	}
	const availability = marketAvailabilityPresentation(snapshot.marketAvailability)
	if (availability !== undefined) {
		noticeTitle = availability.title
		noticeCopy = availability.detail
		noticeTone = 'info'
	}
	if (snapshot.lastError !== undefined) {
		const retry = pollRetryStatus(snapshot)
		noticeTitle = snapshot.retryInProgress ? 'Automatic retry in progress' : retry?.state === 'due' ? 'Automatic retry due' : snapshot.lastPollFailureAt === undefined ? 'Operator attention required' : 'Latest poll failed'
		const failure = retry === undefined ? snapshot.lastError : snapshot.lastError.replace(/ Automatic retry remains active\.$/, '')
		const failureTime = snapshot.lastPollFailureAt === undefined ? '' : ` Poll failed at ${new Date(snapshot.lastPollFailureAt).toLocaleTimeString()}.`
		const nextRetry = retry?.state === 'scheduled' && snapshot.nextRetryAt !== undefined ? ` Next automatic retry is scheduled for ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const retryDue = retry?.state === 'due' && snapshot.nextRetryAt !== undefined ? ` Automatic retry became due at ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const lastRetry = snapshot.lastRetryAt === undefined ? '' : ` ${snapshot.retryInProgress ? 'Automatic retry' : 'Last automatic retry'} started at ${new Date(snapshot.lastRetryAt).toLocaleTimeString()}.`
		noticeCopy = `${failure}${failureTime}${nextRetry}${retryDue}${lastRetry}`
		noticeTone = 'danger'
	}
	return { noticeTitle, noticeCopy, noticeTone }
}
