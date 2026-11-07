import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { PortfoliosSection } from '@zoltar/ui-statoblast-shared/features/portfolios/components/PortfoliosSection.js'
import * as copy from '@zoltar/ui-statoblast-shared/copy/portfolioCapital.js'
import { capitalSnapshot, owner, portfolio } from './capitalFixture.js'
import { capitalClient } from './capitalClient.js'

const lifecycle = installDomTestLifecycle({ url: `https://example.test/#/portfolios?portfolio=${portfolio}&owner=${owner}`, afterTest: resetActiveEnvironmentForTesting })
const parameters = { accountAddress: owner, onTransactionRequested: () => undefined, onTransactionSubmitted: () => undefined, onTransactionFinished: () => undefined, onTransactionPresented: () => undefined, refreshState: async () => undefined }

test('completed setup preserves the four transaction controls in their original order with completion reasons', async () => {
	const source = capitalClient()
	source.setSetupStage(2n)
	source.install()
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain(copy.prepareProgress(2)))
	const setup = [...view.container.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === copy.prepareTitle)
	if (setup === undefined) throw new Error('Setup section missing')
	const buttons = [...setup.querySelectorAll('button')]
	expect(buttons.map(button => button.textContent)).toEqual(copy.prepareStages)
	expect(buttons.map(button => button.disabled)).toEqual([true, true, false, true])

	source.setSetupStage(4n)
	await act(() => render(<PortfoliosSection parameters={parameters} enabled environmentKey={1} activeUniverseId={0n} />, view.container))
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
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain(copy.position(1n)))
	const position = [...view.container.querySelectorAll('.workflow-subsection')].find(section => section.querySelector('h4')?.textContent === copy.position(1n))
	if (position === undefined) throw new Error('Position section missing')
	const inputs = [...position.querySelectorAll('input')]
	const buttons = [...position.querySelectorAll('button')]
	expect(inputs).toHaveLength(1)
	expect(buttons).toHaveLength(2)
	await act(() => render(<PortfoliosSection parameters={parameters} enabled={false} environmentKey={0} activeUniverseId={0n} />, view.container))
	expect(position.isConnected).toBe(true)
	expect([...position.querySelectorAll('input')]).toEqual(inputs)
	expect([...position.querySelectorAll('button')]).toEqual(buttons)
	expect(buttons.every(button => button.disabled)).toBe(true)
	expect(position.textContent).toContain(copy.readUnavailable)
	expect(view.container.textContent).toContain(copy.lastConfirmed)
	expect(inputs.every(input => input.disabled)).toBe(true)
	await act(() => render(<PortfoliosSection parameters={parameters} enabled environmentKey={0} activeUniverseId={0n} />, view.container))
	await waitFor(() => expect(buttons.some(button => !button.disabled)).toBe(true))
	expect(position.isConnected).toBe(true)
})

test('a pending retirement shows its locked request without an editable form', async () => {
	const snapshot = capitalSnapshot()
	const source = capitalClient({ ...snapshot, positions: snapshot.positions.map(position => ({ ...position, batch: 1n, remainingCommitment: 0n })) })
	source.install()
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
	await waitFor(() => expect(view.container.textContent).toContain(copy.queuedRemainingCommitment))
	const position = [...view.container.querySelectorAll('.workflow-subsection')].find(section => section.querySelector('h4')?.textContent === copy.position(1n))
	if (position === undefined) throw new Error('Position section missing')
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
	const view = await renderIntoDocument(<PortfoliosSection parameters={parameters} enabled environmentKey={0} activeUniverseId={0n} />)
	lifecycle.trackRendered(view)
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
