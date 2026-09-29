import { afterEach, beforeEach, mock } from 'bun:test'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomEnvironment } from './domEnvironment.js'
import { createFakeBackend } from './fakeBackend.js'
import { resetTransactionActivityForTesting } from '../../transactions/transactionActivityStore.js'
import { appQueryCache } from '../../lib/dataRefresh.js'
import type { ChainBackend } from '../../wallet/chainBackend.js'

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
		resetTransactionActivityForTesting()
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

type FakeEnvironmentLifecycleOptions = {
	accountAddress: Address
	/**
	 * The caller's `installActiveEnvironmentForTesting`. Import it through the same package path as the code under test,
	 * so the test installs its backend into the active-environment module that code reads (CI resolves a relative import
	 * from this helper to a separate module instance).
	 */
	installActiveEnvironment: (backend: ChainBackend) => () => void
}

/**
 * Hook-test lifecycle: each test starts in a DOM with a fake chain backend for the account, and afterwards unmounts the
 * tracked component, resets the active environment, and restores Bun module and function mocks.
 */
export function installFakeEnvironmentLifecycle({ accountAddress, installActiveEnvironment }: FakeEnvironmentLifecycleOptions) {
	let resetEnvironment: (() => void) | undefined
	let cleanupTracked: (() => Promise<void>) | undefined

	const cleanupRendered = async () => {
		const cleanup = cleanupTracked
		cleanupTracked = undefined
		await cleanup?.()
	}

	installDomTestLifecycle({
		beforeTest: () => {
			resetEnvironment = installActiveEnvironment(createFakeBackend({ accountAddress }))
		},
		afterTest: async () => {
			await cleanupRendered()
			resetEnvironment?.()
			resetEnvironment = undefined
			mock.restore()
		},
	})

	return {
		/** Unmounts the tracked component now instead of after the test. */
		cleanupRendered,
		/** Replaces the active chain backend for the rest of the test. */
		replaceEnvironment(backend: ChainBackend) {
			resetEnvironment?.()
			resetEnvironment = installActiveEnvironment(backend)
		},
		/** Tracks the component to unmount after the test, replacing any earlier one; `undefined` stops tracking. */
		trackCleanup(cleanup: (() => Promise<void>) | undefined) {
			cleanupTracked = cleanup
		},
	}
}

export function requireHookState<State>(state: State | undefined): State {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

/**
 * Link-navigation lifecycle: exposes the DOM window's `PopStateEvent` globally so hash navigation can dispatch it, restores
 * the previous global afterwards, and unmounts the tracked component after each test.
 */
export function installLinkNavigationLifecycle() {
	let cleanupTracked: (() => Promise<void>) | undefined
	let previousPopStateEventDescriptor: PropertyDescriptor | undefined

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
			previousPopStateEventDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'PopStateEvent')
			Object.defineProperty(globalThis, 'PopStateEvent', {
				configurable: true,
				value: domEnvironment.window.PopStateEvent,
				writable: true,
			})
		},
		afterTest: async () => {
			await cleanupTracked?.()
			cleanupTracked = undefined
			if (previousPopStateEventDescriptor === undefined) {
				Reflect.deleteProperty(globalThis, 'PopStateEvent')
			} else {
				Object.defineProperty(globalThis, 'PopStateEvent', previousPopStateEventDescriptor)
			}
			previousPopStateEventDescriptor = undefined
		},
	})

	return {
		/** Tracks the component to unmount after the test, replacing any earlier one. */
		trackCleanup(cleanup: () => Promise<void>) {
			cleanupTracked = cleanup
		},
	}
}
