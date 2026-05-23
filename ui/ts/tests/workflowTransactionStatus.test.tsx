/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { render } from 'preact'
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
					rows: [{ label: 'Action', value: 'queueWithdrawRep' }],
					title: 'Latest Vault Action',
				}}
				outcome={{ detail: 'Queued successfully', title: 'Vault Action Queued' }}
			/>,
			container as HTMLDivElement,
		)

		const statusStack = (container as HTMLDivElement).querySelector('.workflow-transaction-status')
		if (!(statusStack instanceof HTMLElement)) throw new Error('Expected status stack to render')
		expect(statusStack.children).toHaveLength(2)
		expect(statusStack.children[0]?.textContent?.includes('Vault Action Queued')).toBe(true)
		expect(statusStack.children[1]?.textContent?.includes('Latest Vault Action')).toBe(true)
	})
})
