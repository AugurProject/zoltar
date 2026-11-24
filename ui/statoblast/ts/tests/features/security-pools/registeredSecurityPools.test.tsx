import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import * as capitalCopy from '@zoltar/ui-statoblast-shared/copy/securityPoolCapital.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/securityPool.js'
import { capital, capitalSnapshot, owner, securityPool } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/security-pools?securityPool=${securityPool}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

const { questionCount } = capitalSnapshot()
/** Registers the fixture security pool, with a capital ledger in the listed universe unless one is given. */
function registerSecurityPool(source: ReturnType<typeof capitalClient>, { ledger = capital, registry = [securityPool] }: { ledger?: Address; registry?: Address[] } = {}) {
	source.setRead('securityPoolCount', BigInt(registry.length))
	source.setRead('securityPoolsRange', registry)
	source.setRead('capitalLedger', ledger)
	source.setRead('questionCount', questionCount)
}
/** A first visit: nothing remembered and no security pool in the URL. */
function startFirstVisit() {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/security-pools')
}
function installRegisteredSecurityPool() {
	const source = capitalClient()
	registerSecurityPool(source)
	source.install()
	return source
}
const ownerField = (container: Element) => [...container.querySelectorAll('.field')].find(field => field.querySelector('label')?.textContent === copy.owner)
const list = (container: Element) => [...container.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent === copy.securityPoolsInUniverse)
const addressField = (container: Element) => [...container.querySelectorAll('input')].find(input => input.closest('.field')?.querySelector('label')?.textContent === copy.manager)
const renderSection = async () => {
	const view = await renderIntoDocument(<SecurityPoolsSection parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	return view
}

test("a first visit lists the universe's security pools and opens one without typing its address", async () => {
	// Live networks have no owner discovery, so the tab used to start with an empty address and nothing to choose.
	startFirstVisit()
	installRegisteredSecurityPool()
	const view = await renderSection()
	// Open from the start, so its loading state is visible and the arriving rows cause no jump.
	expect(list(view.container)?.open).toBe(true)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(addressField(view.container)?.value).toBe('')
	const open = list(view.container)?.querySelector('li button')
	if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
	expect(open.getAttribute('aria-label')).toBe(copy.formatOpenSecurityPoolLabel(securityPool))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	open.focus()
	await act(() => open.click())
	await waitFor(() => expect(view.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	expect(addressField(view.container)?.value).toBe(securityPool)
	// The same button stays in place and keeps focus, marked as the selected security pool.
	expect(open.isConnected).toBe(true)
	expect(document.activeElement === open).toBe(true)
	expect(open.getAttribute('aria-disabled')).toBe('true')
	expect(open.getAttribute('aria-label')).toBe(copy.formatSelectedSecurityPoolLabel(securityPool))
	expect(open.querySelector('[aria-hidden="true"]')?.textContent).toBe(copy.openSecurityPool)
	expect(list(view.container)?.open).toBe(true)
})

test('a linked or remembered security pool keeps the list folded', async () => {
	const source = installRegisteredSecurityPool()
	const linked = await renderSection()
	await waitFor(() => expect(linked.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	expect(list(linked.container)?.open).toBe(false)
	// Folded and never opened, the list reads nothing; unfolding it loads the rows.
	expect(source.reads.some(read => read.name === 'securityPoolCount')).toBe(false)
	await act(() => {
		const details = list(linked.container)
		if (details === undefined) throw new Error('Missing security pool list')
		details.open = true
		details.dispatchEvent(new Event('toggle'))
	})
	await waitFor(() => expect(list(linked.container)?.querySelector('li button')?.getAttribute('aria-disabled')).toBe('true'))
	linked.unmount()
	// Opening the linked security pool remembered it for this network.
	window.history.replaceState(undefined, '', '/#/security-pools')
	const remembered = await renderSection()
	await waitFor(() => expect(addressField(remembered.container)?.value).toBe(securityPool))
	expect(list(remembered.container)?.open).toBe(false)
})

test('a failed security pool read shows the error with a retry', async () => {
	startFirstVisit()
	const source = capitalClient()
	registerSecurityPool(source)
	source.setRead('securityPoolsRange', 'not a security pool list')
	source.install()
	const view = await renderSection()
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry')
	await waitFor(() => expect(retry()).toBeTruthy())
	expect(list(view.container)?.open).toBe(true)
	registerSecurityPool(source)
	await act(() => retry()?.click())
	await waitFor(() => expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount))))
	expect(retry() === undefined).toBe(true)
})

test('the list shows it is loading while the page waits to read the chain', async () => {
	startFirstVisit()
	capitalClient().install()
	const view = await renderIntoDocument(<SecurityPoolsSection parameters={parameters} walletConnected enabled={false} environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	expect(list(view.container)?.open).toBe(true)
	expect(list(view.container)?.textContent).toContain(copy.loadingSecurityPools)
})

test('a failed reload keeps the rows already shown next to the error', async () => {
	startFirstVisit()
	const source = installRegisteredSecurityPool()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	source.setRead('securityPoolsRange', 'not a security pool list')
	await act(() => invalidateAppData())
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry' || button.textContent === 'Retrying…')
	await waitFor(() => expect(retry()?.textContent).toBe('Retry'))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	// While the retry runs, its button stays in place, disabled and labelled as running, and the rows stay.
	const pending = createDeferred<unknown>()
	source.setRead('securityPoolsRange', pending.promise)
	const button = retry()
	await act(() => button?.click())
	expect(button?.isConnected).toBe(true)
	expect(button?.textContent).toBe('Retrying…')
	expect(button?.disabled).toBe(true)
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	await act(() => pending.resolve([securityPool]))
	await waitFor(() => expect(retry() === undefined).toBe(true))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
})

test('an empty registry says so and lists nothing', async () => {
	startFirstVisit()
	capitalClient().install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noSecurityPoolsInUniverse))
	expect(list(view.container)?.querySelector('.empty-state')?.textContent).toBe(copy.noSecurityPoolsInUniverse + copy.noSecurityPoolsHint)
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a security pool with no wallet or owner says so under the owner field', async () => {
	startFirstVisit()
	installRegisteredSecurityPool()
	const visitor = { ...parameters, accountAddress: undefined }
	const view = await renderIntoDocument(<SecurityPoolsSection parameters={visitor} walletConnected={false} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(ownerField(view.container)?.textContent).toContain(copy.ownerHint)
	const open = list(view.container)?.querySelector('li button')
	if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
	await act(() => open.click())
	// The message replaces the owner hint rather than adding a line above the list.
	await waitFor(() => expect(ownerField(view.container)?.textContent).toContain(copy.ownerNeeded))
	expect(ownerField(view.container)?.textContent).not.toContain(copy.ownerHint)
	expect(ownerField(view.container)?.querySelector('[aria-live="polite"]')?.textContent).toContain(copy.ownerNeeded)
	// The setup stage is unknown without an owner, so it is not shown as zero.
	expect(view.container.textContent).toContain(capitalCopy.prepareProgressUnknown)
	expect(view.container.textContent).not.toContain(capitalCopy.prepareProgress(0))
	// While the page cannot read the chain yet, a wallet may still be starting up, so nothing is said.
	await act(() => render(<SecurityPoolsSection parameters={visitor} walletConnected={false} enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(view.container.textContent).not.toContain(copy.ownerNeeded)
})

test('a security pool with no capital ledger in this universe is not listed here', async () => {
	startFirstVisit()
	const source = capitalClient()
	registerSecurityPool(source, { ledger: zeroAddress })
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noSecurityPoolsInUniverse))
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a listed security pool opens it in the universe the list is for', async () => {
	startFirstVisit()
	installRegisteredSecurityPool()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	const universeField = () => [...view.container.querySelectorAll('input')].find(input => input.closest('.field')?.querySelector('label')?.textContent === copy.universe)
	await act(() => {
		const input = universeField()
		if (input === undefined) throw new Error('Missing universe field')
		input.value = '5'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await act(() => {
		const open = list(view.container)?.querySelector('li button')
		if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
		open.click()
	})
	expect(universeField()?.value).toBe('0')
	await waitFor(() => expect(view.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	const button = () => list(view.container)?.querySelector('li button')
	expect(button()?.getAttribute('aria-disabled')).toBe('true')
	// Moving to another universe un-selects the row, so it can open the security pool here again.
	await act(() => {
		const input = universeField()
		if (input === undefined) throw new Error('Missing universe field')
		input.value = '5'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	expect(button()?.getAttribute('aria-disabled') === null).toBe(true)
	expect(button()?.getAttribute('aria-label')).toBe(copy.formatOpenSecurityPoolLabel(securityPool))
	await act(() => {
		const open = button()
		if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
		open.click()
	})
	expect(universeField()?.value).toBe('0')
	expect(button()?.getAttribute('aria-disabled')).toBe('true')
})

test('a connected wallet with an emptied owner field is asked only for an owner address', async () => {
	installRegisteredSecurityPool()
	const view = await renderSection()
	await waitFor(() => expect(view.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	await act(() => {
		const input = ownerField(view.container)?.querySelector('input')
		if (input === undefined || input === null) throw new Error('Missing owner field')
		input.value = ''
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(ownerField(view.container)?.textContent).toContain(copy.ownerAddressNeeded))
	expect(ownerField(view.container)?.textContent).not.toContain(copy.ownerNeeded)
})

test('a wallet on another network is asked only for an owner address', async () => {
	startFirstVisit()
	installRegisteredSecurityPool()
	// Off the app's network the scoped account is unset, though a wallet is connected.
	const view = await renderIntoDocument(<SecurityPoolsSection parameters={{ ...parameters, accountAddress: undefined }} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	await act(() => {
		const open = list(view.container)?.querySelector('li button')
		if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
		open.click()
	})
	await waitFor(() => expect(ownerField(view.container)?.textContent).toContain(copy.ownerAddressNeeded))
	expect(ownerField(view.container)?.textContent).not.toContain(copy.ownerNeeded)
})

test('a registered address that does not answer as a security pool is skipped', async () => {
	// Any caller can register its own address with the factory, so one stranger must not fail the list.
	startFirstVisit()
	const stranger = getAddress('0x00000000000000000000000000000000000000c3')
	const source = capitalClient()
	registerSecurityPool(source, { registry: [securityPool, stranger] })
	source.failMulticallAt(stranger)
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(list(view.container)?.querySelectorAll('li').length).toBe(1)
	expect(list(view.container)?.querySelector('li button')?.getAttribute('aria-label')).toBe(copy.formatOpenSecurityPoolLabel(securityPool))
})
