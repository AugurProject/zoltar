import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { PortfoliosSection } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfoliosSection.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import * as priceCopy from '@zoltar/ui-statoblast-shared/copy/portfolioPrice.js'
import { capitalSnapshot, owner, portfolio } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'
import { priceFeed, priceFixture } from './priceFixture.js'

const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${portfolio}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

const renderPortfolios = async () => {
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	return view
}
const sectionTitled = (container: Element, title: string) => [...container.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === title)
const universePriceReport = (backing: Element | undefined) => [...(backing?.querySelectorAll('details') ?? [])].find(details => details.querySelector('summary')?.textContent === priceCopy.scopes.universe.title)
const firstPosition = (container: Element) => {
	const position = [...container.querySelectorAll('.workflow-subsection')].find(section => section.querySelector('h4')?.textContent === copy.position(1n))
	if (position === undefined) throw new Error('Position section missing')
	return position
}

test('completed setup preserves the four transaction controls in their original order with completion reasons', async () => {
	const source = capitalClient()
	source.setSetupStage(2n)
	source.install()
	const view = await renderPortfolios()
	await waitFor(() => expect(view.container.textContent).toContain(copy.prepareProgress(2)))
	const setup = sectionTitled(view.container, copy.prepareTitle)
	if (setup === undefined) throw new Error('Setup section missing')
	const buttons = [...setup.querySelectorAll('button')]
	expect(buttons.map(button => button.textContent)).toEqual(copy.prepareStages)
	expect(buttons.map(button => button.disabled)).toEqual([true, true, false, true])

	source.setSetupStage(4n)
	await act(() => render(<PortfoliosSection parameters={parameters} walletConnected enabled environmentKey={1} activeUniverseId={0n} />, view.container))
	await waitFor(() => expect(view.container.textContent).toContain(copy.prepareProgress(4)))
	expect(setup.textContent).not.toContain(copy.prepareHint)
	expect(setup.isConnected).toBe(true)
	expect([...setup.querySelectorAll('button')]).toEqual(buttons)
	expect(buttons.map(button => button.disabled)).toEqual([true, true, true, true])
	expect(setup.textContent?.match(/This setup stage is complete\./g)).toHaveLength(4)
	expect(view.container.textContent?.split(copy.prepareProgress(4))).toHaveLength(2)
	expect(view.container.textContent?.split(copy.description)).toHaveLength(2)
	expect(view.container.textContent).not.toContain('Auction reserve')
	expect(view.container.textContent).not.toContain('Execution reserve')
	expect(view.container.textContent).toContain(copy.minimumCommitmentHint)
})

test('authenticated refresh preserves position controls while disabling transactions until fresh data resolves', async () => {
	const source = capitalClient()
	source.install()
	const view = await renderPortfolios()
	await waitFor(() => expect(view.container.textContent).toContain(copy.position(1n)))
	const position = firstPosition(view.container)
	const inputs = [...position.querySelectorAll('input')]
	const buttons = [...position.querySelectorAll('button')]
	expect(inputs).toHaveLength(1)
	expect(buttons).toHaveLength(2)
	await act(() => render(<PortfoliosSection parameters={parameters} walletConnected enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(position.isConnected).toBe(true)
	expect([...position.querySelectorAll('input')]).toEqual(inputs)
	expect([...position.querySelectorAll('button')]).toEqual(buttons)
	expect(buttons.every(button => button.disabled)).toBe(true)
	expect(position.textContent).toContain(copy.readUnavailable)
	expect(view.container.textContent).toContain(copy.lastConfirmed)
	expect(inputs.every(input => input.disabled)).toBe(true)
	await act(() => render(<PortfoliosSection parameters={parameters} walletConnected enabled environmentKey={0} activeUniverseId={0n} />, view.container))
	await waitFor(() => expect(buttons.some(button => !button.disabled)).toBe(true))
	expect(position.isConnected).toBe(true)
})

test('a pending retirement shows its locked request without an editable form', async () => {
	const snapshot = capitalSnapshot()
	const source = capitalClient({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 0n })) })
	source.install()
	const view = await renderPortfolios()
	await waitFor(() => expect(view.container.textContent).toContain(copy.queuedRemainingCommitment))
	const position = firstPosition(view.container)
	expect(position.querySelectorAll('input')).toHaveLength(0)
	expect([...position.querySelectorAll('button')].map(button => button.textContent?.trim())).not.toContain(copy.retire)
	expect(position.textContent).not.toContain(copy.remainingCommitment)
})

test('purchase selection uses question text with a full copyable identifier and optional ID lookup', async () => {
	const questionId = BigInt(`0x${'ab'.repeat(32)}`)
	const source = capitalClient(capitalSnapshot({ questions: [questionId] }))
	source.setRead('getQuestions', [questionId])
	source.setRead('questions', ['Will the official result be Yes?', 'Resolve using the published final result.', 0n, 10000n, 0n, 0n, 0n, ''])
	source.setRead('questionCreatedTimestamp', 1n)
	source.setRead('getOutcomeLabels', ['No', 'Yes'])
	source.install()
	const view = await renderPortfolios()
	await waitFor(() => expect([...view.container.querySelectorAll('option')].some(option => option.textContent === 'Will the official result be Yes?')).toBe(true))
	const option = [...view.container.querySelectorAll('option')].find(option => option.textContent === 'Will the official result be Yes?')
	const select = option?.closest('select')
	if (select === null || select === undefined || option === undefined) throw new Error('Missing question selector')
	await act(() => {
		select.value = option.value
		select.dispatchEvent(new Event('change', { bubbles: true }))
	})
	await waitFor(() => expect(view.container.textContent).toContain('Resolve using the published final result.'))
	const identifier = view.container.querySelector('.question-summary .identifier-value')
	expect(identifier?.textContent).toContain(`0x${'ab'.repeat(32)}`)
	expect(identifier?.textContent).not.toContain('…')
	const lookup = [...view.container.querySelectorAll('details')].find(details => details.querySelector('summary')?.textContent === 'Find by question ID')
	expect(lookup?.open).toBe(false)
	expect(lookup?.querySelector('input')?.value).toBe(`0x${'ab'.repeat(32)}`)
})

test('a forked origin is announced on its field and stated once beside the deploy actions', async () => {
	const source = capitalClient()
	source.setRead('getForkTime', 1n)
	source.install()
	const view = await renderPortfolios()
	const form = view.container.querySelector('.portfolio-creation-form')
	await waitFor(() => expect(form?.textContent).toContain('This universe has forked.'))
	expect(form?.textContent?.split('This universe has forked.')).toHaveLength(2)
	const originField = Array.from(form?.querySelectorAll('.field') ?? []).find(field => field.querySelector('label')?.textContent === 'Origin universe ID')
	expect(originField?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
	expect(originField?.querySelector('[aria-live="polite"]')?.textContent).toContain('This universe has forked.')
	const reasons = form?.querySelectorAll('.shared-action-reason')
	expect(reasons).toHaveLength(1)
	const reason = reasons?.item(0)
	expect(reason?.textContent).toBe('The origin universe has forked.')
	const reasonId = reason?.firstElementChild?.id
	const buttons = ['Deploy admission policy', 'Deploy portfolio'].map(name => Array.from(form?.querySelectorAll('button') ?? []).find(candidate => candidate.textContent === name))
	for (const button of buttons) {
		expect(button?.disabled).toBe(true)
		expect(button?.getAttribute('aria-describedby')).toBe(reasonId ?? null)
	}
	const deployButton = buttons[1]
	if (deployButton === undefined || reason === null || reason === undefined) throw new Error('Missing deploy action')
	expect(deployButton.compareDocumentPosition(reason) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('an unforked portfolio with an expired price can fund a new report from its shared backing', async () => {
	// The fork panel prices only fork branches, so the unforked universe needs its own request path.
	const fixture = priceFixture(capitalSnapshot({ priceValid: false, priceValidUntil: 900n }))
	fixture.set(priceFeed, 'universeId', 0n)
	const view = await renderPortfolios()
	const backing = () => sectionTitled(view.container, copy.poolTitle)
	await waitFor(() => expect(backing()?.textContent).toContain(copy.priceStale))
	const report = universePriceReport(backing())
	if (report === undefined) throw new Error('Shared backing has no price report')
	expect(report.open).toBe(true)
	// The summary is the report's only label.
	expect(report.querySelector('h4') === null).toBe(true)
	await waitFor(() => expect(report.textContent).toContain('Wallet WETH'))
	const input = [...report.querySelectorAll('input')].find(candidate => candidate.closest('.field')?.querySelector('label')?.textContent?.includes(priceCopy.price))
	if (input === undefined) throw new Error('Missing proposed price input')
	await act(() => {
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	const button = (label: string) => [...report.querySelectorAll('button')].find(candidate => candidate.textContent === label)
	await waitFor(() => expect(button(priceCopy.wrap)?.disabled).toBe(false))
	expect(button(priceCopy.scopes.universe.request)?.disabled).toBe(true)
	expect(report.textContent).toContain(priceCopy.insufficientWeth)
})

test('shared backing has no price report until a portfolio account is shown', async () => {
	window.localStorage.clear()
	window.history.replaceState(undefined, '', '/#/portfolios')
	capitalClient().install()
	const view = await renderPortfolios()
	const backing = () => sectionTitled(view.container, copy.poolTitle)
	await waitFor(() => expect(backing()?.textContent).toContain(copy.priceExpiry))
	// Assert on text: with no account there is nothing to price, and an empty report would only show endless loading.
	expect(backing()?.textContent).not.toContain(priceCopy.scopes.universe.title)
	expect(view.container.textContent).not.toContain(priceCopy.scopes.universe.request)
})

test('a current price keeps the price request folded under its summary', async () => {
	const source = capitalClient()
	source.install()
	const view = await renderPortfolios()
	const backing = () => sectionTitled(view.container, copy.poolTitle)
	await waitFor(() => expect(backing()?.textContent).toContain(copy.priceValid))
	const disclosure = backing()?.querySelector('details')
	expect(disclosure?.querySelector('summary')?.textContent).toBe(priceCopy.scopes.universe.title)
	expect(disclosure?.open).toBe(false)
	// Folded, the report reads nothing, so it does not poll the price feed every block.
	expect(source.reads.some(read => read.name === 'isPriceReportingOpen')).toBe(false)
})

test.each([
	['a forked universe', { forkTime: 1n }, copy.forked],
	['a universe still importing its fork', { importing: true }, copy.importing],
])('an expired price stays folded in %s, where no new report can be requested', async (_state, overrides, status) => {
	const source = capitalClient(capitalSnapshot({ priceValid: false, ...overrides }))
	source.install()
	const view = await renderPortfolios()
	const backing = () => sectionTitled(view.container, copy.poolTitle)
	await waitFor(() => expect(backing()?.textContent).toContain(status))
	expect(backing()?.querySelector('details')?.open).toBe(false)
})

test('the price report keeps its drafts when folded and through a failed account refresh', async () => {
	const fixture = priceFixture(capitalSnapshot({ priceValid: false, priceValidUntil: 900n }))
	fixture.set(priceFeed, 'universeId', 0n)
	const view = await renderPortfolios()
	const backing = () => sectionTitled(view.container, copy.poolTitle)
	const report = () => universePriceReport(backing())
	const priceInput = () => [...(report()?.querySelectorAll('input') ?? [])].find(candidate => candidate.closest('.field')?.querySelector('label')?.textContent?.includes(priceCopy.price))
	await waitFor(() => expect(report()?.textContent).toContain('Wallet WETH'))
	await act(() => {
		const input = priceInput()
		if (input === undefined) throw new Error('Missing proposed price input')
		input.value = '2'
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
	const toggle = async (open: boolean) => {
		await act(() => {
			const details = report()
			if (details === undefined) throw new Error('Missing price report')
			details.open = open
			details.dispatchEvent(new Event('toggle'))
		})
	}
	await toggle(false)
	await toggle(true)
	expect(priceInput()?.value).toBe('2')
	// One failed account read clears the shown account; the report and its draft must outlive it.
	fixture.source.setRead('getForkTime', 'not a time')
	await act(() => invalidateAppData())
	await waitFor(() => expect(view.container.textContent).toContain('Unable to load the portfolio account'))
	expect(priceInput()?.value).toBe('2')
	fixture.source.setRead('getForkTime', 0n)
	await act(() => invalidateAppData())
	await waitFor(() => expect(backing()?.textContent).toContain(copy.priceStale))
	expect(priceInput()?.value).toBe('2')
})
