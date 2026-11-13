import { mkdir } from 'node:fs/promises'
import { serializedSettings } from '../../src/config/settings.ts'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import type { manualOperationFixture } from '../runtime/manual-operation-fixture.ts'
import { chromiumExecutable, startChromiumSession } from './chromium.ts'

/** Serves a manual-operation fixture's dashboard and opens Chromium; `capture` writes a screenshot only when CHAOS_QA_SCREENSHOTS names a directory. */
export async function startManualOperationDashboardSession(fixture: ReturnType<typeof manualOperationFixture>) {
	const dashboard = startDashboardServer(0, {
		hostname: '127.0.0.1',
		getState: () => fixture.state,
		getConfiguration: () => ({ hasSigner: true, revision: fixture.configuration.revision, settings: serializedSettings(fixture.configuration.settings, true), wallet: fixture.state.wallet }),
		setOperation: value => fixture.controller.handle(value),
		setCancellation: () => undefined,
		setCandidate: () => undefined,
		setObligation: () => undefined,
		setReplacement: () => undefined,
		setPaused: () => undefined,
		setSettings: () => undefined,
		setSigner: () => undefined,
		setWorkflow: () => undefined,
	})
	const session = await startChromiumSession(chromiumExecutable)
	const waitFor = (expression: string) => session.waitFor(expression, { attempts: 150, retryFailures: true })
	async function capture(name: string) {
		const directory = process.env['CHAOS_QA_SCREENSHOTS']
		if (directory === undefined) return
		await mkdir(directory, { recursive: true })
		const response = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
		if (typeof response !== 'object' || response === null) throw new Error('Invalid screenshot response')
		const data = Reflect.get(response, 'data')
		if (typeof data !== 'string') throw new Error('Missing screenshot')
		await Bun.write(`${directory}/${name}.png`, Buffer.from(data, 'base64'))
	}
	return { capture, dashboard, session, waitFor }
}
