import { afterEach, beforeEach } from 'bun:test'
import { installDomEnvironment } from './domEnvironment.js'

type DomTestLifecycleOptions = {
	afterTest?: () => Promise<void> | void
	url?: string
}

export function installDomTestLifecycle(options: DomTestLifecycleOptions = {}) {
	let restoreDomEnvironment: (() => void) | undefined
	const renderedCleanups: Array<() => Promise<void> | void> = []

	beforeEach(() => {
		renderedCleanups.length = 0
		restoreDomEnvironment = installDomEnvironment(options.url).cleanup
	})

	afterEach(async () => {
		try {
			for (const cleanup of renderedCleanups.reverse()) await cleanup()
			await options.afterTest?.()
		} finally {
			renderedCleanups.length = 0
			restoreDomEnvironment?.()
			restoreDomEnvironment = undefined
		}
	})

	return {
		trackRendered<T extends { cleanup: () => Promise<void> | void }>(rendered: T): T {
			renderedCleanups.push(rendered.cleanup)
			return rendered
		},
	}
}
