import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { expectedNonPollFailure, expectedRpcOperatorFailure, expectedRpcPollFailure } from './fixture-constants.mts'
import { fixture } from './fixture-state.mts'
import { assertStableSafetyActions, readSafetyActionPositions } from './safety-checks.mts'

const EMPTY_DISPUTE_PATHS = 'No historical dispute path is available. Configured coordinator mode reads current reports directly, while coordinator-free diagnostic mode reconstructs paths from its configured event lookback.'

async function readStatusState(session: BrowserSession) {
	return await session.read(`(() => {
		const badge = document.querySelector('#run-status-badge')
		const active = document.querySelector('.section-nav a[aria-current="page"]')
		const attention = document.querySelector('#attention-badge')
		const header = document.querySelector('.operator-shell')
		const notice = document.querySelector('#notice')
		return {
			activeHref: active?.getAttribute('href'),
			attentionHref: attention?.getAttribute('href'),
			attentionText: attention?.textContent,
			bodyScrollWidth: document.body.scrollWidth,
			clientWidth: document.documentElement.clientWidth,
			disputePathsEmptyText: document.querySelector('#dispute-paths-empty')?.textContent,
			hash: window.location.hash,
			label: badge?.textContent,
			noticeCopy: document.querySelector('#notice-copy')?.textContent,
			retryLabel: document.querySelector('#retry-status-badge')?.textContent,
			retryLive: document.querySelector('#retry-status-badge')?.getAttribute('aria-live'),
			retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0,
			bodyContainsCredential: document.body.textContent?.includes('operator-secret') === true,
			endpointText: document.querySelector('#endpoint-checks')?.textContent,
			noticeTitle: document.querySelector('#notice-title')?.textContent,
			noticeTone: notice instanceof HTMLElement ? notice.dataset.tone : undefined,
			operationDetailsWidth: document.querySelector('#operations-body td[data-label="Details"]')?.getBoundingClientRect().width,
			operationReasonWidth: document.querySelector('#operations-body td[data-label="Why"]')?.getBoundingClientRect().width,
			operationTableWidth: document.querySelector('#operations-body')?.closest('table')?.getBoundingClientRect().width,
			operationText: document.querySelector('#operations-body')?.textContent,
			status: badge instanceof HTMLElement ? badge.dataset.status : undefined,
			transactionTableWidth: document.querySelector('#transactions-body')?.closest('table')?.getBoundingClientRect().width,
			transactionTargetWidth: document.querySelector('#transactions-body td[data-label="Target results"]')?.getBoundingClientRect().width,
			transactionText: document.querySelector('#transactions-body')?.textContent,
		}
	})()`)
}

/** The error state must link its attention badge to the notice, show only public failure text, and announce the scheduled retry. */
function errorStateExposesRecovery(value: object) {
	return (
		'attentionHref' in value &&
		value.attentionHref === '/overview#notice' &&
		'attentionText' in value &&
		value.attentionText === '1 action' &&
		'hash' in value &&
		value.hash === '#notice' &&
		'activeHref' in value &&
		value.activeHref === '/overview' &&
		'noticeTone' in value &&
		value.noticeTone === 'danger' &&
		'noticeTitle' in value &&
		value.noticeTitle === 'Latest poll failed' &&
		'noticeCopy' in value &&
		typeof value.noticeCopy === 'string' &&
		value.noticeCopy.startsWith(expectedRpcPollFailure.replace(/ Automatic retry remains active\.$/, '')) &&
		value.noticeCopy.includes('returned HTTP 400 while calling eth_getLogs') &&
		value.noticeCopy.match(/eth_getLogs/g)?.length === 1 &&
		value.noticeCopy.includes('Poll failed at ') &&
		value.noticeCopy.includes('Next automatic retry is scheduled for ') &&
		'retryLabel' in value &&
		typeof value.retryLabel === 'string' &&
		value.retryLabel.startsWith('Retry in ') &&
		'retryVisible' in value &&
		value.retryVisible === true &&
		'retryLive' in value &&
		value.retryLive === null &&
		'bodyContainsCredential' in value &&
		value.bodyContainsCredential === false &&
		'endpointText' in value &&
		typeof value.endpointText === 'string' &&
		value.endpointText.includes(expectedRpcOperatorFailure)
	)
}

/** Recaptures the error state from the top of the page and asserts the title, navigation, and every safety control are visible. */
async function assertErrorCaptureLayout(session: BrowserSession, origin: string, width: number, height: number, suffix: string) {
	await session.replacePage(`${origin}/?status=error-${suffix}-capture`, width, height)
	await Bun.sleep(750)
	await session.run(`window.scrollTo(0, 0)`)
	await session.settlePaint()
	const captureLayoutValue = await session.read(`(() => {
		const visibleInViewport = element => {
			if (!(element instanceof HTMLElement) || getComputedStyle(element).display === 'none') return false
			const rect = element.getBoundingClientRect()
			return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
		}
		const title = document.querySelector('h1')
		const navigation = document.querySelector('.section-nav')
		const safetyControls = [...document.querySelectorAll('.operator-safety > :not([hidden])')].filter(element => getComputedStyle(element).display !== 'none')
		return { navigationVisible: visibleInViewport(navigation), safetyVisible: safetyControls.length > 0 && safetyControls.every(visibleInViewport), titleVisible: visibleInViewport(title) }
	})()`)
	if (
		typeof captureLayoutValue !== 'object' ||
		captureLayoutValue === null ||
		!('navigationVisible' in captureLayoutValue) ||
		captureLayoutValue.navigationVisible !== true ||
		!('safetyVisible' in captureLayoutValue) ||
		captureLayoutValue.safetyVisible !== true ||
		!('titleVisible' in captureLayoutValue) ||
		captureLayoutValue.titleVisible !== true
	) {
		throw new Error(`Error-state capture did not preserve its complete safety header at ${width.toString()}px`)
	}
}

/** Captures each run status; returns the mobile pause-control position later states must keep. */
async function captureRunStatuses(session: BrowserSession, origin: string) {
	let mobileSafetyActionPositions: unknown
	for (const status of ['running', 'paused', 'syncing', 'error'] as const) {
		fixture.status = status
		fixture.paused = status === 'paused'
		fixture.attention = status === 'error' ? 'error' : 'none'
		for (const { mobile, width, height, suffix } of VIEWPORTS) {
			await session.replacePage(`${origin}/?status=${status}-${suffix}`, width, height)
			await Bun.sleep(750)
			if (status === 'error') {
				await session.run(`document.querySelector('#attention-badge')?.click()`)
				await Bun.sleep(250)
			}
			await session.settlePaint()
			if (mobile) {
				const actionPositions = await readSafetyActionPositions(session)
				if (status === 'running') mobileSafetyActionPositions = actionPositions
				else assertStableSafetyActions(mobileSafetyActionPositions, actionPositions, `${status} status`)
			}
			const value = await readStatusState(session)
			if (typeof value !== 'object' || value === null || !('status' in value) || value.status !== status) throw new Error(`Run badge did not render ${status}`)
			if (!('disputePathsEmptyText' in value) || value.disputePathsEmptyText !== EMPTY_DISPUTE_PATHS) throw new Error('Empty dispute paths did not explain both discovery modes')
			if (status === 'error' && !errorStateExposesRecovery(value)) throw new Error(`Error state did not expose its attention and recovery context: ${JSON.stringify(value)}`)
			if (status !== 'error' && (!('retryVisible' in value) || value.retryVisible !== false)) throw new Error(`${status} state displayed a retry badge without an active retry`)
			if (mobile && 'bodyScrollWidth' in value && typeof value.bodyScrollWidth === 'number' && value.bodyScrollWidth > width) throw new Error(`${status} header overflows its ${width.toString()}px viewport`)
			if (status === 'error') await assertErrorCaptureLayout(session, origin, width, height, suffix)
			await session.capturePng(`status-${status}-${suffix}.png`)
		}
	}
	return mobileSafetyActionPositions
}

/** An operator warning without poll-failure metadata must not show retry state. */
async function captureOperatorAttention(session: BrowserSession, origin: string) {
	fixture.pollFailureMetadata = false
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.replacePage(`${origin}/?status=operator-attention-${suffix}`, width, height)
		await Bun.sleep(750)
		const attentionValue = await session.read(`({ copy: document.querySelector('#notice-copy')?.textContent, retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0, title: document.querySelector('#notice-title')?.textContent })`)
		if (
			typeof attentionValue !== 'object' ||
			attentionValue === null ||
			!('copy' in attentionValue) ||
			attentionValue.copy !== expectedNonPollFailure ||
			!('retryVisible' in attentionValue) ||
			attentionValue.retryVisible !== false ||
			!('title' in attentionValue) ||
			attentionValue.title !== 'Operator attention required'
		) {
			throw new Error(`Recovered poll metadata leaked into an operator warning at ${width.toString()}px`)
		}
		await session.capturePng(`status-operator-attention-${suffix}.png`)
	}
	fixture.pollFailureMetadata = true
}

/** A retry in progress, and a scheduled retry reaching its deadline, each show their own badge and notice. */
async function captureRetryStates(session: BrowserSession, origin: string) {
	fixture.retryInProgress = true
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.replacePage(`${origin}/?status=retrying-${suffix}`, width, height)
		await Bun.sleep(750)
		const value = await session.read(
			`({ badge: document.querySelector('#retry-status-badge')?.textContent, live: document.querySelector('#retry-status-badge')?.getAttribute('aria-live'), notice: document.querySelector('#notice-title')?.textContent, noticeCopy: document.querySelector('#notice-copy')?.textContent, scrollWidth: document.body.scrollWidth })`,
		)
		if (
			typeof value !== 'object' ||
			value === null ||
			!('badge' in value) ||
			value.badge !== 'Retrying now' ||
			!('live' in value) ||
			value.live !== null ||
			!('notice' in value) ||
			value.notice !== 'Automatic retry in progress' ||
			!('noticeCopy' in value) ||
			typeof value.noticeCopy !== 'string' ||
			!value.noticeCopy.includes('Poll failed at ') ||
			!value.noticeCopy.includes('Automatic retry started at ') ||
			!('scrollWidth' in value) ||
			value.scrollWidth !== width
		) {
			throw new Error(`Retry-in-progress state was not visible at ${width.toString()}px`)
		}
		await session.capturePng(`status-retrying-${suffix}.png`)
	}
	fixture.retryInProgress = false
	for (const { width, height, suffix } of VIEWPORTS) {
		fixture.nextRetryAt = new Date(Date.now() + 700).toISOString()
		await session.replacePage(`${origin}/?status=retry-boundary-${suffix}&allowIntervals=1`, width, height)
		await Bun.sleep(400)
		const scheduledValue = await session.read(`document.querySelector('#retry-status-badge')?.textContent`)
		if (typeof scheduledValue !== 'string' || !scheduledValue.startsWith('Retry in ')) throw new Error(`Retry boundary did not begin in its scheduled state at ${width.toString()}px`)
		await Bun.sleep(1_800)
		const boundaryValue = await session.read(`({ badge: document.querySelector('#retry-status-badge')?.textContent, notice: document.querySelector('#notice-copy')?.textContent })`)
		if (
			typeof boundaryValue !== 'object' ||
			boundaryValue === null ||
			!('badge' in boundaryValue) ||
			boundaryValue.badge !== 'Retry due' ||
			!('notice' in boundaryValue) ||
			typeof boundaryValue.notice !== 'string' ||
			!boundaryValue.notice.includes('Automatic retry became due at ') ||
			boundaryValue.notice.includes('Automatic retry started at ')
		) {
			throw new Error(`Retry boundary did not advance without claiming an unconfirmed attempt at ${width.toString()}px: ${JSON.stringify(boundaryValue)}`)
		}
		await session.capturePng(`status-retry-due-${suffix}.png`)
	}
	fixture.nextRetryAt = undefined
}

/** A disconnect hides both a scheduled and an in-progress retry. */
async function assertDisconnectClearsRetry(session: BrowserSession, origin: string) {
	for (const retrying of [false, true]) {
		fixture.retryInProgress = retrying
		for (const { width, height, suffix } of VIEWPORTS) {
			await session.replacePage(`${origin}/?status=${retrying ? 'retrying' : 'scheduled'}-disconnect-${suffix}`, width, height)
			await Bun.sleep(350)
			fixture.stateUnavailable = true
			await Bun.sleep(2_300)
			const disconnectedValue = await session.read(
				`({ retryActive: document.querySelector('#retry-status-badge')?.parentElement?.hasAttribute('data-retry-active'), retryVisible: document.querySelector('#retry-status-badge')?.getBoundingClientRect().height !== 0, runStatus: document.querySelector('#run-status-badge')?.textContent })`,
			)
			if (
				typeof disconnectedValue !== 'object' ||
				disconnectedValue === null ||
				!('retryActive' in disconnectedValue) ||
				disconnectedValue.retryActive !== false ||
				!('retryVisible' in disconnectedValue) ||
				disconnectedValue.retryVisible !== false ||
				!('runStatus' in disconnectedValue) ||
				disconnectedValue.runStatus !== 'Disconnected'
			) {
				throw new Error(`${retrying ? 'Active' : 'Scheduled'} retry remained visible after disconnect at ${width.toString()}px`)
			}
			fixture.stateUnavailable = false
		}
	}
}

/** Captures run statuses, operator warnings, and retry states; returns the mobile pause-control position the connection checks reuse. */
export async function captureStatusStates(session: BrowserSession, origin: string) {
	const mobileSafetyActionPositions = await captureRunStatuses(session, origin)
	await captureOperatorAttention(session, origin)
	await captureRetryStates(session, origin)
	await assertDisconnectClearsRetry(session, origin)
	session.runtimeDiagnostics.length = 0
	fixture.retryInProgress = false
	fixture.status = 'running'
	fixture.paused = false
	fixture.attention = 'none'
	return mobileSafetyActionPositions
}
