import { describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { getScalarOutcomeIndex } from '@zoltar/zoltar-shared/questions/scalarOutcome'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { ForkMigrationTargets, MigratedShareLinks, type ForkMigrationContext, type ForkTarget } from '../../features/ForkMigrationTargets.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

let cleanup: (() => Promise<void>) | undefined

installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
	url: 'http://localhost/?demo=1&scenario=forked-scalar#/market',
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

const noMigratedShares = { invalid: 0n, yes: 0n, no: 0n }

function Harness({ context, sourceBalance = 10n }: { context: ForkMigrationContext; sourceBalance?: bigint }) {
	const [selectedTargets, setSelectedTargets] = useState<readonly ForkTarget[]>([])
	return <ForkMigrationTargets context={context} selectedTargets={selectedTargets} sourceOutcome='YES' sourceBalance={sourceBalance} disabled={false} onChange={setSelectedTargets} />
}

function inputByLabel(container: HTMLElement, labelText: string) {
	const directlyLabelled = Array.from(container.querySelectorAll('input')).find(candidate => candidate.getAttribute('aria-label') === labelText)
	if (directlyLabelled instanceof HTMLInputElement) return directlyLabelled
	const indirectlyLabelled = Array.from(container.querySelectorAll('input')).find(
		candidate =>
			candidate
				.getAttribute('aria-labelledby')
				?.split(' ')
				.some(id => container.querySelector(`#${id}`)?.textContent === labelText) === true,
	)
	if (indirectlyLabelled instanceof HTMLInputElement) return indirectlyLabelled
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
	test('adds many arbitrary scalar outcomes and the invalid branch without raw packed input', async () => {
		const context = scalarContext()
		const rendered = await renderIntoDocument(<Harness context={context} />)
		cleanup = rendered.cleanup
		const tickInput = inputByLabel(rendered.container, 'Select scalar target')

		for (const tick of ['0', '25', '50', '75', '1 00']) {
			await input(tickInput, tick)
			await click(buttonByText(rendered.container, 'Add target'))
		}
		await click(inputByLabel(rendered.container, 'Invalid'))
		await click(buttonByText(rendered.container, 'Add target'))

		expect(rendered.container.querySelectorAll('.fork-target-selection button')).toHaveLength(6)
		expect(rendered.container.textContent).toContain('Invalid')
		expect(rendered.container.textContent).toContain('-50 °C')
		expect(rendered.container.textContent).toContain('50 °C')
		expect(rendered.container.textContent).not.toContain(getScalarOutcomeIndex(context, 50n).toString())
		expect(Array.from(rendered.container.querySelectorAll('.fork-target-selection .migration-outcome-label')).map(target => target.textContent)).toEqual(['-50 °C', '-25 °C', '0 °C', '25 °C', '50 °C', 'Invalid'])
	})

	test('rejects a human value beyond the range without selecting another outcome', async () => {
		const rendered = await renderIntoDocument(<Harness context={{ ...scalarContext(), numTicks: BigInt(Number.MAX_SAFE_INTEGER) + 1n }} />)
		cleanup = rendered.cleanup
		const valueInput = inputByLabel(rendered.container, 'Scalar value')
		await input(valueInput, '51')
		expect(valueInput.value).toBe('51')
		expect(buttonByText(rendered.container, 'Add target').disabled).toBeTrue()
		await act(() => valueInput.dispatchEvent(new Event('blur', { bubbles: true })))
		expect(rendered.container.textContent).toContain('Enter a value between the minimum and maximum that falls on an increment.')
		expect(valueInput.value).toBe('51')
		expect(buttonByText(rendered.container, 'Add target').disabled).toBeTrue()
		await input(valueInput, '50')
		expect(buttonByText(rendered.container, 'Add target').disabled).toBeFalse()
	})

	test('exposes selected child shortcuts without redundant candidate status copy', async () => {
		const context = scalarContext()
		const readyTarget: ForkTarget = { outcomeIndex: getScalarOutcomeIndex(context, 25n), universeId: 11n, label: '-25 °C', canonicalPool: `0x${'11'.repeat(20)}`, migrated: noMigratedShares }
		const rendered = await renderIntoDocument(<ForkMigrationTargets context={{ ...context, availableTargets: [readyTarget] }} selectedTargets={[readyTarget]} sourceOutcome='YES' sourceBalance={10n} disabled={false} onChange={() => undefined} />)
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).not.toContain('Branch to add')
		expect(rendered.container.textContent).not.toContain('Selected branch')
		const shortcut = buttonByText(rendered.container, '-25 °C')
		expect(shortcut.getAttribute('aria-pressed')).toBe('true')
	})

	test('describes an undeployed target as missing without promising an invalid batch will create it', async () => {
		const context = scalarContext()
		const missingTarget: ForkTarget = { outcomeIndex: getScalarOutcomeIndex(context, 25n), universeId: 11n, label: '-25 °C', canonicalPool: undefined, migrated: noMigratedShares }
		const rendered = await renderIntoDocument(<ForkMigrationTargets context={context} selectedTargets={[missingTarget]} sourceOutcome='YES' sourceBalance={10n} disabled={false} onChange={() => undefined} />)
		cleanup = rendered.cleanup

		expect(rendered.container.textContent).toContain('Child security pool missing')
		expect(rendered.container.textContent).not.toContain('will be created')
		// A list that only holds selected targets does not repeat a Selected badge on every row.
		expect(Array.from(rendered.container.querySelectorAll('.fork-target-selection .badge'), badge => badge.textContent)).toEqual(['Child security pool missing'])
	})

	test('selects labeled categorical targets independently from source INVALID, YES, and NO shares', async () => {
		const targets: readonly ForkTarget[] = [
			{ outcomeIndex: 0n, universeId: 10n, label: 'Invalid', canonicalPool: undefined, migrated: noMigratedShares },
			{ outcomeIndex: 1n, universeId: 11n, label: 'Red', canonicalPool: `0x${'11'.repeat(20)}`, migrated: noMigratedShares },
			{ outcomeIndex: 2n, universeId: 12n, label: 'Blue', canonicalPool: `0x${'22'.repeat(20)}`, migrated: noMigratedShares },
		]
		const context: ForkMigrationContext = { kind: 'categorical', parentUniverseId: 7n, questionId: 88n, title: 'Unrelated category fork', availableTargets: targets }
		const rendered = await renderIntoDocument(<Harness context={context} />)
		cleanup = rendered.cleanup

		expect(rendered.container.querySelector('.migration-outcome-list')).not.toBeNull()

		await click(buttonByText(rendered.container, 'Red'))
		await click(buttonByText(rendered.container, 'Blue'))

		expect(buttonByText(rendered.container, 'Red').getAttribute('aria-pressed')).toBe('true')
		expect(buttonByText(rendered.container, 'Blue').getAttribute('aria-pressed')).toBe('true')
		expect(rendered.container.textContent).toContain('2 targets selected')
	})

	test('marks a child universe that already holds the share as migrated and links to its pool in that universe', async () => {
		const childPool = `0x${'11'.repeat(20)}` as const
		const targets: readonly ForkTarget[] = [
			{ outcomeIndex: 1n, universeId: 11n, label: 'Red', canonicalPool: childPool, migrated: { invalid: 0n, yes: 10n, no: 0n } },
			{ outcomeIndex: 2n, universeId: 12n, label: 'Blue', canonicalPool: `0x${'22'.repeat(20)}`, migrated: noMigratedShares },
		]
		const context: ForkMigrationContext = { kind: 'categorical', parentUniverseId: 7n, questionId: 88n, title: 'Unrelated category fork', availableTargets: targets }
		const rendered = await renderIntoDocument(
			<>
				<Harness context={context} />
				<MigratedShareLinks context={context} />
			</>,
		)
		cleanup = rendered.cleanup

		const redButton = buttonByText(rendered.container, 'Red')
		const redRow = redButton.closest('.migration-outcome-row')
		expect(redRow?.textContent).toContain('Migrated')
		expect(redButton.disabled).toBe(true)
		expect(redRow?.textContent).toContain('This share is already migrated to this child universe.')
		const blueButton = buttonByText(rendered.container, 'Blue')
		expect(blueButton.disabled).toBe(false)
		expect(blueButton.closest('.migration-outcome-row')?.textContent).toContain('Child security pool ready')
		const link = Array.from(rendered.container.querySelectorAll('.fork-migrated-list a')).find(anchor => anchor.textContent === 'Open in Red universe')
		if (link === undefined) throw new Error('Missing child universe link')
		expect(link.getAttribute('href')).toContain(`#/market/${childPool}`)
		expect(link.getAttribute('href')).toContain('universe=11')
		expect(rendered.container.querySelector('.fork-migrated-list')?.textContent).toContain('Red universe')
		expect(rendered.container.querySelector('.fork-migrated-list')?.textContent).not.toContain('Blue universe')
	})

	test('treats a balance that grew after migrating as not yet migrated there', async () => {
		const targets: readonly ForkTarget[] = [{ outcomeIndex: 1n, universeId: 11n, label: 'Red', canonicalPool: `0x${'11'.repeat(20)}`, migrated: { invalid: 0n, yes: 10n, no: 0n } }]
		const context: ForkMigrationContext = { kind: 'categorical', parentUniverseId: 7n, questionId: 88n, title: 'Unrelated category fork', availableTargets: targets }
		const rendered = await renderIntoDocument(<Harness context={context} sourceBalance={15n} />)
		cleanup = rendered.cleanup
		expect(buttonByText(rendered.container, 'Red').closest('.migration-outcome-row')?.textContent).not.toContain('Migrated')
	})

	test('uses the shared scalar outcome picker while keeping fork target conversion local', async () => {
		const rendered = await renderIntoDocument(<Harness context={scalarContext()} />)
		cleanup = rendered.cleanup

		expect(rendered.container.querySelector('.market-scalar-deploy')).not.toBeNull()
		expect(inputByLabel(rendered.container, 'Select scalar target').getAttribute('type')).toBe('range')
	})
})
