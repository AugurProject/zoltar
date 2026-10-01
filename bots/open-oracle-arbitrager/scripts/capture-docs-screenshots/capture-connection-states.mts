import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { expectedStateUnavailableFailure } from './fixture-constants.mts'
import { fixture } from './fixture-state.mts'
import { assertStableSafetyActions, readSafetyActionPositions } from './safety-checks.mts'

async function readConnectionState(session: BrowserSession) {
	return await session.read(`(() => {
		const safetyVisible = ['mode-badge', 'run-status-badge', 'header-network-badge', 'attention-badge', 'pause-button'].every(id => {
			const target = document.getElementById(id)
			if (!(target instanceof HTMLElement)) return false
			const rect = target.getBoundingClientRect()
			return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight
		})
		return {
			attentionHref: document.querySelector('#attention-badge')?.getAttribute('href'),
			attentionText: document.querySelector('#attention-badge')?.textContent,
			bodyScrollWidth: document.body.scrollWidth,
			mode: document.querySelector('#mode-badge')?.textContent,
			network: document.querySelector('#header-network-badge')?.textContent,
			noticeCopy: document.querySelector('#notice-copy')?.textContent,
			noticeTitle: document.querySelector('#notice-title')?.textContent,
			confirmDisabled: document.querySelector('#confirm-resume')?.disabled,
			pauseDisabled: document.querySelector('#pause-button')?.disabled,
			resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open'),
			runStatus: document.querySelector('#run-status-badge')?.textContent,
			safetyVisible,
			scrollX: window.scrollX
		}
	})()`)
}

/** Before any snapshot arrives, a failed state request shows the disconnected shell with Pause disabled. */
async function captureInitialFailure(session: BrowserSession, origin: string, viewport: (typeof VIEWPORTS)[number], mobileSafetyActionPositions: unknown) {
	const { mobile, width, height, suffix } = viewport
	fixture.stateUnavailable = true
	await session.replacePage(`${origin}/?connection=initial-${suffix}`, width, height)
	await Bun.sleep(750)
	const initialFailure = await readConnectionState(session)
	if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(session), 'Initial connection failure')
	if (
		typeof initialFailure !== 'object' ||
		initialFailure === null ||
		!('attentionHref' in initialFailure) ||
		initialFailure.attentionHref !== '/overview#notice' ||
		!('attentionText' in initialFailure) ||
		initialFailure.attentionText !== '1 action' ||
		!('mode' in initialFailure) ||
		initialFailure.mode !== 'Mode unavailable' ||
		!('network' in initialFailure) ||
		initialFailure.network !== 'Network unavailable' ||
		!('noticeCopy' in initialFailure) ||
		initialFailure.noticeCopy !== expectedStateUnavailableFailure ||
		!('noticeTitle' in initialFailure) ||
		initialFailure.noticeTitle !== 'Dashboard disconnected' ||
		!('pauseDisabled' in initialFailure) ||
		initialFailure.pauseDisabled !== true ||
		!('runStatus' in initialFailure) ||
		initialFailure.runStatus !== 'Disconnected' ||
		!('safetyVisible' in initialFailure) ||
		initialFailure.safetyVisible !== true ||
		!('bodyScrollWidth' in initialFailure) ||
		typeof initialFailure.bodyScrollWidth !== 'number' ||
		initialFailure.bodyScrollWidth > width ||
		!('scrollX' in initialFailure) ||
		initialFailure.scrollX !== 0
	) {
		throw new Error(`Initial state-request failure is unsafe: ${JSON.stringify(initialFailure)}`)
	}
	await session.capturePng(`connection-initial-failure-${suffix}.png`)
	fixture.stateUnavailable = false
}

/** After a successful poll, a failed one keeps the last known network and still lets the operator pause; the next success restores the shell. */
async function capturePostSuccessFailure(session: BrowserSession, origin: string, viewport: (typeof VIEWPORTS)[number], mobileSafetyActionPositions: unknown) {
	const { mobile, width, height, suffix } = viewport
	await session.replacePage(`${origin}/?connection=post-success-${suffix}`, width, height)
	await Bun.sleep(750)
	fixture.stateUnavailable = true
	await Bun.sleep(2_300)
	const postSuccessFailure = await readConnectionState(session)
	if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(session), 'Post-success connection failure')
	if (
		typeof postSuccessFailure !== 'object' ||
		postSuccessFailure === null ||
		!('attentionText' in postSuccessFailure) ||
		postSuccessFailure.attentionText !== '1 action' ||
		!('network' in postSuccessFailure) ||
		postSuccessFailure.network !== 'mainnet · 1 · last known' ||
		!('noticeCopy' in postSuccessFailure) ||
		postSuccessFailure.noticeCopy !== expectedStateUnavailableFailure ||
		!('noticeTitle' in postSuccessFailure) ||
		postSuccessFailure.noticeTitle !== 'Dashboard disconnected' ||
		!('pauseDisabled' in postSuccessFailure) ||
		postSuccessFailure.pauseDisabled !== false ||
		!('runStatus' in postSuccessFailure) ||
		postSuccessFailure.runStatus !== 'Disconnected' ||
		!('safetyVisible' in postSuccessFailure) ||
		postSuccessFailure.safetyVisible !== true ||
		!('bodyScrollWidth' in postSuccessFailure) ||
		typeof postSuccessFailure.bodyScrollWidth !== 'number' ||
		postSuccessFailure.bodyScrollWidth > width ||
		!('scrollX' in postSuccessFailure) ||
		postSuccessFailure.scrollX !== 0
	) {
		throw new Error(`Post-success state-request failure is unsafe: ${JSON.stringify(postSuccessFailure)}`)
	}
	await session.capturePng(`connection-post-success-failure-${suffix}.png`)
	const pauseRequestCount = fixture.pauseRequests.length
	await session.run(`document.querySelector('#pause-button')?.click()`)
	await Bun.sleep(250)
	if (fixture.pauseRequests.length !== pauseRequestCount + 1 || fixture.pauseRequests.at(-1) !== true) throw new Error('Emergency Pause did not reach the bot while state polling was unavailable')
	fixture.paused = false
	fixture.stateUnavailable = false
	await Bun.sleep(2_300)
	const recovery = await readConnectionState(session)
	if (
		typeof recovery !== 'object' ||
		recovery === null ||
		!('attentionText' in recovery) ||
		recovery.attentionText !== '' ||
		!('network' in recovery) ||
		recovery.network !== 'mainnet · 1' ||
		!('pauseDisabled' in recovery) ||
		recovery.pauseDisabled !== false ||
		!('runStatus' in recovery) ||
		recovery.runStatus !== 'Running'
	) {
		throw new Error(`State-request recovery did not restore the safety shell: ${JSON.stringify(recovery)}`)
	}
}

/** A state request that never answers fails closed at its deadline. */
async function assertHungRequestFailsClosed(session: BrowserSession, origin: string, viewport: (typeof VIEWPORTS)[number], mobileSafetyActionPositions: unknown) {
	const { mobile, width, height, suffix } = viewport
	await session.replacePage(`${origin}/?connection=hung-${suffix}`, width, height)
	await Bun.sleep(750)
	fixture.stateHanging = true
	await Bun.sleep(2_300)
	if (mobile) assertStableSafetyActions(mobileSafetyActionPositions, await readSafetyActionPositions(session), 'Pending automatic refresh')
	await Bun.sleep(1_150)
	const hungRequest = await readConnectionState(session)
	if (
		typeof hungRequest !== 'object' ||
		hungRequest === null ||
		!('attentionText' in hungRequest) ||
		hungRequest.attentionText !== '1 action' ||
		!('confirmDisabled' in hungRequest) ||
		hungRequest.confirmDisabled !== true ||
		!('pauseDisabled' in hungRequest) ||
		hungRequest.pauseDisabled !== false ||
		!('resumeOpen' in hungRequest) ||
		hungRequest.resumeOpen !== false ||
		!('runStatus' in hungRequest) ||
		hungRequest.runStatus !== 'Disconnected'
	) {
		throw new Error(`Hung state request did not fail closed after its deadline: ${JSON.stringify(hungRequest)}`)
	}
	fixture.stateHanging = false
	await session.replacePage(`${origin}/?connection=hung-recovery-${suffix}`, width, height)
	await Bun.sleep(750)
}

/** An open resume preflight closes and locks its confirmation while state is unavailable, then recovers with current state. */
async function assertPreflightFollowsConnection(session: BrowserSession, origin: string, viewport: (typeof VIEWPORTS)[number]) {
	const { width, height, suffix } = viewport
	fixture.paused = true
	await session.replacePage(`${origin}/?connection=resume-preflight-${suffix}`, width, height)
	await Bun.sleep(750)
	await session.run(`document.querySelector('#pause-button')?.click()`)
	await Bun.sleep(100)
	const openPreflight = await readConnectionState(session)
	if (typeof openPreflight !== 'object' || openPreflight === null || !('resumeOpen' in openPreflight) || openPreflight.resumeOpen !== true || !('confirmDisabled' in openPreflight) || openPreflight.confirmDisabled !== false) {
		throw new Error(`Resume preflight did not open from current state: ${JSON.stringify(openPreflight)}`)
	}
	fixture.stateUnavailable = true
	await Bun.sleep(2_300)
	const stalePreflight = await readConnectionState(session)
	if (typeof stalePreflight !== 'object' || stalePreflight === null || !('resumeOpen' in stalePreflight) || stalePreflight.resumeOpen !== false || !('confirmDisabled' in stalePreflight) || stalePreflight.confirmDisabled !== true) {
		throw new Error(`Disconnected resume preflight remained actionable: ${JSON.stringify(stalePreflight)}`)
	}
	fixture.stateUnavailable = false
	await Bun.sleep(2_300)
	const preflightRecovery = await readConnectionState(session)
	if (typeof preflightRecovery !== 'object' || preflightRecovery === null || !('confirmDisabled' in preflightRecovery) || preflightRecovery.confirmDisabled !== false) {
		throw new Error(`Resume confirmation did not recover after current state returned: ${JSON.stringify(preflightRecovery)}`)
	}
	fixture.paused = false
}

/** Captures state-request failures before and after a successful poll and checks the safety shell fails closed and recovers. */
export async function captureConnectionStates(session: BrowserSession, origin: string, mobileSafetyActionPositions: unknown) {
	for (const viewport of VIEWPORTS) {
		await captureInitialFailure(session, origin, viewport, mobileSafetyActionPositions)
		await capturePostSuccessFailure(session, origin, viewport, mobileSafetyActionPositions)
		await assertHungRequestFailsClosed(session, origin, viewport, mobileSafetyActionPositions)
		await assertPreflightFollowsConnection(session, origin, viewport)
	}
	session.expectOnlyFailedRequestDiagnostics('503 (Service Unavailable)', '/api/state', 'connection-failure')
}
