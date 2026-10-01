import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { protectedFailureMarker } from './fixture-constants.mts'
import { fixture } from './fixture-state.mts'

/** Page-side statements that scroll the connectivity group, already bound to `group`, below the sticky header. */
const SCROLL_TO_CONNECTIVITY = `if (group instanceof HTMLElement) {
		const offset = (document.querySelector('.operator-shell')?.getBoundingClientRect().height ?? 0) + 16
		window.scrollTo(0, Math.max(0, group.getBoundingClientRect().top + window.scrollY - offset))
	}`

/** A rejected connectivity save must show only the public failure, keep the form editable, and recover on retry. */
async function captureConnectivityFailure(session: BrowserSession, origin: string) {
	await session.replacePage(`${origin}/settings?mutation=connectivity-error`, 390, 844)
	await Bun.sleep(750)
	fixture.connectivityFailure = true
	await session.run(`(() => {
		const group = document.querySelector('#network-connectivity')
		if (group instanceof HTMLDetailsElement) group.open = true
		document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
	})()`)
	await Bun.sleep(350)
	const value = await session.read(`(() => {
		const group = document.querySelector('#network-connectivity')
		${SCROLL_TO_CONNECTIVITY}
		return {
			bodyContainsCredential: document.body.textContent?.includes(${JSON.stringify(protectedFailureMarker)}) === true,
			fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
			status: document.querySelector('#connectivity-status')?.textContent
		}
	})()`)
	if (
		typeof value !== 'object' ||
		value === null ||
		!('bodyContainsCredential' in value) ||
		value.bodyContainsCredential !== false ||
		!('fieldsetDisabled' in value) ||
		value.fieldsetDisabled !== false ||
		!('status' in value) ||
		value.status !== 'RPC connectivity checks failed. Review the submitted endpoints and retry.'
	) {
		throw new Error(`Connectivity mutation exposed unsafe failure text: ${JSON.stringify(value)}`)
	}
	await session.capturePng('connectivity-error-mobile.png')
	session.expectOnlyFailedRequestDiagnostics('400 (Bad Request)', '/api/connectivity', 'connectivity-mutation')
	fixture.connectivityFailure = false
	await session.run(`document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`)
	await Bun.sleep(350)
	const recoveryValue = await session.read(`(() => ({
		fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
		status: document.querySelector('#connectivity-status')?.textContent
	}))()`)
	if (typeof recoveryValue !== 'object' || recoveryValue === null || !('fieldsetDisabled' in recoveryValue) || recoveryValue.fieldsetDisabled !== false || !('status' in recoveryValue) || recoveryValue.status !== 'Chain and RPCs passed validation, were saved, and apply to the next scan.') {
		throw new Error(`Connectivity mutation did not recover after retry: ${JSON.stringify(recoveryValue)}`)
	}
}

/** While a profile switch is pending, every field keeps the old chain's values and stays locked. */
async function capturePendingProfileSwitch(session: BrowserSession) {
	fixture.profileHanging = true
	await session.run(`(() => {
		const network = document.querySelector('#network-name')
		if (!(network instanceof HTMLSelectElement)) throw new Error('Network profile control missing')
		network.value = 'sepolia'
		network.dispatchEvent(new Event('change', { bubbles: true }))
	})()`)
	await Bun.sleep(100)
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.setViewport(width, height)
		const pendingValue = await session.read(`(() => {
			const group = document.querySelector('#network-connectivity')
			if (group instanceof HTMLDetailsElement) group.open = true
			${SCROLL_TO_CONNECTIVITY}
			return {
				activeProfile: document.querySelector('#network-name')?.value,
				bodyScrollWidth: document.body.scrollWidth,
				disabledInputOpacity: getComputedStyle(document.querySelector('#read-rpc-url')).opacity,
				disabledTextareaBorderStyle: getComputedStyle(document.querySelector('#public-rpc-urls')).borderStyle,
				fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
				readRpcUrl: document.querySelector('#read-rpc-url')?.value,
				retryActionsHidden: document.querySelector('#profile-switch-retry-actions')?.hidden,
				rpcQuorum: document.querySelector('#rpc-quorum')?.value,
				scope: document.querySelector('#settings-chain-scope')?.textContent,
				targetStatus: document.querySelector('#network-target-status')?.textContent,
				targetStatusHidden: document.querySelector('#network-target-status')?.hidden,
				status: document.querySelector('#connectivity-status')?.textContent
			}
		})()`)
		if (
			typeof pendingValue !== 'object' ||
			pendingValue === null ||
			!('activeProfile' in pendingValue) ||
			pendingValue.activeProfile !== 'mainnet' ||
			!('disabledInputOpacity' in pendingValue) ||
			pendingValue.disabledInputOpacity !== '0.65' ||
			!('disabledTextareaBorderStyle' in pendingValue) ||
			pendingValue.disabledTextareaBorderStyle !== 'dashed' ||
			!('fieldsetDisabled' in pendingValue) ||
			pendingValue.fieldsetDisabled !== true ||
			!('readRpcUrl' in pendingValue) ||
			pendingValue.readRpcUrl !== 'https://read.example/' ||
			!('retryActionsHidden' in pendingValue) ||
			pendingValue.retryActionsHidden !== true ||
			!('rpcQuorum' in pendingValue) ||
			pendingValue.rpcQuorum !== '2' ||
			!('scope' in pendingValue) ||
			!String(pendingValue.scope).includes('Ethereum mainnet') ||
			!('targetStatus' in pendingValue) ||
			pendingValue.targetStatus !== 'Switching from mainnet to sepolia. Existing chain settings remain visible until the new profile loads.' ||
			!('targetStatusHidden' in pendingValue) ||
			pendingValue.targetStatusHidden !== false ||
			!('status' in pendingValue) ||
			pendingValue.status !== '' ||
			!('bodyScrollWidth' in pendingValue) ||
			typeof pendingValue.bodyScrollWidth !== 'number' ||
			pendingValue.bodyScrollWidth > width
		) {
			throw new Error(`Pending arbitrager profile switch mixed chain contexts: ${JSON.stringify(pendingValue)}`)
		}
		await session.settlePaint()
		await session.capturePng(`profile-switching-${suffix}.png`)
	}
	fixture.profileHanging = false
}

/** A switch that never reconnects exposes a visible retry; the retry then loads the new profile and unlocks the form. */
async function captureProfileSwitchTimeout(session: BrowserSession) {
	await Bun.sleep(20_500)
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.setViewport(width, height)
		const timeoutValue = await session.read(`(() => {
			const retry = document.querySelector('#profile-switch-retry-button')
			retry?.scrollIntoView({ block: 'center' })
			return {
				bodyScrollWidth: document.body.scrollWidth,
				fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
				retryDisabled: retry?.disabled,
				retryHidden: retry?.hidden,
				retryVisible: retry instanceof HTMLElement && retry.getBoundingClientRect().top >= 0 && retry.getBoundingClientRect().bottom <= window.innerHeight,
				status: document.querySelector('#connectivity-status')?.textContent,
				targetStatusHidden: document.querySelector('#network-target-status')?.hidden
			}
		})()`)
		if (
			typeof timeoutValue !== 'object' ||
			timeoutValue === null ||
			!('bodyScrollWidth' in timeoutValue) ||
			typeof timeoutValue.bodyScrollWidth !== 'number' ||
			timeoutValue.bodyScrollWidth > width ||
			!('fieldsetDisabled' in timeoutValue) ||
			timeoutValue.fieldsetDisabled !== true ||
			!('retryDisabled' in timeoutValue) ||
			timeoutValue.retryDisabled !== false ||
			!('retryHidden' in timeoutValue) ||
			timeoutValue.retryHidden !== false ||
			!('retryVisible' in timeoutValue) ||
			timeoutValue.retryVisible !== true ||
			!('status' in timeoutValue) ||
			timeoutValue.status !== 'The profile was saved, but the dashboard did not reconnect in time. Retry the profile load when the dashboard is available.' ||
			!('targetStatusHidden' in timeoutValue) ||
			timeoutValue.targetStatusHidden !== false
		) {
			throw new Error(`Timed-out profile switch did not expose a safe retry at ${width.toString()}px: ${JSON.stringify(timeoutValue)}`)
		}
		await session.capturePng(`profile-switch-timeout-${suffix}.png`)
	}
	fixture.network = 'sepolia'
	await session.run(`(() => {
		document.querySelector('#profile-switch-retry-button')?.click()
	})()`)
	await Bun.sleep(500)
	for (const { width, height, suffix } of VIEWPORTS) {
		await session.setViewport(width, height)
		const recoveredValue = await session.read(`(() => ({
			activeProfile: document.querySelector('#network-name')?.value,
			bodyScrollWidth: document.body.scrollWidth,
			fieldsetDisabled: document.querySelector('#connectivity-fieldset')?.disabled,
			retryActionsHidden: document.querySelector('#profile-switch-retry-actions')?.hidden,
			targetStatusHidden: document.querySelector('#network-target-status')?.hidden
		}))()`)
		if (
			typeof recoveredValue !== 'object' ||
			recoveredValue === null ||
			!('activeProfile' in recoveredValue) ||
			recoveredValue.activeProfile !== 'sepolia' ||
			!('bodyScrollWidth' in recoveredValue) ||
			typeof recoveredValue.bodyScrollWidth !== 'number' ||
			recoveredValue.bodyScrollWidth > width ||
			!('fieldsetDisabled' in recoveredValue) ||
			recoveredValue.fieldsetDisabled !== false ||
			!('retryActionsHidden' in recoveredValue) ||
			recoveredValue.retryActionsHidden !== true ||
			!('targetStatusHidden' in recoveredValue) ||
			recoveredValue.targetStatusHidden !== true
		) {
			throw new Error(`Timed-out profile switch did not recover at ${width.toString()}px: ${JSON.stringify(recoveredValue)}`)
		}
		await session.capturePng(`profile-switch-recovered-${suffix}.png`)
	}
	fixture.network = 'mainnet'
}

/** Captures the connectivity failure and chain-profile switch states (`OPEN_ORACLE_CAPTURE_SETTINGS=1`). */
export async function captureSettingsStates(session: BrowserSession, origin: string) {
	await captureConnectivityFailure(session, origin)
	await capturePendingProfileSwitch(session)
	await captureProfileSwitchTimeout(session)
}
