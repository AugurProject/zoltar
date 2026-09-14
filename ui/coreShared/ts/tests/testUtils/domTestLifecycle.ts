import { afterEach, beforeEach } from 'bun:test'
import { installDomEnvironment } from './domEnvironment.js'

type DomTestLifecycleOptions = {
	beforeTest?: (environment: ReturnType<typeof installDomEnvironment>) => Promise<void> | void
	afterTest?: () => Promise<void> | void
	url?: string
}

export function installDomTestLifecycle(options: DomTestLifecycleOptions = {}) {
	let restoreDomEnvironment: (() => void) | undefined
	const renderedCleanups: Array<() => Promise<void> | void> = []

	beforeEach(async () => {
		renderedCleanups.length = 0
		const environment = installDomEnvironment(options.url)
		restoreDomEnvironment = environment.cleanup
		await options.beforeTest?.(environment)
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
