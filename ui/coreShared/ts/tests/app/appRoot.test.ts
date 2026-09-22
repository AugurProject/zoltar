import { expect, mock, spyOn, test } from 'bun:test'
import { createElement, render } from 'preact'
import { act } from 'preact/test-utils'
import { mountApp } from '../../app/appRoot.js'
import { createDeferred } from '../testUtils/deferred.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { within } from '../testUtils/queries.js'

installDomTestLifecycle({
	afterTest: async () => {
		await act(() => render(null, document.body))
	},
})

test('waits for initialization before rendering the requested root into its target', async () => {
	const ready = createDeferred<void>()
	const target = document.createElement('div')
	document.body.appendChild(target)
	const root = mock(() => createElement('p', {}, 'Ready'))
	const mounted = mountApp({ initialize: () => ready.promise, root, target })
	expect(root).not.toHaveBeenCalled()
	expect(target.textContent).toBe('')
	await act(async () => {
		ready.resolve()
		await mounted
	})
	expect(root).toHaveBeenCalledTimes(1)
	expect(target.textContent).toBe('Ready')
	await act(() => render(null, target))
})

test('shows an initialization error and retries once even when retry is clicked twice', async () => {
	const retry = createDeferred<void>()
	const initialize = mock(async () => {
		if (initialize.mock.calls.length === 1) throw new Error('Read RPC unavailable')
		await retry.promise
	})
	const errorLog = spyOn(console, 'error').mockImplementation(() => undefined)
	try {
		await act(async () => {
			await mountApp({ initialize, root: () => createElement('p', {}, 'Application ready') })
		})
		expect(within(document.body).getByRole('alert').textContent).toContain('Read RPC unavailable')
		const button = within(document.body).getByRole('button', { name: 'Retry' })
		await act(() => {
			button.click()
			button.click()
		})
		expect(initialize).toHaveBeenCalledTimes(2)
		expect(button.hasAttribute('disabled')).toBe(true)
		await act(async () => {
			retry.resolve()
			await retry.promise
		})
		expect(document.body.textContent).toBe('Application ready')
		expect(document.querySelector('[role="alert"]')).toBeNull()
	} finally {
		errorLog.mockRestore()
	}
})

test('renders the same recoverable notice if constructing the root fails', async () => {
	const errorLog = spyOn(console, 'error').mockImplementation(() => undefined)
	try {
		await act(async () => {
			await mountApp({
				initialize: async () => undefined,
				root: () => {
					throw new Error('Root failed')
				},
			})
		})
		expect(within(document.body).getByRole('alert').textContent).toContain('Root failed')
	} finally {
		errorLog.mockRestore()
	}
})

test('rejects a missing root before running initialization', async () => {
	const initialize = mock(async () => undefined)
	await expect(mountApp({ initialize })).rejects.toThrow('mountApp requires a root component factory')
	expect(initialize).not.toHaveBeenCalled()
})
