/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { useState } from 'preact/hooks'
import { zeroAddress } from 'viem'
import { EscalationDepositSelectionList } from '../components/EscalationDepositSelectionList.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('EscalationDepositSelectionList', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('toggles selection when checkboxes are clicked', async () => {
		const deposits = [
			{
				deposit: {
					amount: 10n,
					cumulativeAmount: 10n,
					depositIndex: 7n,
					depositor: zeroAddress,
				},
				details: ['First deposit'],
			},
			{
				deposit: {
					amount: 20n,
					cumulativeAmount: 30n,
					depositIndex: 8n,
					depositor: zeroAddress,
				},
				details: ['Second deposit'],
			},
		]

		function SelectionHarness() {
			const [selectedIndexes, setSelectedIndexes] = useState<bigint[]>([])
			return <EscalationDepositSelectionList disabled={false} items={deposits} onSelectionChange={setSelectedIndexes} selectedDepositIndexes={selectedIndexes} />
		}

		const rendered = await renderIntoDocument(<SelectionHarness />)
		cleanupRendered = rendered.cleanup

		const checkboxes = document.querySelectorAll('input[type="checkbox"]')
		const firstCheckbox = checkboxes.item(0) as HTMLInputElement
		const secondCheckbox = checkboxes.item(1) as HTMLInputElement
		expect(firstCheckbox.checked).toBe(false)
		expect(secondCheckbox.checked).toBe(false)
		expect(document.body.textContent).toMatch('Deposit #7')
		expect(document.body.textContent).toMatch('Deposit #8')

		await act(() => {
			fireEvent.click(firstCheckbox)
		})
		expect(firstCheckbox.checked).toBe(true)

		await act(() => {
			fireEvent.click(secondCheckbox)
		})
		expect(firstCheckbox.checked).toBe(true)
		expect(secondCheckbox.checked).toBe(true)

		await act(() => {
			fireEvent.click(firstCheckbox)
		})
		expect(firstCheckbox.checked).toBe(false)
		expect(secondCheckbox.checked).toBe(true)
	})

	test('keeps selection stable when disabled', async () => {
		const deposits = [
			{
				deposit: {
					amount: 10n,
					cumulativeAmount: 10n,
					depositIndex: 8n,
					depositor: zeroAddress,
				},
				details: ['Only deposit'],
			},
		]

		function SelectionHarness() {
			const [selectedIndexes, setSelectedIndexes] = useState<bigint[]>([8n])
			return <EscalationDepositSelectionList disabled={true} items={deposits} onSelectionChange={setSelectedIndexes} selectedDepositIndexes={selectedIndexes} />
		}

		const rendered = await renderIntoDocument(<SelectionHarness />)
		cleanupRendered = rendered.cleanup

		const checkbox = document.querySelector('input[type="checkbox"]') as HTMLInputElement
		expect(checkbox.checked).toBe(true)
		expect(checkbox.disabled).toBe(true)

		await act(() => {
			fireEvent.click(checkbox)
		})
	})

	test('paginates deposits and keeps selections across pages', async () => {
		const deposits = Array.from({ length: 27 }, (_, index) => {
			const depositIndex = 250n + BigInt(index)
			return {
				deposit: {
					amount: depositIndex,
					cumulativeAmount: depositIndex,
					depositIndex,
					depositor: zeroAddress,
				},
				details: [`Deposit ${depositIndex.toString()}`],
			}
		})

		function SelectionHarness() {
			const [selectedIndexes, setSelectedIndexes] = useState<bigint[]>([])
			return <EscalationDepositSelectionList disabled={false} items={deposits} onSelectionChange={setSelectedIndexes} selectedDepositIndexes={selectedIndexes} />
		}

		const rendered = await renderIntoDocument(<SelectionHarness />)
		cleanupRendered = rendered.cleanup

		expect(document.body.textContent).toMatch('Deposit #256')
		expect(document.body.textContent).toMatch('Showing deposits 1-25 of 27. Page 1 of 2')
		expect(document.body.textContent).not.toMatch('Deposit #276')

		const firstPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const deposit256Checkbox = firstPageCheckboxes.item(6) as HTMLInputElement
		await act(() => {
			fireEvent.click(deposit256Checkbox)
		})
		expect(deposit256Checkbox.checked).toBe(true)

		const nextButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Next Deposits')
		if (nextButton === undefined) throw new Error('Next Deposits button missing')
		await act(() => {
			fireEvent.click(nextButton)
		})

		expect(document.body.textContent).toMatch('Deposit #276')
		expect(document.body.textContent).toMatch('Showing deposits 26-27 of 27. Page 2 of 2')
		expect(document.body.textContent).not.toMatch('Deposit #256')

		const secondPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const deposit276Checkbox = secondPageCheckboxes.item(1) as HTMLInputElement
		await act(() => {
			fireEvent.click(deposit276Checkbox)
		})
		expect(deposit276Checkbox.checked).toBe(true)

		const previousButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Previous Deposits')
		if (previousButton === undefined) throw new Error('Previous Deposits button missing')
		await act(() => {
			fireEvent.click(previousButton)
		})

		const refreshedFirstPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const refreshedDeposit256Checkbox = refreshedFirstPageCheckboxes.item(6) as HTMLInputElement
		expect(refreshedDeposit256Checkbox.checked).toBe(true)
	})
})
