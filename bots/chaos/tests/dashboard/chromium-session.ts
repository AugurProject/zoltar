import { createDevToolsSession } from '../../../../tooling/ui/browserSmoke.mts'

export async function startChromiumSession(chromium: string, launch = createDevToolsSession) {
	try {
		return await launch(chromium, 'about:blank', { width: 1440, height: 900 }, { initializationTimeoutMilliseconds: 10_000 })
	} catch (error) {
		if (!(error instanceof Error) || !error.message.startsWith('Chromium initialization timed out while ')) throw error
		console.warn(`Retrying Chromium startup with a fresh process after: ${error.message}`)
		return launch(chromium, 'about:blank', { width: 1440, height: 900 }, { initializationTimeoutMilliseconds: 10_000 })
	}
}
