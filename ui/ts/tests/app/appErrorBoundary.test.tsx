/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, waitFor, within } from '../testUtils/queries.js'
import { AppErrorBoundary } from '../../app/components/AppErrorBoundary.js'
import { createAppRoot, mountApp } from '../../app/appRoot.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(resolvePromise => {
		resolve = resolvePromise
	})
	return { promise, resolve }
}

describe('AppErrorBoundary', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined
	let originalConsoleError: typeof console.error
	let consoleError: ReturnType<typeof mock>

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
		originalConsoleError = console.error
		consoleError = mock(() => undefined)
		console.error = consoleError
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		console.error = originalConsoleError
	})

	test('replaces a crashed render with a visible recovery screen', async () => {
		let shouldThrow = true
		function CrashingChild() {
			if (shouldThrow) throw new Error('render exploded')
			return <p>Recovered application</p>
		}

		const renderedComponent = await renderIntoDocument(
			<AppErrorBoundary>
				<CrashingChild />
			</AppErrorBoundary>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		expect(documentQueries.getByRole('heading', { name: 'Application error' })).not.toBeNull()
		expect(documentQueries.getByText('The current screen could not be displayed. Reason: render exploded')).not.toBeNull()

		shouldThrow = false
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		expect(documentQueries.getByText('Recovered application')).not.toBeNull()
		expect(consoleError).toHaveBeenCalledWith('[ui] application render failed', expect.any(Error))
	})

	test('wraps the shared production and development app root in the recovery boundary', async () => {
		function CrashingChild(): null {
			throw new Error('shared root exploded')
		}
		const renderedComponent = await renderIntoDocument(createAppRoot(<CrashingChild />))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('alert').textContent).toContain('Application error')
		expect(within(document.body).getByRole('button', { name: 'Retry' })).not.toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Reload application' })).not.toBeNull()
	})

	test('shows the shared recovery actions when environment initialization fails and retries', async () => {
		let initializeAttempts = 0
		const initialize = async () => {
			initializeAttempts += 1
			if (initializeAttempts === 1) throw new Error('environment unavailable')
		}
		await mountApp({
			initialize,
			root: () => createAppRoot(<p>Initialized application</p>),
			target: document.body,
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('The application environment could not be initialized. Reason: environment unavailable')
		fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		expect(await waitFor(() => documentQueries.getByText('Initialized application'))).not.toBeNull()
		expect(initializeAttempts).toBe(2)
		expect(consoleError).toHaveBeenCalledWith('[ui] failed to initialize or mount application', expect.any(Error))
	})

	test('keeps initialization retry single-flight while recovery is pending', async () => {
		const retryInitialization = createDeferred<void>()
		let initializeAttempts = 0
		const initialize = async () => {
			initializeAttempts += 1
			if (initializeAttempts === 1) throw new Error('environment unavailable')
			await retryInitialization.promise
		}
		await mountApp({
			initialize,
			root: () => createAppRoot(<p>Initialized application</p>),
			target: document.body,
		})

		const documentQueries = within(document.body)
		const retryButton = documentQueries.getByRole('button', { name: 'Retry' })
		fireEvent.click(retryButton)
		fireEvent.click(retryButton)

		const retryingButton = await waitFor(() => documentQueries.getByRole('button', { name: 'Retrying…' }))
		expect(retryingButton.hasAttribute('disabled')).toBe(true)
		expect(initializeAttempts).toBe(2)

		retryInitialization.resolve()
		expect(await waitFor(() => documentQueries.getByText('Initialized application'))).not.toBeNull()
		expect(initializeAttempts).toBe(2)
	})
})
