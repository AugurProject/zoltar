import { type BrowserSession, VIEWPORTS } from './browser-session.mts'
import { fixture } from './fixture-state.mts'

const DEPENDENT_FIELDSETS = "['strategy-fieldset', 'submission-fieldset', 'connectivity-fieldset', 'deployment-fieldset', 'create2-fieldset', 'tokens-fieldset']"

async function readConfigurationState(session: BrowserSession) {
	return await session.read(`(() => ({
		bodyScrollWidth: document.body.scrollWidth,
		clientWidth: document.documentElement.clientWidth,
		containerHidden: document.querySelector('#settings-load-state')?.hidden,
		allDependentDisabled: ${DEPENDENT_FIELDSETS}.every(id => document.getElementById(id)?.hasAttribute('disabled') === true),
		allDependentEnabled: ${DEPENDENT_FIELDSETS}.every(id => document.getElementById(id)?.hasAttribute('disabled') === false),
		deploymentDisabled: document.querySelector('#deployment-fieldset')?.disabled,
		retryHidden: document.querySelector('#retry-settings-button')?.hidden,
		status: document.querySelector('#settings-load-status')?.textContent,
		strategyDisabled: document.querySelector('#strategy-fieldset')?.disabled,
		submissionDisabled: document.querySelector('#submission-fieldset')?.disabled
	}))()`)
}

function assertConfigurationControls(value: unknown, disabled: boolean, label: string, width: number) {
	if (
		typeof value !== 'object' ||
		value === null ||
		!('strategyDisabled' in value) ||
		value.strategyDisabled !== disabled ||
		!('allDependentDisabled' in value) ||
		!('allDependentEnabled' in value) ||
		(disabled ? value.allDependentDisabled !== true : value.allDependentEnabled !== true) ||
		!('submissionDisabled' in value) ||
		value.submissionDisabled !== disabled ||
		!('deploymentDisabled' in value) ||
		value.deploymentDisabled !== disabled ||
		!('bodyScrollWidth' in value) ||
		typeof value.bodyScrollWidth !== 'number' ||
		value.bodyScrollWidth > width
	) {
		throw new Error(`${label} configuration controls are unsafe: ${JSON.stringify(value)}`)
	}
}

/** Asserts the load-state banner hides once configuration has loaded. */
function assertLoadStateHidden(value: unknown, message: string) {
	if (typeof value !== 'object' || value === null || !('containerHidden' in value) || value.containerHidden !== true) throw new Error(`${message}: ${JSON.stringify(value)}`)
}

/** Asserts the load-state banner shows a retry with the unavailable-configuration status. */
function assertUnavailableWithRetry(value: unknown, message: string) {
	if (typeof value !== 'object' || value === null || !('containerHidden' in value) || value.containerHidden !== false || !('retryHidden' in value) || value.retryHidden !== false || !('status' in value) || typeof value.status !== 'string' || !value.status.includes('Complete configuration is unavailable.')) {
		throw new Error(`${message}: ${JSON.stringify(value)}`)
	}
}

async function retrySettings(session: BrowserSession) {
	await session.run(`document.querySelector('#retry-settings-button')?.click()`)
	await Bun.sleep(350)
	return await readConfigurationState(session)
}

/** Captures loading, failed, and timed-out configuration loads and proves every Settings form stays locked until a retry succeeds (`OPEN_ORACLE_CAPTURE_CONFIGURATION_STATES=1`). */
export async function captureConfigurationStates(session: BrowserSession, origin: string) {
	for (const { width, height, suffix } of VIEWPORTS) {
		fixture.configurationHanging = true
		await session.replacePage(`${origin}/settings?configuration=loading-${suffix}`, width, height)
		await Bun.sleep(150)
		const loading = await readConfigurationState(session)
		assertConfigurationControls(loading, true, 'Loading', width)
		if (typeof loading !== 'object' || loading === null || !('containerHidden' in loading) || loading.containerHidden !== false || !('retryHidden' in loading) || loading.retryHidden !== true || !('status' in loading) || loading.status !== 'Loading operator configuration…') {
			throw new Error(`Configuration loading state is not visible: ${JSON.stringify(loading)}`)
		}
		await session.capturePng(`configuration-loading-${suffix}.png`)
		fixture.configurationHanging = false
		await Bun.sleep(350)
		const loaded = await readConfigurationState(session)
		assertConfigurationControls(loaded, false, 'Loaded', width)
		assertLoadStateHidden(loaded, 'Configuration loading did not resolve')

		fixture.configurationUnavailable = true
		fixture.connectivityHanging = true
		await session.run(`document.querySelector('#connectivity-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`)
		await Bun.sleep(50)
		await session.run(`document.querySelector('#reload-configuration-button')?.click()`)
		await Bun.sleep(350)
		const reloadFailed = await readConfigurationState(session)
		assertConfigurationControls(reloadFailed, true, 'Failed reload', width)
		assertUnavailableWithRetry(reloadFailed, 'Failed configuration reload left stale controls available')
		fixture.connectivityHanging = false
		await Bun.sleep(350)
		const connectivityCompletedAfterReloadFailure = await readConfigurationState(session)
		assertConfigurationControls(connectivityCompletedAfterReloadFailure, true, 'Connectivity completed after failed reload', width)
		fixture.configurationUnavailable = false
		const reloadRecovered = await retrySettings(session)
		assertConfigurationControls(reloadRecovered, false, 'Reload-recovered', width)
		assertLoadStateHidden(reloadRecovered, 'Failed configuration reload did not recover')

		fixture.configurationUnavailable = true
		await session.replacePage(`${origin}/settings?configuration=failed-${suffix}`, width, height)
		await Bun.sleep(750)
		const failed = await readConfigurationState(session)
		assertConfigurationControls(failed, true, 'Failed', width)
		assertUnavailableWithRetry(failed, 'Configuration failure has no visible recovery')
		await session.capturePng(`configuration-failed-${suffix}.png`)
		fixture.configurationUnavailable = false
		const recovered = await retrySettings(session)
		assertConfigurationControls(recovered, false, 'Recovered', width)
		assertLoadStateHidden(recovered, 'Configuration retry did not recover')

		fixture.configurationHanging = true
		await session.replacePage(`${origin}/settings?configuration=hanging-${suffix}`, width, height)
		await Bun.sleep(2_250)
		const timedOut = await readConfigurationState(session)
		assertConfigurationControls(timedOut, true, 'Timed-out', width)
		if (typeof timedOut !== 'object' || timedOut === null || !('containerHidden' in timedOut) || timedOut.containerHidden !== false || !('retryHidden' in timedOut) || timedOut.retryHidden !== false || !('status' in timedOut) || timedOut.status !== 'Configuration request timed out. Editable settings remain locked.') {
			throw new Error(`Hanging configuration request did not time out visibly: ${JSON.stringify(timedOut)}`)
		}
		await session.capturePng(`configuration-timeout-${suffix}.png`)
		fixture.configurationHanging = false
		const timeoutRecovery = await retrySettings(session)
		assertConfigurationControls(timeoutRecovery, false, 'Timeout-recovered', width)
		assertLoadStateHidden(timeoutRecovery, 'Timed-out configuration retry did not recover')
	}
	session.expectOnlyFailedRequestDiagnostics('503 (Service Unavailable)', '/api/configuration', 'configuration')
}
