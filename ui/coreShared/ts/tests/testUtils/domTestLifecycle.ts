import { afterEach, beforeEach } from 'bun:test'
import { installDomEnvironment } from './domEnvironment.js'
import { appQueryCache } from '../../lib/dataRefresh.js'

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
			// The application query cache is a module singleton; a read left in flight must not leak into the next test.
			appQueryCache.clear()
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
