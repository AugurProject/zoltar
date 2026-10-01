import { existsSync } from 'node:fs'
import { test } from 'bun:test'
import { createDevToolsSession } from '../../../../tooling/ui/browserSmoke.mts'
import type { WaitForOptions } from '../../../../tooling/ui/chromiumDevTools.mts'
import { getChromiumPath } from '../../../../tooling/ui/chromiumPath.ts'

// Two shared 60-second initialization attempts, with time for failed-process cleanup.
export const CHROMIUM_STARTUP_BUDGET_MILLISECONDS = 125_000

/** Chromium or Chrome executable for dashboard browser tests: `CHROMIUM_PATH`, then the shared PATH discovery, then the Debian default. */
export const chromiumExecutable = process.env['CHROMIUM_PATH'] ?? getChromiumPath() ?? '/usr/bin/chromium'

/** Runs a browser test when the Chromium executable exists and skips it otherwise. */
export const browserTest = existsSync(chromiumExecutable) ? test : test.skip

export async function startChromiumSession(chromium: string, { evaluationDefaults = {}, launch = createDevToolsSession }: { readonly evaluationDefaults?: WaitForOptions; readonly launch?: typeof createDevToolsSession } = {}) {
	try {
		return await launch(chromium, 'about:blank', { width: 1440, height: 900 }, { evaluationDefaults })
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith('Chromium initialization timed out while ')) throw error
		console.warn(`Retrying Chromium startup with a fresh process after: ${error.message}`)
		return launch(chromium, 'about:blank', { width: 1440, height: 900 }, { evaluationDefaults })
	}
}
