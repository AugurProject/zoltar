/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { h } from 'preact'
import { AppStatusNotices } from '../components/AppStatusNotices.js'
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

	test('does not render global transaction completion notices', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Transaction complete')).toBeNull()
	})

	test('shows the wrong network notice in the page-level notice stack', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: 'Switch to Ethereum mainnet.',
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Wrong network')).not.toBeNull()
		expect(documentQueries.getByText('This interface only enables contract interactions on Ethereum mainnet. Switch the connected wallet network to Ethereum mainnet to continue.')).not.toBeNull()
	})
})
