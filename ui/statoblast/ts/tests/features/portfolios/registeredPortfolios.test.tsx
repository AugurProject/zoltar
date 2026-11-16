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
import { PortfoliosSection } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfoliosSection.js'
import * as capitalCopy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
import { capital, capitalSnapshot, owner, portfolio } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${portfolio}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

const { questionCount } = capitalSnapshot()
/** Registers the fixture portfolio, with a capital ledger in the listed universe unless one is given. */
function registerPortfolio(source: ReturnType<typeof capitalClient>, { ledger = capital, registry = [portfolio] }: { ledger?: Address; registry?: Address[] } = {}) {
	source.setRead('portfolioCount', BigInt(registry.length))
	source.setRead('portfoliosRange', registry)
	source.setRead('capitalLedger', ledger)
	source.setRead('questionCount', questionCount)
}
/** A first visit: nothing remembered and no portfolio in the URL. */
function startFirstVisit() {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
}
function installRegisteredPortfolio() {
	const source = capitalClient()
	registerPortfolio(source)
	source.install()
	return source
}
const ownerField = (container: Element) => [...container.querySelectorAll('.field')].find(field => field.querySelector('label')?.textContent === copy.owner)
const list = (container: Element) => [...container.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent === copy.portfoliosInUniverse)
const addressField = (container: Element) => [...container.querySelectorAll('input')].find(input => input.closest('.field')?.querySelector('label')?.textContent === copy.manager)
const renderSection = async () => {
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	return view
}

test("a first visit lists the universe's portfolios and opens one without typing its address", async () => {
	// Live networks have no owner discovery, so the tab used to start with an empty address and nothing to choose.
	startFirstVisit()
	installRegisteredPortfolio()
	const view = await renderSection()
	// Open from the start, so its loading state is visible and the arriving rows cause no jump.
	expect(list(view.container)?.open).toBe(true)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(addressField(view.container)?.value).toBe('')
	const open = list(view.container)?.querySelector('li button')
	if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
	expect(open.getAttribute('aria-label')).toBe(copy.formatOpenPortfolioLabel(portfolio))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	open.focus()
	await act(() => open.click())
	await waitFor(() => expect(view.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	expect(addressField(view.container)?.value).toBe(portfolio)
	// The same button stays in place and keeps focus, marked as the selected portfolio.
	expect(open.isConnected).toBe(true)
	expect(document.activeElement === open).toBe(true)
	expect(open.getAttribute('aria-disabled')).toBe('true')
	expect(open.getAttribute('aria-label')).toBe(copy.formatSelectedPortfolioLabel(portfolio))
	expect(open.querySelector('[aria-hidden="true"]')?.textContent).toBe(copy.openPortfolio)
	expect(list(view.container)?.open).toBe(true)
})

test('a linked or remembered portfolio keeps the list folded', async () => {
	const source = installRegisteredPortfolio()
	const linked = await renderSection()
	await waitFor(() => expect(linked.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	expect(list(linked.container)?.open).toBe(false)
	// Folded and never opened, the list reads nothing; unfolding it loads the rows.
	expect(source.reads.some(read => read.name === 'portfolioCount')).toBe(false)
	await act(() => {
		const details = list(linked.container)
		if (details === undefined) throw new Error('Missing portfolio list')
		details.open = true
		details.dispatchEvent(new Event('toggle'))
	})
	await waitFor(() => expect(list(linked.container)?.querySelector('li button')?.getAttribute('aria-disabled')).toBe('true'))
	linked.unmount()
	// Opening the linked portfolio remembered it for this network.
	window.history.replaceState(undefined, '', '/#/portfolios')
	const remembered = await renderSection()
	await waitFor(() => expect(addressField(remembered.container)?.value).toBe(portfolio))
	expect(list(remembered.container)?.open).toBe(false)
})

test('a failed portfolio read shows the error with a retry', async () => {
	startFirstVisit()
	const source = capitalClient()
	registerPortfolio(source)
	source.setRead('portfoliosRange', 'not a portfolio list')
	source.install()
	const view = await renderSection()
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry')
	await waitFor(() => expect(retry()).toBeTruthy())
	expect(list(view.container)?.open).toBe(true)
	registerPortfolio(source)
	await act(() => retry()?.click())
	await waitFor(() => expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount))))
	expect(retry() === undefined).toBe(true)
})

test('the list shows it is loading while the page waits to read the chain', async () => {
	startFirstVisit()
	capitalClient().install()
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} walletConnected enabled={false} environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	expect(list(view.container)?.open).toBe(true)
	expect(list(view.container)?.textContent).toContain(copy.loadingPortfolios)
})

test('a failed reload keeps the rows already shown next to the error', async () => {
	startFirstVisit()
	const source = installRegisteredPortfolio()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	source.setRead('portfoliosRange', 'not a portfolio list')
	await act(() => invalidateAppData())
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry' || button.textContent === 'Retrying…')
	await waitFor(() => expect(retry()?.textContent).toBe('Retry'))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	// While the retry runs, its button stays in place, disabled and labelled as running, and the rows stay.
	const pending = createDeferred<unknown>()
	source.setRead('portfoliosRange', pending.promise)
	const button = retry()
	await act(() => button?.click())
	expect(button?.isConnected).toBe(true)
	expect(button?.textContent).toBe('Retrying…')
	expect(button?.disabled).toBe(true)
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
	await act(() => pending.resolve([portfolio]))
	await waitFor(() => expect(retry() === undefined).toBe(true))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(Number(questionCount)))
})

test('an empty registry says so and lists nothing', async () => {
	startFirstVisit()
	capitalClient().install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noPortfoliosInUniverse))
	expect(list(view.container)?.querySelector('.empty-state')?.textContent).toBe(copy.noPortfoliosInUniverse + copy.noPortfoliosHint)
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a portfolio with no wallet or owner says so under the owner field', async () => {
	startFirstVisit()
	installRegisteredPortfolio()
	const visitor = { ...parameters, accountAddress: undefined }
	const view = await renderIntoDocument(<PortfoliosSection parameters={visitor} walletConnected={false} enabled environmentKey={0} activeUniverseId={0n} />)
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
	await act(() => render(<PortfoliosSection parameters={visitor} walletConnected={false} enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(view.container.textContent).not.toContain(copy.ownerNeeded)
})

test('a portfolio with no capital ledger in this universe is not listed here', async () => {
	startFirstVisit()
	const source = capitalClient()
	registerPortfolio(source, { ledger: zeroAddress })
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noPortfoliosInUniverse))
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a listed portfolio opens it in the universe the list is for', async () => {
	startFirstVisit()
	installRegisteredPortfolio()
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
	// Moving to another universe un-selects the row, so it can open the portfolio here again.
	await act(() => {
		const input = universeField()
		if (input === undefined) throw new Error('Missing universe field')
		input.value = '5'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	expect(button()?.getAttribute('aria-disabled') === null).toBe(true)
	expect(button()?.getAttribute('aria-label')).toBe(copy.formatOpenPortfolioLabel(portfolio))
	await act(() => {
		const open = button()
		if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
		open.click()
	})
	expect(universeField()?.value).toBe('0')
	expect(button()?.getAttribute('aria-disabled')).toBe('true')
})

test('a connected wallet with an emptied owner field is asked only for an owner address', async () => {
	installRegisteredPortfolio()
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
	installRegisteredPortfolio()
	// Off the app's network the scoped account is unset, though a wallet is connected.
	const view = await renderIntoDocument(<PortfoliosSection parameters={{ ...parameters, accountAddress: undefined }} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
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

test('a registered address that does not answer as a portfolio is skipped', async () => {
	// Any caller can register its own address with the factory, so one stranger must not fail the list.
	startFirstVisit()
	const stranger = getAddress('0x00000000000000000000000000000000000000c3')
	const source = capitalClient()
	registerPortfolio(source, { registry: [portfolio, stranger] })
	source.failMulticallAt(stranger)
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(list(view.container)?.querySelectorAll('li').length).toBe(1)
	expect(list(view.container)?.querySelector('li button')?.getAttribute('aria-label')).toBe(copy.formatOpenPortfolioLabel(portfolio))
})
