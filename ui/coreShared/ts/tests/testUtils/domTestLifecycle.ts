import { afterEach, beforeEach } from 'bun:test'
import { installDomEnvironment } from './domEnvironment.js'

type DomTestLifecycleOptions = {
	afterTest?: () => Promise<void> | void
	url?: string
}

export function installDomTestLifecycle(options: DomTestLifecycleOptions = {}) {
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment(options.url).cleanup
	})

	afterEach(async () => {
		try {
			await options.afterTest?.()
		} finally {
			restoreDomEnvironment?.()
			restoreDomEnvironment = undefined
		}
	})
}
