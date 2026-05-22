/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { TransactionActionButton } from '../components/TransactionActionButton.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionActionButton', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders inline success status with a transaction hash link', async () => {
		const renderedComponent = await renderIntoDocument(
			h(TransactionActionButton, {
				idleLabel: 'Submit',
				onClick: () => undefined,
				pendingLabel: 'Submitting...',
				status: {
					detail: 'The transaction was accepted.',
					hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					title: 'Submitted',
					tone: 'success',
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status')).not.toBeNull()
		expect(documentQueries.getByText('Submitted')).not.toBeNull()
		expect(documentQueries.getByText('The transaction was accepted.')).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: '0x1234000000000000000000000000000000000000000000000000000000000000' })).not.toBeNull()
	})

	test('renders warning feedback with status semantics', async () => {
		const renderedComponent = await renderIntoDocument(
			h(TransactionActionButton, {
				idleLabel: 'Submit',
				onClick: () => undefined,
				pendingLabel: 'Submitting...',
				status: {
					detail: 'Refresh failed after the transaction completed.',
					title: 'Refresh needed',
					tone: 'warning',
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status')).not.toBeNull()
		expect(documentQueries.getByText('Refresh needed')).not.toBeNull()
	})

	test('renders error feedback as an alert', async () => {
		const renderedComponent = await renderIntoDocument(
			h(TransactionActionButton, {
				idleLabel: 'Submit',
				onClick: () => undefined,
				pendingLabel: 'Submitting...',
				status: {
					detail: 'The transaction reverted.',
					title: 'Submission failed',
					tone: 'error',
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert')).not.toBeNull()
		expect(documentQueries.getByText('Submission failed')).not.toBeNull()
	})
})
