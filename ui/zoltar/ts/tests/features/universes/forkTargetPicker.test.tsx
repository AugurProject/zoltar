import { describe, expect, mock, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { ForkTargetPicker, type ForkTargetOption } from '@zoltar/ui-zoltar-shared/features/universes/components/ForkTargetPicker.js'

const MIGRATED = 'Already migrated to this child universe.'
const ready = { label: 'Child security pool ready', tone: 'ok' } as const
const yes: ForkTargetOption = { label: 'Yes', outcomeIndex: 1n, status: ready }
const migratedNo: ForkTargetOption = { disabledReason: MIGRATED, label: 'No', outcomeIndex: 2n, status: ready }

let cleanup: (() => Promise<void>) | undefined
installDomTestLifecycle({
	afterTest: async () => {
		await cleanup?.()
		cleanup = undefined
	},
})

function describedText(element: HTMLElement) {
	return (element.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.map(id => document.getElementById(id)?.textContent ?? '')
		.join(' ')
}

describe('ForkTargetPicker', () => {
	test('keeps an unavailable categorical target visible but disabled with its reason shown and announced', async () => {
		const onToggle = mock((_outcomeIndex: bigint) => undefined)
		cleanup = (await renderIntoDocument(<ForkTargetPicker disabled={false} onToggle={onToggle} question={{ kind: 'categorical', targets: [yes, migratedNo] }} selectedOutcomeIndexes={[]} />)).cleanup

		const page = within(document.body)
		const blocked = page.getByRole('button', { name: /^No/ })
		expect(blocked.hasAttribute('disabled')).toBe(true)
		expect(describedText(blocked)).toBe(MIGRATED)
		expect(page.getByText(MIGRATED)).not.toBeNull()
		fireEvent.click(blocked)
		fireEvent.click(page.getByRole('button', { name: /^Yes/ }))
		expect(onToggle.mock.calls).toEqual([[1n]])
	})

	test('lets a selected target with a reason be removed so a stale selection never sticks', async () => {
		const onToggle = mock((_outcomeIndex: bigint) => undefined)
		cleanup = (await renderIntoDocument(<ForkTargetPicker disabled={false} onToggle={onToggle} question={{ kind: 'categorical', targets: [migratedNo] }} selectedOutcomeIndexes={[2n]} />)).cleanup

		const selected = within(document.body).getByRole('button', { name: /^No/ })
		expect(selected.hasAttribute('disabled')).toBe(false)
		fireEvent.click(selected)
		expect(onToggle.mock.calls).toEqual([[2n]])
	})

	test('disables an unavailable scalar shortcut and states its reason as text', async () => {
		const onToggle = mock((_outcomeIndex: bigint) => undefined)
		const scalarTarget: ForkTargetOption = { disabledReason: MIGRATED, label: '5 USD', outcomeIndex: 6n, status: ready }
		cleanup = (
			await renderIntoDocument(
				<ForkTargetPicker
					disabled={false}
					onToggle={onToggle}
					question={{ kind: 'scalar', deployedTargets: [scalarTarget], details: { answerUnit: 'USD', displayValueMax: 10n * 10n ** 18n, displayValueMin: 0n, numTicks: 10n }, resolveTarget: outcomeIndex => (outcomeIndex === 6n ? scalarTarget : { label: 'Other', outcomeIndex, status: ready }) }}
					selectedOutcomeIndexes={[]}
				/>,
			)
		).cleanup

		const shortcut = within(document.body).getByRole('button', { name: '5 USD' })
		expect(shortcut.hasAttribute('disabled')).toBe(true)
		expect(describedText(shortcut)).toBe(`5 USD: ${MIGRATED}`)
		fireEvent.click(shortcut)
		expect(onToggle).not.toHaveBeenCalled()
	})
})
