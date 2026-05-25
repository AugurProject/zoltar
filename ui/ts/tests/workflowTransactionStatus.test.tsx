/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent } from '@testing-library/dom'
import { within } from '@testing-library/dom'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { WorkflowTransactionStatus } from '../components/WorkflowTransactionStatus.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'

describe('WorkflowTransactionStatus', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let container: HTMLDivElement | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		if (container !== undefined) {
			render(null, container)
			container.remove()
			container = undefined
		}
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders nothing when no outcome or latest action is present', () => {
		render(<WorkflowTransactionStatus latestAction={undefined} outcome={undefined} />, container as HTMLDivElement)
		expect((container as HTMLDivElement).textContent).toBe('')
	})

	test('renders only the outcome banner when only an outcome is present', () => {
		render(<WorkflowTransactionStatus latestAction={undefined} outcome={{ detail: 'Outcome detail', title: 'Outcome title' }} />, container as HTMLDivElement)

		const containerQueries = within(container as HTMLDivElement)
		expect(containerQueries.getByText('Outcome title')).not.toBeNull()
		expect(containerQueries.queryByRole('heading', { name: 'Latest Action' })).toBeNull()
	})

	test('renders only the latest action when only latest action data is present', () => {
		render(
			<WorkflowTransactionStatus
				latestAction={{
					rows: [
						{ label: 'Action', value: 'approveRep' },
						{ label: 'Transaction', value: '0x1234' },
					],
					title: 'Latest Action',
				}}
				outcome={undefined}
			/>,
			container as HTMLDivElement,
		)

		const containerQueries = within(container as HTMLDivElement)
		expect(containerQueries.getByRole('heading', { name: 'Latest Action' })).not.toBeNull()
		expect(containerQueries.queryByText('Outcome detail')).toBeNull()
	})

	test('renders the outcome before the latest action when both are present', () => {
		render(
			<WorkflowTransactionStatus
				latestAction={{
					dismissKey: 'latest-vault-action',
					rows: [{ label: 'Action', value: 'queueWithdrawRep' }],
					title: 'Latest Vault Action',
				}}
				outcome={{ detail: 'Queued successfully', dismissKey: 'vault-action-queued', title: 'Vault Action Queued' }}
			/>,
			container as HTMLDivElement,
		)

		const statusStack = (container as HTMLDivElement).querySelector('.workflow-transaction-status')
		if (!(statusStack instanceof HTMLElement)) throw new Error('Expected status stack to render')
		expect(statusStack.children).toHaveLength(2)
		expect(statusStack.children[0]?.textContent?.includes('Vault Action Queued')).toBe(true)
		expect(statusStack.children[1]?.textContent?.includes('Latest Vault Action')).toBe(true)
	})

	test('dismisses the latest action and outcome independently when close buttons are clicked', async () => {
		render(
			<WorkflowTransactionStatus
				latestAction={{
					dismissKey: 'latest-action',
					rows: [{ label: 'Action', value: 'queueWithdrawRep' }],
					title: 'Latest Vault Action',
				}}
				outcome={{ detail: 'Queued successfully', dismissKey: 'queued-outcome', title: 'Vault Action Queued' }}
			/>,
			container as HTMLDivElement,
		)

		const containerQueries = within(container as HTMLDivElement)
		await act(async () => {
			fireEvent.click(containerQueries.getByRole('button', { name: 'Dismiss workflow outcome' }))
			await Promise.resolve()
		})
		const statusStackAfterOutcomeDismiss = (container as HTMLDivElement).querySelector('.workflow-transaction-status')
		if (!(statusStackAfterOutcomeDismiss instanceof HTMLElement)) throw new Error('Expected status stack to remain after dismissing the outcome')
		expect(statusStackAfterOutcomeDismiss.children).toHaveLength(1)
		expect(statusStackAfterOutcomeDismiss.textContent?.includes('Latest Vault Action')).toBe(true)

		await act(async () => {
			fireEvent.click(containerQueries.getByRole('button', { name: 'Dismiss latest action' }))
			await Promise.resolve()
		})
		expect((container as HTMLDivElement).textContent).toBe('')
	})

	test('keeps a dismissed latest action hidden after unmounting and remounting the same dismiss key', async () => {
		const latestAction = {
			dismissKey: 'workflow-status-remount-latest-action',
			rows: [{ label: 'Action', value: 'reportOutcome' }],
			title: 'Latest Reporting Action',
		}

		render(<WorkflowTransactionStatus latestAction={latestAction} outcome={undefined} />, container as HTMLDivElement)

		const containerQueries = within(container as HTMLDivElement)
		await act(async () => {
			fireEvent.click(containerQueries.getByRole('button', { name: 'Dismiss latest action' }))
			await Promise.resolve()
		})
		expect((container as HTMLDivElement).textContent).toBe('')

		render(null, container as HTMLDivElement)
		render(<WorkflowTransactionStatus latestAction={latestAction} outcome={undefined} />, container as HTMLDivElement)

		expect((container as HTMLDivElement).textContent).toBe('')
	})
})
