/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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
})
