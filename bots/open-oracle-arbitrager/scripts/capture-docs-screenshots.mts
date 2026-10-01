/**
 * Serves the real dashboard against a fixture operator and captures the documentation screenshots into `docs/assets` (or
 * `OPEN_ORACLE_SCREENSHOT_OUTPUT_DIR`). Each `OPEN_ORACLE_CAPTURE_*=1` variable adds a group of QA states, and `--serve` only
 * keeps the fixture dashboard running for manual inspection.
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createBrowserSession, launchCaptureBrowser } from './capture-docs-screenshots/browser-session.mts'
import { captureAttentionNavigation } from './capture-docs-screenshots/capture-attention-navigation.mts'
import { captureConfigurationStates } from './capture-docs-screenshots/capture-configuration-states.mts'
import { captureConnectionStates } from './capture-docs-screenshots/capture-connection-states.mts'
import { captureResumeStates } from './capture-docs-screenshots/capture-resume-states.mts'
import { captureSections } from './capture-docs-screenshots/capture-sections.mts'
import { captureSettingsStates } from './capture-docs-screenshots/capture-settings-states.mts'
import { captureStatusStates } from './capture-docs-screenshots/capture-status-states.mts'
import { startFixtureServer } from './capture-docs-screenshots/fixture-server.mts'

const captureEnabled = (group: string) => process.env[`OPEN_ORACLE_CAPTURE_${group}`] === '1'

async function captureScreenshots(chromium: string, origin: string, outputDirectory: string) {
	const browser = await launchCaptureBrowser(chromium)
	try {
		const session = createBrowserSession(browser, outputDirectory)
		await captureSections(session, origin)
		if (captureEnabled('SETTINGS')) await captureSettingsStates(session, origin)
		if (captureEnabled('CONFIGURATION_STATES')) await captureConfigurationStates(session, origin)
		if (captureEnabled('RESUME')) await captureResumeStates(session, origin)
		if (captureEnabled('STATUS')) await captureConnectionStates(session, origin, await captureStatusStates(session, origin))
		if (captureEnabled('QA')) await captureAttentionNavigation(session, origin)
		if (session.runtimeDiagnostics.length > 0) throw new Error(`Chromium reported ${session.runtimeDiagnostics.length.toString()} runtime or console errors: ${session.runtimeDiagnostics.join('\n')}`)
		await session.close()
	} finally {
		await browser.close()
	}
}

const server = startFixtureServer()

try {
	if (process.argv.includes('--serve')) {
		await new Promise(() => {})
	}
	const outputDirectory = process.env['OPEN_ORACLE_SCREENSHOT_OUTPUT_DIR'] ?? join(import.meta.dir, '..', 'docs', 'assets')
	await mkdir(outputDirectory, { recursive: true })
	const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
	const port = server.port
	if (port === undefined) throw new Error('Dashboard screenshot server did not expose a listening port')
	const origin = `http://${server.hostname}:${port.toString()}`
	await captureScreenshots(chromium, origin, outputDirectory)
} finally {
	server.stop(true)
}
