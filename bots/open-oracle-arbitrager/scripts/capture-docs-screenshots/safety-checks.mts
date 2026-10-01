import type { BrowserSession } from './browser-session.mts'

/** Asserts the resume dialog opened at its top with its title focused, its safety context visible, and its actions reachable. */
export async function assertResumeDialogStart(session: BrowserSession, label: string, width: number) {
	const value = await session.read(`(() => {
		const dialog = document.querySelector('#resume-dialog')
		const title = document.querySelector('#resume-title')
		const consequence = document.querySelector('#resume-dialog .dialog-body > .muted')
		const firstCheck = document.querySelector('#resume-preflight li')
		const actions = document.querySelector('#resume-dialog .dialog-actions')
		const dialogRect = dialog?.getBoundingClientRect()
		const titleRect = title?.getBoundingClientRect()
		const consequenceRect = consequence?.getBoundingClientRect()
		const firstCheckRect = firstCheck?.getBoundingClientRect()
		return {
			actionsReachable: dialog instanceof HTMLElement && actions instanceof HTMLElement && actions.offsetTop + actions.offsetHeight <= dialog.scrollHeight,
			bodyScrollWidth: document.body.scrollWidth,
			dialogBounded: dialogRect !== undefined && dialogRect.top >= 0 && dialogRect.bottom <= window.innerHeight && dialogRect.left >= 0 && dialogRect.right <= window.innerWidth,
			focusedTitle: document.activeElement === title,
			introVisible: [titleRect, consequenceRect, firstCheckRect].every(rect => rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight),
			open: dialog?.hasAttribute('open'),
			scrollTop: dialog instanceof HTMLElement ? dialog.scrollTop : undefined
		}
	})()`)
	if (
		typeof value !== 'object' ||
		value === null ||
		!('open' in value) ||
		value.open !== true ||
		!('focusedTitle' in value) ||
		value.focusedTitle !== true ||
		!('scrollTop' in value) ||
		value.scrollTop !== 0 ||
		!('dialogBounded' in value) ||
		value.dialogBounded !== true ||
		!('introVisible' in value) ||
		value.introVisible !== true ||
		!('actionsReachable' in value) ||
		value.actionsReachable !== true ||
		!('bodyScrollWidth' in value) ||
		typeof value.bodyScrollWidth !== 'number' ||
		value.bodyScrollWidth > width
	) {
		throw new Error(`${label} resume dialog lost its safety context: ${JSON.stringify(value)}`)
	}
}

/** Reads the bounding box of the header's pause control so later states can prove it did not move. */
export async function readSafetyActionPositions(session: BrowserSession) {
	return await session.read(`(() => Object.fromEntries(['pause-button'].map(id => {
		const element = document.getElementById(id)
		if (!(element instanceof HTMLElement)) return [id, undefined]
		const rect = element.getBoundingClientRect()
		return [id, { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width }]
	})))()`)
}

export function assertStableSafetyActions(expected: unknown, actual: unknown, label: string) {
	if (expected === undefined || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} moved mobile safety actions: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
}
