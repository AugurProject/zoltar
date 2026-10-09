import { expect, mock, spyOn, test } from 'bun:test'
import { createElement, render } from 'preact'
import { act } from 'preact/test-utils'
import { mountApp } from '../../app/appRoot.js'
import { createDeferred } from '../testUtils/deferred.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { within } from '../testUtils/queries.js'

installDomTestLifecycle({
	url: 'http://localhost/?genesis=yes',
	afterTest: async () => {
		await act(() => render(null, document.body))
	},
})

test('requires an explicit Yes or No choice before initializing or mounting any application', async () => {
	for (const search of ['', '?universe=0', '?genesis=repv2', '?genesis=invalid']) {
		window.history.replaceState({}, '', `/${search}`)
		const initialize = mock(async () => undefined)
		const root = mock(() => createElement('p', {}, 'Application ready'))
		await act(async () => await mountApp({ initialize, root }))
		expect(initialize).not.toHaveBeenCalled()
		expect(root).not.toHaveBeenCalled()
		expect(within(document.body).getByRole('heading', { name: 'Choose the truthful universe' })).not.toBeNull()
		expect(
			within(document.body)
				.getAllByRole('button')
				.map(button => button.getAttribute('aria-label')),
		).toEqual(['Open Genesis › Yes', 'Open Genesis › No'])
		await act(() => render(null, document.body))
	}
})

test('choosing No records the URL choice and mounts the app after initialization', async () => {
	window.history.replaceState({}, '', '/?simulate=1#/zoltar?universe=12')
	const initialize = mock(async () => undefined)
	await act(async () => await mountApp({ initialize, root: () => createElement('p', {}, 'Application ready') }))
	await act(async () => {
		within(document.body).getByRole('button', { name: 'Open Genesis › No' }).click()
		await Promise.resolve()
	})
	expect(initialize).toHaveBeenCalledTimes(1)
	expect(window.location.search).toBe('?simulate=1&genesis=no')
	expect(window.location.hash).toBe('#/zoltar?universe=12')
	expect(document.body.textContent).toBe('Application ready')
})

test('replaces the static loading placeholder with one choice landmark when mounting into a separate app target', async () => {
	window.history.replaceState({}, '', '/')
	const placeholder = document.createElement('main')
	placeholder.textContent = 'Loading…'
	const target = document.createElement('div')
	document.body.append(placeholder, target)
	await act(async () => await mountApp({ initialize: async () => undefined, root: () => createElement('p', {}, 'Ready'), target }))
	expect(document.querySelectorAll('main')).toHaveLength(1)
	expect(document.body.textContent).not.toContain('Loading…')
	await act(() => render(null, target))
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

for (const outcome of ['no', 'invalid']) {
	for (const failedInitialization of [false, true]) {
		test(`reloads instead of mounting stale Yes initialization after changing genesis to ${outcome}${failedInitialization ? ' and initialization fails' : ''}`, async () => {
			window.history.replaceState({}, '', '/#/zoltar?genesis=yes')
			const ready = createDeferred<void>()
			const root = mock(() => createElement('p', {}, 'Stale Yes application'))
			const reload = spyOn(window.location, 'reload').mockImplementation(() => undefined)
			const errorLog = spyOn(console, 'error').mockImplementation(() => undefined)
			try {
				const mounted = mountApp({ initialize: () => ready.promise, root })
				window.history.replaceState({}, '', `/#/zoltar?genesis=${outcome}`)
				await act(async () => {
					if (failedInitialization) ready.reject(new Error('Stale Yes initialization failed'))
					else ready.resolve()
					await mounted
				})
				expect(root).not.toHaveBeenCalled()
				expect(reload).toHaveBeenCalledTimes(1)
				expect(document.querySelector('[role="alert"]')).toBeNull()
			} finally {
				reload.mockRestore()
				errorLog.mockRestore()
			}
		})
	}
}

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

test('replaces a tree that fails to render with a recoverable notice instead of freezing it', async () => {
	const errorLog = spyOn(console, 'error').mockImplementation(() => undefined)
	const state = { failing: true }
	function Screen() {
		if (state.failing) throw new RangeError('Approval amount must be non-negative')
		return createElement('p', {}, 'Screen ready')
	}
	try {
		await act(async () => {
			await mountApp({ initialize: async () => undefined, root: () => createElement(Screen, {}) })
		})
		const notice = within(document.body).getByRole('alert')
		expect(notice.textContent).toContain('Application error')
		expect(notice.textContent).toContain('Approval amount must be non-negative')
		expect(within(document.body).getByRole('button', { name: 'Reload application' })).not.toBeNull()
		state.failing = false
		await act(async () => {
			within(document.body).getByRole('button', { name: 'Retry' }).click()
			await Promise.resolve()
		})
		expect(document.body.textContent).toBe('Screen ready')
	} finally {
		errorLog.mockRestore()
	}
})

test('rejects a missing root before running initialization', async () => {
	const initialize = mock(async () => undefined)
	await expect(mountApp({ initialize })).rejects.toThrow('mountApp requires a root component factory')
	expect(initialize).not.toHaveBeenCalled()
})
