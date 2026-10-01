import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { fixture } from './fixture-state.mts'
import { assertResumeDialogStart } from './safety-checks.mts'

const CLICK_PAUSE = `document.querySelector('#pause-button')?.click()`

/** Without a configured network, neither Pause nor the resume confirmation may send a request. */
async function captureUnconfiguredResume(session: BrowserSession, origin: string) {
	fixture.networkConfigured = false
	fixture.paused = true
	const unconfiguredPauseRequestCount = fixture.pauseRequests.length
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.replacePage(`${origin}/?resume=network-unconfigured-${suffix}`, width, height)
		await Bun.sleep(750)
		const unconfiguredResumeValue = await session.read(`(() => {
			const pause = document.querySelector('#pause-button')
			const confirm = document.querySelector('#confirm-resume')
			pause?.click()
			confirm?.click()
			return {
				attentionHref: document.querySelector('#attention-badge')?.getAttribute('href'),
				attentionText: document.querySelector('#attention-badge')?.textContent,
				confirmDisabled: confirm?.disabled,
				pauseBusy: pause?.getAttribute('aria-busy'),
				pauseCursor: pause instanceof HTMLElement ? getComputedStyle(pause).cursor : undefined,
				pauseDisabled: pause?.disabled,
				resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open')
			}
		})()`)
		await Bun.sleep(100)
		if (
			typeof unconfiguredResumeValue !== 'object' ||
			unconfiguredResumeValue === null ||
			!('pauseDisabled' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.pauseDisabled !== true ||
			!('attentionHref' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.attentionHref !== '/settings#network-connectivity' ||
			!('attentionText' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.attentionText !== '1 action' ||
			!('pauseBusy' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.pauseBusy !== null ||
			!('pauseCursor' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.pauseCursor !== 'not-allowed' ||
			!('confirmDisabled' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.confirmDisabled !== true ||
			!('resumeOpen' in unconfiguredResumeValue) ||
			unconfiguredResumeValue.resumeOpen !== false ||
			fixture.pauseRequests.length !== unconfiguredPauseRequestCount
		) {
			throw new Error(`Unconfigured network exposed Resume: ${JSON.stringify({ requests: fixture.pauseRequests.length - unconfiguredPauseRequestCount, state: unconfiguredResumeValue })}`)
		}
		await session.capturePng(`resume-network-unconfigured-${suffix}.png`)
	}
	fixture.networkConfigured = true
}

/** A pause request in flight shows a busy, disabled Pause control. */
async function capturePendingPause(session: BrowserSession, origin: string) {
	fixture.paused = false
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.replacePage(`${origin}/?pause=pending-${suffix}`, width, height)
		await Bun.sleep(750)
		fixture.pauseHanging = true
		let pendingPauseValue: unknown
		try {
			await session.run(CLICK_PAUSE)
			await Bun.sleep(100)
			pendingPauseValue = await session.read(`(() => {
				const pause = document.querySelector('#pause-button')
				return {
					busy: pause?.getAttribute('aria-busy'),
					cursor: pause instanceof HTMLElement ? getComputedStyle(pause).cursor : undefined,
					disabled: pause?.disabled,
					text: pause?.textContent
				}
			})()`)
			await session.capturePng(`pause-pending-${suffix}.png`)
		} finally {
			fixture.pauseHanging = false
		}
		await Bun.sleep(350)
		if (
			typeof pendingPauseValue !== 'object' ||
			pendingPauseValue === null ||
			!('busy' in pendingPauseValue) ||
			pendingPauseValue.busy !== 'true' ||
			!('cursor' in pendingPauseValue) ||
			pendingPauseValue.cursor !== 'wait' ||
			!('disabled' in pendingPauseValue) ||
			pendingPauseValue.disabled !== true ||
			!('text' in pendingPauseValue) ||
			pendingPauseValue.text !== 'Pausing…'
		) {
			throw new Error(`Pending Pause did not expose a busy control: ${JSON.stringify(pendingPauseValue)}`)
		}
		fixture.paused = false
	}
}

/** A resume request in flight keeps the preflight open with a busy, disabled confirmation. */
async function capturePendingResume(session: BrowserSession, origin: string) {
	fixture.paused = true
	for (const { mobile, width, height, suffix } of VIEWPORTS) {
		const viewportLabel = mobile ? 'Mobile' : 'Desktop'
		await session.replacePage(`${origin}/?resume=pending-${suffix}`, width, height)
		await Bun.sleep(750)
		await session.run(CLICK_PAUSE)
		await Bun.sleep(100)
		await assertResumeDialogStart(session, `${viewportLabel} initial`, width)
		fixture.pauseHanging = true
		let pendingResumeValue: unknown
		try {
			await session.run(`document.querySelector('#confirm-resume')?.click()`)
			await Bun.sleep(100)
			await assertResumeDialogStart(session, `${viewportLabel} pending`, width)
			pendingResumeValue = await session.read(`(() => {
				const confirm = document.querySelector('#confirm-resume')
				return {
					busy: confirm?.getAttribute('aria-busy'),
					cursor: confirm instanceof HTMLElement ? getComputedStyle(confirm).cursor : undefined,
					disabled: confirm?.disabled,
					resumeOpen: document.querySelector('#resume-dialog')?.hasAttribute('open'),
					text: confirm?.textContent
				}
			})()`)
			await session.capturePng(`resume-pending-${suffix}.png`)
		} finally {
			fixture.pauseHanging = false
		}
		await Bun.sleep(350)
		if (
			typeof pendingResumeValue !== 'object' ||
			pendingResumeValue === null ||
			!('busy' in pendingResumeValue) ||
			pendingResumeValue.busy !== 'true' ||
			!('cursor' in pendingResumeValue) ||
			pendingResumeValue.cursor !== 'wait' ||
			!('disabled' in pendingResumeValue) ||
			pendingResumeValue.disabled !== true ||
			!('resumeOpen' in pendingResumeValue) ||
			pendingResumeValue.resumeOpen !== true ||
			!('text' in pendingResumeValue) ||
			pendingResumeValue.text !== 'Resuming…'
		) {
			throw new Error(`Pending Resume did not expose a busy control: ${JSON.stringify(pendingResumeValue)}`)
		}
		fixture.paused = true
	}
	fixture.paused = false
}

/** Captures the pause and resume controls, including the resume preflight (`OPEN_ORACLE_CAPTURE_RESUME=1`). */
export async function captureResumeStates(session: BrowserSession, origin: string) {
	await captureUnconfiguredResume(session, origin)
	await capturePendingPause(session, origin)
	await capturePendingResume(session, origin)
	await session.replacePage(`${origin}/`, 1440, 900)
	await Bun.sleep(750)
	await session.run(CLICK_PAUSE)
	await Bun.sleep(2_250)
	await session.run(CLICK_PAUSE)
	await Bun.sleep(250)
	await session.settlePaint()
	await session.capturePng('resume-preflight.png')
}
