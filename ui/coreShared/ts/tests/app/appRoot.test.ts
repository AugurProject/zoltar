import { expect, mock, spyOn, test } from 'bun:test'
import { createElement, render } from 'preact'
import { act } from 'preact/test-utils'
import { mountApp } from '../../app/appRoot.js'
import { getActiveNetworkProfile, installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { SEPOLIA_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { createDeferred } from '../testUtils/deferred.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { createFakeBackend } from '../testUtils/fakeBackend.js'
import { within } from '../testUtils/queries.js'

const applicationTitle = 'Zoltar'

installDomTestLifecycle({
	url: 'http://localhost/?genesis=yes',
	afterTest: async () => {
		await act(() => render(null, document.body))
	},
})

for (const applicationTitle of ['Zoltar', 'Augur Statoblast', 'Statoblast Trading']) {
	test(`keeps ${applicationTitle} branding and the Augur v2 universe context visible before a deployment is selected`, async () => {
		window.history.replaceState({}, '', '/')
		const initialize = mock(async () => undefined)
		const root = mock(() => createElement('p', {}, 'Application ready'))
		await act(async () => await mountApp({ applicationTitle, initialize, root }))
		expect(initialize).not.toHaveBeenCalled()
		expect(root).not.toHaveBeenCalled()
		expect(document.querySelector('.app-chrome .header-toolbar .application-brand-name')?.textContent).toBe(applicationTitle)
		expect(document.querySelector('.application-brand img')?.getAttribute('src')).toBe('./favicon.svg')
		expect(document.querySelector('.application-brand img')?.getAttribute('alt')).toBe('')
		expect(within(document.body).getByText('Augur v2 universe')).not.toBeNull()
		expect(within(document.body).getByRole('heading', { name: 'Choose the truthful universe', level: 1 })).not.toBeNull()
		expect(within(document.body).getByRole('heading', { name: 'Universe', level: 2 })).not.toBeNull()
		expect(within(document.body).getByRole('heading', { name: 'Augur v2 universe', level: 3 })).not.toBeNull()
		expect(within(document.body).getByText('Forked', { selector: '.decision-heading .badge' })).not.toBeNull()
		for (const label of ['Universe ID', 'Parent universe', 'REP supply']) expect(within(document.body).queryByText(label)).toBeNull()
		expect(document.querySelectorAll('.migration-outcome-list .badge')).toHaveLength(0)
		expect(document.querySelectorAll('.migration-outcome-label')).toHaveLength(2)
		for (const outcome of ['Yes', 'No']) {
			const button = within(document.body).getByRole('button', { name: `Open ${outcome} universe` })
			expect(button.textContent).toContain(`${outcome} →`)
			expect(button.hasAttribute('disabled')).toBe(false)
			expect(button.hasAttribute('aria-describedby')).toBe(false)
		}
		expect(
			within(document.body)
				.getAllByRole('button')
				.map(button => button.getAttribute('aria-label')),
		).toEqual(['Open Yes universe', 'Open No universe'])
	})
}

test('links the historical Augur fork to Ethereum mainnet while the application uses Sepolia', async () => {
	window.history.replaceState({}, '', '/?network=sepolia')
	const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
	try {
		await act(async () => await mountApp({ applicationTitle, initialize: async () => undefined, root: () => createElement('p', {}, 'Application ready') }))
		expect(getActiveNetworkProfile().id).toBe('sepolia')
		expect(within(document.body).getByRole('link', { name: 'View fork question on Ethereum' }).getAttribute('href')).toBe('https://etherscan.io/address/0x963EED85778CC23E2D4636Cd4f29eECDF9827E9e#readContract')
	} finally {
		resetEnvironment()
	}
})

test('requires an explicit Yes or No choice before initializing or mounting any application', async () => {
	for (const search of ['', '?universe=0', '?genesis=repv2', '?genesis=invalid']) {
		window.history.replaceState({}, '', `/${search}`)
		const initialize = mock(async () => undefined)
		const root = mock(() => createElement('p', {}, 'Application ready'))
		await act(async () => await mountApp({ applicationTitle, initialize, root }))
		expect(initialize).not.toHaveBeenCalled()
		expect(root).not.toHaveBeenCalled()
		expect(within(document.body).getByRole('heading', { name: 'Choose the truthful universe' })).not.toBeNull()
		expect(
			within(document.body)
				.getAllByRole('button')
				.map(button => button.getAttribute('aria-label')),
		).toEqual(['Open Yes universe', 'Open No universe'])
		expect(within(document.body).getByRole('heading', { name: 'Child universes', level: 3 })).not.toBeNull()
		await act(() => render(null, document.body))
	}
})

test('choosing No records the URL choice and mounts the app after initialization', async () => {
	window.history.replaceState({}, '', '/?simulate=1#/zoltar?universe=12')
	const initialize = mock(async () => undefined)
	await act(async () => await mountApp({ applicationTitle, initialize, root: () => createElement('p', {}, 'Application ready') }))
	await act(async () => {
		within(document.body).getByRole('button', { name: 'Open No universe' }).click()
		await Promise.resolve()
	})
	expect(initialize).toHaveBeenCalledTimes(1)
	expect(window.location.search).toBe('?simulate=1&genesis=no')
	expect(window.location.hash).toBe('#/zoltar?universe=12')
	expect(document.body.textContent).toBe('Application ready')
})

test('disables both ordinary outcome controls while the chosen deployment initializes', async () => {
	window.history.replaceState({}, '', '/')
	const ready = createDeferred<void>()
	const initialize = mock(() => ready.promise)
	const root = mock(() => createElement('p', {}, 'Application ready'))
	await act(async () => await mountApp({ applicationTitle, initialize, root }))
	await act(() => within(document.body).getByRole('button', { name: 'Open No universe' }).click())
	const buttons = within(document.body).getAllByRole('button')
	expect(document.querySelector('.application-brand-name')?.textContent).toBe(applicationTitle)
	expect(within(document.body).getByText('Augur v2 universe')).not.toBeNull()
	expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
	const opening = within(document.body).getByRole('status')
	expect(opening.getAttribute('aria-live')).toBe('polite')
	expect(opening.closest('[aria-busy="true"]') === null).toBe(true)
	expect(opening.textContent).toBe('Opening No universe')
	expect(within(document.body).getByRole('button', { name: 'Open No universe' }).textContent).toContain('Opening No universe')
	expect(within(document.body).getByRole('button', { name: 'Open Yes universe' }).textContent).not.toContain('Opening')
	await act(() => buttons.forEach(button => button.click()))
	expect(initialize).toHaveBeenCalledTimes(1)
	expect(root).not.toHaveBeenCalled()
	await act(async () => {
		ready.resolve()
		await ready.promise
	})
	expect(root).toHaveBeenCalledTimes(1)
})

for (const useSeparateTarget of [false, true]) {
	test(`replaces the static loading placeholder without adopting it or removing the pending chooser in ${useSeparateTarget ? 'a separate target' : 'the production body target'}`, async () => {
		window.history.replaceState({}, '', '/')
		const placeholder = document.createElement('main')
		placeholder.textContent = 'Loading…'
		document.body.append(placeholder)
		const target = useSeparateTarget ? document.createElement('div') : document.body
		if (useSeparateTarget) document.body.append(target)
		const ready = createDeferred<void>()
		const initialize = mock(() => ready.promise)
		await act(async () => await mountApp({ applicationTitle, initialize, root: () => createElement('main', {}, 'Ready'), target }))
		expect(placeholder.isConnected).toBe(false)
		expect(document.querySelectorAll('main')).toHaveLength(1)
		expect(document.body.textContent).not.toContain('Loading…')
		const chooser = document.querySelector('main')
		await act(() => within(target).getByRole('button', { name: 'Open No universe' }).click())
		expect(initialize).toHaveBeenCalledTimes(1)
		expect(document.querySelector('main')).toBe(chooser)
		expect(document.querySelectorAll('main')).toHaveLength(1)
		expect(within(target).getByRole('status').textContent).toBe('Opening No universe')
		await act(async () => {
			ready.resolve()
			await ready.promise
		})
		expect(document.querySelectorAll('main')).toHaveLength(1)
		expect(document.body.textContent).toBe('Ready')
		await act(() => render(null, target))
	})
}

test('waits for initialization before rendering the requested root into its target', async () => {
	const ready = createDeferred<void>()
	const target = document.createElement('div')
	document.body.appendChild(target)
	const root = mock(() => createElement('p', {}, 'Ready'))
	const mounted = mountApp({ applicationTitle, initialize: () => ready.promise, root, target })
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
				const mounted = mountApp({ applicationTitle, initialize: () => ready.promise, root })
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
			await mountApp({ applicationTitle, initialize, root: () => createElement('p', {}, 'Application ready') })
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
				applicationTitle,
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
			await mountApp({ applicationTitle, initialize: async () => undefined, root: () => createElement(Screen, {}) })
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
	await expect(mountApp({ applicationTitle, initialize })).rejects.toThrow('mountApp requires a root component factory')
	expect(initialize).not.toHaveBeenCalled()
})
