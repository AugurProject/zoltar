/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '../testUtils/queries'
import { h } from 'preact'
import { AppStatusNotices } from '../../app/components/AppStatusNotices.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

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
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Transaction complete')).toBeNull()
		expect(documentQueries.queryByText(/^Last transaction:/)).toBeNull()
	})

	test('does not render wrong-network notices in the page-level notice stack', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Wrong network')).toBeNull()
		expect(documentQueries.queryByText('This interface only enables contract interactions on Ethereum mainnet. Switch the connected wallet network to Ethereum mainnet to continue.')).toBeNull()
	})

	test('shows a simulation bootstrap failure notice', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: 'Anvil boot failed',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Simulation bootstrap failed')).not.toBeNull()
		expect(documentQueries.getByText('Anvil boot failed')).not.toBeNull()
	})

	test('shows a read RPC mismatch notice', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: 'Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).',
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Read RPC mismatch')).not.toBeNull()
		expect(documentQueries.getByText('Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1). Displayed onchain state may not match the network this interface writes to.')).not.toBeNull()
	})

	test('warns when the read RPC comes from the page URL', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				readBackendStatus: {
					blockNumber: undefined,
					blockTimestamp: undefined,
					rpcSource: 'url',
					rpcUrl: 'https://query.example/path',
					transportMode: 'rpc',
				},
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('URL-provided read RPC')).not.toBeNull()
		expect(documentQueries.getByText('Custom read RPC active. Verify it before acting on displayed chain state.')).not.toBeNull()
		expect(documentQueries.getByText('Technical details')).not.toBeNull()
		expect(documentQueries.getByText('Active read RPC came from the page URL: https://query.example/path. Verify this endpoint before relying on displayed onchain state.')).not.toBeNull()
	})

	test('shows source and URL for a stored read RPC override', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				readBackendStatus: {
					blockNumber: undefined,
					blockTimestamp: undefined,
					rpcSource: 'localStorage',
					rpcUrl: 'https://storage.example/path',
					transportMode: 'rpc',
				},
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Read RPC override active')).not.toBeNull()
		expect(documentQueries.getByText('Custom read RPC active. Verify it before acting on displayed chain state.')).not.toBeNull()
		expect(documentQueries.getByText('Active read RPC came from local storage: https://storage.example/path. Verify this endpoint before relying on displayed onchain state.')).not.toBeNull()
	})

	test('warns when a stored read RPC override is ignored', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				readBackendStatus: {
					blockNumber: undefined,
					blockTimestamp: undefined,
					rejectedRpcOverride: {
						reason: 'RPC URL must use https:// unless it points to local loopback.',
						source: 'localStorage',
						url: 'http://storage.example',
					},
					rpcSource: 'default',
					rpcUrl: 'https://ethereum.dark.florist',
					transportMode: 'provider',
				},
				showAugurPlaceHolderDeploymentWarning: false,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Read RPC override ignored')).not.toBeNull()
		expect(documentQueries.getByText('A custom read RPC was ignored. The configured fallback is active.')).not.toBeNull()
		expect(documentQueries.getByText('Ignored local storage RPC override (http://storage.example): RPC URL must use https:// unless it points to local loopback. Configured fallback read RPC is https://ethereum.dark.florist.')).not.toBeNull()
	})

	test('shows deployment setup and top-level errors without a wrong-network notice', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: 'Top-level error',
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: true,
				simulationBootstrapError: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Setup incomplete')).not.toBeNull()
		expect(documentQueries.getByText('Required application contracts are not deployed.')).not.toBeNull()
		expect(documentQueries.queryByText('Wrong network')).toBeNull()
		expect(documentQueries.getByText('Error')).not.toBeNull()
		expect(documentQueries.getByText('Top-level error')).not.toBeNull()
	})
})
