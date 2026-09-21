import { EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED } from '#state/executor-deployment-recovery'
import type { PublicOperatorSnapshot } from '#state/operator-state'
import { marketAvailabilityPresentation, pollRetryStatus } from './dashboard-format.ts'
import { shorten } from './dom.js'

function failureNoticeTitle(snapshot: PublicOperatorSnapshot, retryState: string | undefined) {
	if (snapshot.retryInProgress) return 'Automatic retry in progress'
	if (retryState === 'due') return 'Automatic retry due'
	return snapshot.lastPollFailureAt === undefined ? 'Operator attention required' : 'Latest poll failed'
}

export function operatorNoticePresentation(snapshot: PublicOperatorSnapshot) {
	let noticeTitle = 'Dry-run mode'
	let noticeCopy = 'Opportunities are monitored, but this process cannot submit transactions. Enable live execution under Settings › Execution mode.'
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
		noticeTone = 'warning'
	}
	if (snapshot.lastError !== undefined) {
		const retry = pollRetryStatus(snapshot)
		noticeTitle = failureNoticeTitle(snapshot, retry?.state)
		const failure = retry === undefined ? snapshot.lastError : snapshot.lastError.replace(/ Automatic retry remains active\.$/, '')
		const failureTime = snapshot.lastPollFailureAt === undefined ? '' : ` Poll failed at ${new Date(snapshot.lastPollFailureAt).toLocaleTimeString()}.`
		const nextRetry = retry?.state === 'scheduled' && snapshot.nextRetryAt !== undefined ? ` Next automatic retry is scheduled for ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const retryDue = retry?.state === 'due' && snapshot.nextRetryAt !== undefined ? ` Automatic retry became due at ${new Date(snapshot.nextRetryAt).toLocaleTimeString()}.` : ''
		const lastRetry = snapshot.lastRetryAt === undefined ? '' : ` ${snapshot.retryInProgress ? 'Automatic retry' : 'Last automatic retry'} started at ${new Date(snapshot.lastRetryAt).toLocaleTimeString()}.`
		noticeCopy = `${failure}${failureTime}${nextRetry}${retryDue}${lastRetry}`
		noticeTone = 'danger'
	}
	// The recovery notice outranks everything else: no other notice explains why Resume is refused, and the poll status stays visible in the header.
	if (snapshot.executorDeploymentRecovery !== undefined) {
		noticeTitle = 'Executor deployment recovery required'
		noticeCopy = executorDeploymentRecoveryCopy(snapshot.executorDeploymentRecovery)
		noticeTone = 'danger'
	}
	return { noticeTitle, noticeCopy, noticeTone }
}

const EXECUTOR_DEPLOYMENT_RECOVERY_ACTION = 'Run Deploy predictable executor under Settings › Venues and executor with the same signer to confirm or rebroadcast it'

/**
 * The notice keeps the hash scannable; the executor form links the full transaction beside its copy.
 * Beside the deploy button the copy names the button's effect instead of routing the operator to where they already are.
 */
export function executorDeploymentRecoveryCopy(recovery: NonNullable<PublicOperatorSnapshot['executorDeploymentRecovery']>, surface: 'notice' | 'executor-form' = 'notice') {
	const transaction = surface === 'notice' ? `Executor deployment ${shorten(recovery.transactionHash, 10, 8)}` : 'The executor deployment'
	const action = surface === 'notice' ? EXECUTOR_DEPLOYMENT_RECOVERY_ACTION : 'Deploying again with the same signer confirms or rebroadcasts it'
	return `${transaction} was signed but its receipt was never confirmed. ${action}; Resume stays blocked until then.`
}

/** A refused pause or resume keeps the bot's reason verbatim and adds the recovery step when that reason is the pending recovery. */
export function pauseFailurePresentation(failure: string) {
	const noticeCopy = failure === EXECUTOR_DEPLOYMENT_RECOVERY_REQUIRED ? `${failure}. ${EXECUTOR_DEPLOYMENT_RECOVERY_ACTION}.` : failure
	return { noticeTitle: 'Unable to change bot state', noticeCopy, noticeTone: 'danger' }
}
