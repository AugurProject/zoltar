/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { AppStatusNotices } from '../components/AppStatusNotices.js'
import { createInitialTransactionState } from '../lib/transactionState.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('AppStatusNotices', () => {
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

	test('suppresses global transaction success when the route already shows a local outcome summary', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				hasInjectedWallet: true,
				showTransactionSuccessNotice: false,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				transactionState: {
					...createInitialTransactionState(),
					lastTransactionHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
				},
				walletPresentation: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Transaction complete')).toBeNull()
	})

	test('shows the global transaction success notice when no local route outcome is present', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				hasInjectedWallet: true,
				showTransactionSuccessNotice: true,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				transactionState: {
					...createInitialTransactionState(),
					lastTransactionHash: '0x1234000000000000000000000000000000000000000000000000000000000000',
				},
				walletPresentation: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Transaction complete')).not.toBeNull()
	})
})
