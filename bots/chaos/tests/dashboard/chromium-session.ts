import { createDevToolsSession } from '../../../../tooling/ui/browserSmoke.mts'

// Two shared 60-second initialization attempts, with time for failed-process cleanup.
export const CHROMIUM_STARTUP_BUDGET_MILLISECONDS = 125_000

export async function startChromiumSession(chromium: string, launch = createDevToolsSession) {
	try {
		return await launch(chromium, 'about:blank', { width: 1440, height: 900 })
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith('Chromium initialization timed out while ')) throw error
		console.warn(`Retrying Chromium startup with a fresh process after: ${error.message}`)
		return launch(chromium, 'about:blank', { width: 1440, height: 900 })
	}
}
