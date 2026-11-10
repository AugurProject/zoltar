import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { PortfoliosSection } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfoliosSection.js'
import * as capitalCopy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolio.js'
import { owner, portfolio, token } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${portfolio}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

const deployments = (universeId: bigint) => [{ securityPool: token, parent: zeroAddress, universeId, questionId: 7n, initialReportPriorityFeeAttoEthPerGas: 1n, openOraclePriceCoordinator: token, statoblastSecurityMultiplierBps: 20000n, truthAuction: zeroAddress }]
function registerQuestion(source: ReturnType<typeof capitalClient>, universeId = 0n) {
	source.setRead('securityPoolDeploymentCount', 1n)
	source.setRead('securityPoolDeploymentsRange', deployments(universeId))
	source.setRead('getSecurityPoolPortfolio', portfolio)
}
const list = (container: Element) => [...container.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent === copy.portfoliosWithQuestions)
const addressField = (container: Element) => [...container.querySelectorAll('input')].find(input => input.closest('.field')?.querySelector('label')?.textContent === copy.manager)
const renderSection = async () => {
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	return view
}

test('a first visit lists portfolios with questions and opens one without typing its address', async () => {
	// Live networks have no owner discovery, so the tab used to start with an empty address and nothing to choose.
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	const view = await renderSection()
	// Open from the start, so its loading state is visible and the arriving rows cause no jump.
	expect(list(view.container)?.open).toBe(true)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(addressField(view.container)?.value).toBe('')
	const open = list(view.container)?.querySelector('li button')
	if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
	expect(open.getAttribute('aria-label')).toBe(copy.formatOpenPortfolioLabel(portfolio))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(1))
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
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	const linked = await renderSection()
	await waitFor(() => expect(linked.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	expect(list(linked.container)?.open).toBe(false)
	// Folded and never opened, the list reads nothing; unfolding it loads the rows.
	expect(source.reads.some(read => read.name === 'securityPoolDeploymentCount')).toBe(false)
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
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.setRead('securityPoolDeploymentsRange', 'not a deployment list')
	source.install()
	const view = await renderSection()
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry')
	await waitFor(() => expect(retry()).toBeTruthy())
	expect(list(view.container)?.open).toBe(true)
	registerQuestion(source)
	await act(() => retry()?.click())
	await waitFor(() => expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(1)))
	expect(retry() === undefined).toBe(true)
})

test('the list shows it is loading while the page waits to read the chain', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	capitalClient().install()
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} walletConnected enabled={false} environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	expect(list(view.container)?.open).toBe(true)
	expect(list(view.container)?.textContent).toContain(copy.loadingPortfolios)
})

test('a failed reload keeps the rows already shown next to the error', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	source.setRead('securityPoolDeploymentsRange', 'not a deployment list')
	await act(() => invalidateAppData())
	const retry = () => [...(list(view.container)?.querySelectorAll('button') ?? [])].find(button => button.textContent === 'Retry' || button.textContent === 'Retrying…')
	await waitFor(() => expect(retry()?.textContent).toBe('Retry'))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(1))
	// While the retry runs, its button stays in place, disabled and labelled as running, and the rows stay.
	const pending = createDeferred<unknown>()
	source.setRead('securityPoolDeploymentsRange', pending.promise)
	const button = retry()
	await act(() => button?.click())
	expect(button?.isConnected).toBe(true)
	expect(button?.textContent).toBe('Retrying…')
	expect(button?.disabled).toBe(true)
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(1))
	await act(() => pending.resolve(deployments(0n)))
	await waitFor(() => expect(retry() === undefined).toBe(true))
	expect(list(view.container)?.querySelector('li')?.textContent).toContain(copy.formatRegisteredQuestions(1))
})

test('an empty registry says so and lists nothing', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	capitalClient().install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noPortfoliosWithQuestions))
	expect(list(view.container)?.querySelector('.empty-state')?.textContent).toBe(copy.noPortfoliosWithQuestions + copy.noPortfoliosWithQuestionsHint)
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a portfolio with no wallet or owner says so under the owner field', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	const visitor = { ...parameters, accountAddress: undefined }
	const view = await renderIntoDocument(<PortfoliosSection parameters={visitor} walletConnected={false} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	const ownerField = () => [...view.container.querySelectorAll('.field')].find(field => field.querySelector('label')?.textContent === copy.owner)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	expect(ownerField()?.textContent).toContain(copy.ownerHint)
	const open = list(view.container)?.querySelector('li button')
	if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
	await act(() => open.click())
	// The message replaces the owner hint rather than adding a line above the list.
	await waitFor(() => expect(ownerField()?.textContent).toContain(copy.ownerNeeded))
	expect(ownerField()?.textContent).not.toContain(copy.ownerHint)
	expect(ownerField()?.querySelector('[aria-live="polite"]')?.textContent).toContain(copy.ownerNeeded)
	// The setup stage is unknown without an owner, so it is not shown as zero.
	expect(view.container.textContent).toContain(capitalCopy.prepareProgressUnknown)
	expect(view.container.textContent).not.toContain(capitalCopy.prepareProgress(0))
	// While the page cannot read the chain yet, a wallet may still be starting up, so nothing is said.
	await act(() => render(<PortfoliosSection parameters={visitor} walletConnected={false} enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(view.container.textContent).not.toContain(copy.ownerNeeded)
})

test('a portfolio registered only in another universe is not listed here', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source, 42n)
	source.install()
	const view = await renderSection()
	await waitFor(() => expect(list(view.container)?.textContent).toContain(copy.noPortfoliosWithQuestions))
	expect(list(view.container)?.querySelectorAll('li').length).toBe(0)
})

test('opening a listed portfolio opens it in the universe the list is for', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.install()
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
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	const view = await renderSection()
	const ownerField = () => [...view.container.querySelectorAll('.field')].find(field => field.querySelector('label')?.textContent === copy.owner)
	await waitFor(() => expect(view.container.textContent).toContain(capitalCopy.prepareProgress(4)))
	await act(() => {
		const input = ownerField()?.querySelector('input')
		if (input === undefined || input === null) throw new Error('Missing owner field')
		input.value = ''
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	await waitFor(() => expect(ownerField()?.textContent).toContain(copy.ownerAddressNeeded))
	expect(ownerField()?.textContent).not.toContain(copy.ownerNeeded)
})

test('a wallet on another network is asked only for an owner address', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	const source = capitalClient()
	registerQuestion(source)
	source.install()
	// Off the app's network the scoped account is unset, though a wallet is connected.
	const view = await renderIntoDocument(<PortfoliosSection parameters={{ ...parameters, accountAddress: undefined }} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	const ownerField = () => [...view.container.querySelectorAll('.field')].find(field => field.querySelector('label')?.textContent === copy.owner)
	await waitFor(() => expect(list(view.container)?.querySelector('li button')).toBeTruthy())
	await act(() => {
		const open = list(view.container)?.querySelector('li button')
		if (!(open instanceof HTMLButtonElement)) throw new Error('Missing open button')
		open.click()
	})
	await waitFor(() => expect(ownerField()?.textContent).toContain(copy.ownerAddressNeeded))
	expect(ownerField()?.textContent).not.toContain(copy.ownerNeeded)
})
