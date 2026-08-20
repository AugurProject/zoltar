import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { getScalarOutcomeIndex } from '@zoltar/shared/scalarOutcome'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { ForkMigrationTargets, type ForkMigrationContext, type ForkTarget } from '../../features/ForkMigrationTargets.js'
import { DemoScalarForkMigration } from '../../features/MarketDetail.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

let cleanup: (() => Promise<void>) | undefined
let cleanupDom: (() => void) | undefined

beforeEach(() => {
	cleanupDom = installDomEnvironment('http://localhost/?demo=1&scenario=forked-scalar#/market').cleanup
})

afterEach(async () => {
	await cleanup?.()
	cleanup = undefined
	cleanupDom?.()
	cleanupDom = undefined
})

function scalarContext(): Extract<ForkMigrationContext, { kind: 'scalar' }> {
	return {
		kind: 'scalar',
		parentUniverseId: 7n,
		questionId: 99n,
		title: 'Unrelated scalar fork',
		numTicks: 100n,
		displayValueMin: -50n * 10n ** 18n,
		displayValueMax: 50n * 10n ** 18n,
		answerUnit: '°C',
		availableTargets: [],
	}
}

function Harness({ context }: { context: ForkMigrationContext }) {
	const [selectedTargets, setSelectedTargets] = useState<readonly ForkTarget[]>([])
	return <ForkMigrationTargets context={context} selectedTargets={selectedTargets} disabled={false} onChange={setSelectedTargets} />
}

function inputByLabel(container: HTMLElement, labelText: string) {
	const directlyLabelled = Array.from(container.querySelectorAll('input')).find(candidate => candidate.getAttribute('aria-label') === labelText)
	if (directlyLabelled instanceof HTMLInputElement) return directlyLabelled
	const label = Array.from(container.querySelectorAll('label')).find(candidate => candidate.textContent?.includes(labelText) === true)
	const input = label?.querySelector('input')
	if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input labeled ${labelText}`)
	return input
}

function buttonByText(container: HTMLElement, text: string) {
	const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(text) === true)
	if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button ${text}`)
	return button
}

async function input(input: HTMLInputElement, value: string) {
	await act(() => {
		input.value = value
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

async function click(element: HTMLElement) {
	await act(() => element.click())
}

describe('fork migration target selection', () => {
	test('keeps display-ordered scalar targets eligible for the simulated submit state', async () => {
		const rendered = await renderIntoDocument(<DemoScalarForkMigration />)
		cleanup = rendered.cleanup

		await click(buttonByText(rendered.container, 'Simulate migration to 2 branches'))

		const submit = buttonByText(rendered.container, 'Submit migration to 2 child branches')
		expect(submit.disabled).toBeFalse()
		expect(rendered.container.textContent).toContain('Authoritative migration simulation ready')
		expect(Array.from(rendered.container.querySelectorAll('.fork-target-selection strong')).map(target => target.textContent)).toEqual(['-2.5 °C', '0 °C'])
	})

	test('adds many arbitrary scalar outcomes and the invalid branch without raw packed input', async () => {
		const context = scalarContext()
		const rendered = await renderIntoDocument(<Harness context={context} />)
		cleanup = rendered.cleanup
		const tickInput = inputByLabel(rendered.container, 'Scalar fork tick')

		for (const tick of ['0', '25', '50', '75', '100']) {
			await input(tickInput, tick)
			await click(buttonByText(rendered.container, 'Add scalar target'))
		}
		await click(inputByLabel(rendered.container, 'Invalid fork outcome'))
		await click(buttonByText(rendered.container, 'Add scalar target'))

		expect(Array.from(rendered.container.querySelectorAll('button')).filter(button => button.textContent?.includes('Remove target') === true)).toHaveLength(6)
		expect(rendered.container.textContent).toContain('Invalid')
		expect(rendered.container.textContent).toContain('-50 °C')
		expect(rendered.container.textContent).toContain('50 °C')
		expect(rendered.container.textContent).not.toContain(getScalarOutcomeIndex(context, 50n).toString())
		expect(Array.from(rendered.container.querySelectorAll('.fork-target-selection strong')).map(target => target.textContent)).toEqual(['-50 °C', '-25 °C', '0 °C', '25 °C', '50 °C', 'Invalid'])
	})

	test('rejects a scalar tick beyond the fork question range instead of silently changing it', async () => {
		const rendered = await renderIntoDocument(<Harness context={{ ...scalarContext(), numTicks: BigInt(Number.MAX_SAFE_INTEGER) + 1n }} />)
		cleanup = rendered.cleanup
		await input(inputByLabel(rendered.container, 'Scalar fork tick'), (BigInt(Number.MAX_SAFE_INTEGER) + 2n).toString())

		expect(buttonByText(rendered.container, 'Add scalar target').disabled).toBeTrue()
		expect(rendered.container.textContent).toContain('Enter an exact tick')
	})

	test('distinguishes an uncommitted candidate and exposes selected child shortcuts as pressed', async () => {
		const context = scalarContext()
		const readyTarget: ForkTarget = { outcomeIndex: getScalarOutcomeIndex(context, 25n), universeId: 11n, label: '-25 °C', canonicalPool: `0x${'11'.repeat(20)}` }
		const rendered = await renderIntoDocument(<ForkMigrationTargets context={{ ...context, availableTargets: [readyTarget] }} selectedTargets={[readyTarget]} disabled={false} onChange={() => undefined} />)
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).toContain('Branch to add')
		const shortcut = buttonByText(rendered.container, '-25 °C')
		expect(shortcut.getAttribute('aria-pressed')).toBe('true')
	})

	test('describes an undeployed target as missing without promising an invalid batch will create it', async () => {
		const context = scalarContext()
		const missingTarget: ForkTarget = { outcomeIndex: getScalarOutcomeIndex(context, 25n), universeId: 11n, label: '-25 °C', canonicalPool: undefined }
		const rendered = await renderIntoDocument(<ForkMigrationTargets context={context} selectedTargets={[missingTarget]} disabled={false} onChange={() => undefined} />)
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).toContain('Child pool missing')
		expect(rendered.container.textContent).not.toContain('will be created')
	})

	test('selects labeled categorical targets independently from source INVALID, YES, and NO shares', async () => {
		const targets: readonly ForkTarget[] = [
			{ outcomeIndex: 0n, universeId: 10n, label: 'Invalid', canonicalPool: undefined },
			{ outcomeIndex: 1n, universeId: 11n, label: 'Red', canonicalPool: `0x${'11'.repeat(20)}` },
			{ outcomeIndex: 2n, universeId: 12n, label: 'Blue', canonicalPool: `0x${'22'.repeat(20)}` },
		]
		const context: ForkMigrationContext = { kind: 'categorical', parentUniverseId: 7n, questionId: 88n, title: 'Unrelated category fork', availableTargets: targets }
		const rendered = await renderIntoDocument(<Harness context={context} />)
		cleanup = rendered.cleanup

		await click(inputByLabel(rendered.container, 'Red fork branch'))
		await click(inputByLabel(rendered.container, 'Blue fork branch'))

		expect(inputByLabel(rendered.container, 'Red fork branch').checked).toBeTrue()
		expect(inputByLabel(rendered.container, 'Blue fork branch').checked).toBeTrue()
		expect(rendered.container.textContent).toContain('2 targets selected')
	})
})
