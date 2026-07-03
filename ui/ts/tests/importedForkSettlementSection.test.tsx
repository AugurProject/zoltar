/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useState } from 'preact/hooks'
import { ImportedForkSettlementSection } from '../components/ImportedForkSettlementSection.js'
import type { ReportingOutcomeKey } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ImportedForkSettlementSection', () => {
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

	test('renders imported deposits and reports selection changes', async () => {
		const selectionChanges: Array<{ checked: boolean; depositIndex: bigint; outcome: ReportingOutcomeKey }> = []
		const renderedActions: Array<{ guardMessage: string | undefined; outcome: ReportingOutcomeKey; sideLabel: string }> = []
		const rendered = await renderIntoDocument(
			<ImportedForkSettlementSection
				activeReportingDetails={undefined}
				disabled={false}
				onDepositSelectionChange={(outcome, depositIndex, checked) => {
					selectionChanges.push({ checked, depositIndex, outcome })
				}}
				renderSettlementAction={props => {
					renderedActions.push(props)
					return (
						<button disabled={props.guardMessage !== undefined} type='button'>
							Settle {props.sideLabel}
						</button>
					)
				}}
				resolved={false}
				selectedDepositIndexesByOutcome={{
					invalid: [],
					no: [],
					yes: [7n],
				}}
				sides={[
					{
						importedUserDeposits: [
							{
								amount: 10n,
								cumulativeAmount: 12n,
								depositor: '0x0000000000000000000000000000000000000001',
								parentDepositIndex: 7n,
							},
						],
						key: 'yes',
						label: 'Yes',
					},
				]}
			/>,
		)
		cleanupRendered = rendered.cleanup

		expect(within(document.body).getByRole('heading', { name: 'Settle Fork-Carried Escalation Deposits' })).not.toBeNull()
		expect(within(document.body).getByText('Parent deposit #7')).not.toBeNull()
		expect(within(document.body).getByText('Worth now: Pending final settlement')).not.toBeNull()
		expect(within(document.body).getByText(/Imported entry depth:/)).not.toBeNull()
		expect(within(document.body).queryByText(/Imported ordering start:/)).toBeNull()
		expect(renderedActions).toEqual([
			{
				guardMessage: 'Fork-carried escalation deposits can be settled after this child pool finalizes.',
				outcome: 'yes',
				sideLabel: 'Yes',
			},
		])

		const checkbox = within(document.body).getByRole('checkbox') as HTMLInputElement
		expect(checkbox.checked).toBe(true)
		fireEvent.change(checkbox, { target: { checked: false } })
		expect(selectionChanges).toEqual([{ checked: false, depositIndex: 7n, outcome: 'yes' }])
	})

	test('paginates imported deposits and keeps selections across pages', async () => {
		const importedUserDeposits = Array.from({ length: 27 }, (_, index) => {
			const parentDepositIndex = 250n + BigInt(index)
			return {
				amount: parentDepositIndex,
				cumulativeAmount: parentDepositIndex + 1n,
				depositor: '0x0000000000000000000000000000000000000001' as const,
				parentDepositIndex,
			}
		})

		function SettlementHarness() {
			const [selectedDepositIndexesByOutcome, setSelectedDepositIndexesByOutcome] = useState<Record<ReportingOutcomeKey, bigint[]>>({
				invalid: [],
				no: [],
				yes: [256n],
			})
			return (
				<ImportedForkSettlementSection
					activeReportingDetails={undefined}
					disabled={false}
					onDepositSelectionChange={(outcome, depositIndex, checked) => {
						setSelectedDepositIndexesByOutcome(current => ({
							...current,
							[outcome]: checked ? [...current[outcome], depositIndex] : current[outcome].filter(index => index !== depositIndex),
						}))
					}}
					renderSettlementAction={props => (
						<button disabled={props.guardMessage !== undefined} type='button'>
							Settle {props.sideLabel}
						</button>
					)}
					resolved={true}
					selectedDepositIndexesByOutcome={selectedDepositIndexesByOutcome}
					sides={[
						{
							importedUserDeposits,
							key: 'yes',
							label: 'Yes',
						},
					]}
				/>
			)
		}

		const rendered = await renderIntoDocument(<SettlementHarness />)
		cleanupRendered = rendered.cleanup

		expect(document.body.textContent).toMatch('Parent deposit #256')
		expect(document.body.textContent).toMatch('Showing parent deposits 1-25 of 27. Page 1 of 2')
		expect(document.body.textContent).not.toMatch('Parent deposit #276')

		const firstPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const deposit256Checkbox = firstPageCheckboxes.item(6) as HTMLInputElement
		expect(deposit256Checkbox.checked).toBe(true)

		const nextButton = within(document.body).getByRole('button', { name: 'Next Parent Deposits' })
		fireEvent.click(nextButton)

		expect(document.body.textContent).toMatch('Parent deposit #276')
		expect(document.body.textContent).toMatch('Showing parent deposits 26-27 of 27. Page 2 of 2')
		expect(document.body.textContent).not.toMatch('Parent deposit #256')

		const secondPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const deposit276Checkbox = secondPageCheckboxes.item(1) as HTMLInputElement
		fireEvent.change(deposit276Checkbox, { target: { checked: true } })
		expect(deposit276Checkbox.checked).toBe(true)

		const previousButton = within(document.body).getByRole('button', { name: 'Previous Parent Deposits' })
		fireEvent.click(previousButton)

		const refreshedFirstPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const refreshedDeposit256Checkbox = refreshedFirstPageCheckboxes.item(6) as HTMLInputElement
		expect(refreshedDeposit256Checkbox.checked).toBe(true)

		fireEvent.click(nextButton)

		const refreshedSecondPageCheckboxes = document.querySelectorAll('input[type="checkbox"]')
		const refreshedDeposit276Checkbox = refreshedSecondPageCheckboxes.item(1) as HTMLInputElement
		expect(refreshedDeposit276Checkbox.checked).toBe(true)
	})
})
