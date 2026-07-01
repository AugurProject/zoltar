/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
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
				readBackendMessage: undefined,
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
		expect(documentQueries.queryByText(/^Last transaction:/)).toBeNull()
	})

	test('shows the wrong network notice in the page-level notice stack', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
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
		expect(
			documentQueries.getByText('This interface only enables contract interactions on Ethereum mainnet. Switch the connected wallet network to Ethereum mainnet to continue. Read-only contract data may still be visible, but transaction controls remain disabled until the wallet is back on Ethereum mainnet.'),
		).not.toBeNull()
	})

	test('shows a simulation bootstrap failure notice', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: 'Anvil boot failed',
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
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
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
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
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('URL-provided read RPC')).not.toBeNull()
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
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Read RPC override active')).not.toBeNull()
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
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Read RPC override ignored')).not.toBeNull()
		expect(documentQueries.getByText('Ignored local storage RPC override (http://storage.example): RPC URL must use https:// unless it points to local loopback. Configured fallback read RPC is https://ethereum.dark.florist.')).not.toBeNull()
	})

	test('shows deployment setup and custom wrong-network guidance together', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: 'Top-level error',
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: true,
				showZoltarUniverseForkedWarning: false,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: 'Chain ID mismatch.',
				zoltarUniverse: undefined,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Setup incomplete')).not.toBeNull()
		expect(documentQueries.getByText('Finish setup in Deploy before using the app.')).not.toBeNull()
		expect(documentQueries.getByText('Wrong network')).not.toBeNull()
		expect(documentQueries.getByText('This interface only enables contract interactions on Ethereum mainnet. Chain ID mismatch. Read-only contract data may still be visible, but transaction controls remain disabled until the wallet is back on Ethereum mainnet.')).not.toBeNull()
		expect(documentQueries.getByText('Error')).not.toBeNull()
		expect(documentQueries.getByText('Top-level error')).not.toBeNull()
	})

	test('shows a fork warning when the current universe has forked', async () => {
		const renderedComponent = await renderIntoDocument(
			h(AppStatusNotices, {
				errorMessage: undefined,
				readBackendMessage: undefined,
				showAugurPlaceHolderDeploymentWarning: false,
				showZoltarUniverseForkedWarning: true,
				simulationBootstrapError: undefined,
				wrongNetworkMessage: undefined,
				zoltarUniverse: {
					childUniverses: [],
					forkThreshold: 1000n,
					forkQuestionDetails: undefined,
					forkTime: 1_700_000n,
					forkingOutcomeIndex: 0n,
					hasForked: true,
					parentUniverseId: 0n,
					reputationToken: '0x0000000000000000000000000000000000000000',
					totalTheoreticalSupply: 0n,
					universeId: 3n,
				},
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Universe forked')).not.toBeNull()
		expect(documentQueries.getByText(/Universe 3 has forked on/)).not.toBeNull()
	})
})
