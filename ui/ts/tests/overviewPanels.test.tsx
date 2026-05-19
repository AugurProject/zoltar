/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { OverviewPanels } from '../components/OverviewPanels.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('OverviewPanels', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	async function renderOverviewPanels(overrides: Partial<Parameters<typeof OverviewPanels>[0]> = {}) {
		const baseProps: Parameters<typeof OverviewPanels>[0] = {
			accountState: {
				address: undefined,
				chainId: '0x1',
				ethBalance: undefined,
				wethBalance: undefined,
			},
			isConnectingWallet: false,
			isLoadingRepPrices: false,
			isLoadingUniverseRepBalance: false,
			isRefreshing: false,
			onConnect: () => undefined,
			onGoToGenesisUniverse: () => undefined,
			onRefreshRepPrices: () => undefined,
			repPerEthPrice: undefined,
			repPerEthSource: undefined,
			repPerEthSourceUrl: undefined,
			repUsdcPrice: undefined,
			repUsdcSource: undefined,
			repUsdcSourceUrl: undefined,
			universeLabel: 'Genesis universe',
			universePresentation: undefined,
			universeRepBalance: undefined,
			walletBootstrapComplete: true,
		}

		const renderedComponent = await renderIntoDocument(
			<OverviewPanels
				{...baseProps}
				{...overrides}
				accountState={{
					...baseProps.accountState,
					...overrides.accountState,
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		return within(document.body)
	}

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

	test('shows an enabled connect wallet button when disconnected and idle', async () => {
		const documentQueries = await renderOverviewPanels()
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
	})

	test('shows a disabled spinner button while a wallet connection request is pending', async () => {
		const documentQueries = await renderOverviewPanels({
			isConnectingWallet: true,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connecting...' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(true)
	})

	test('keeps the connect wallet button idle during bootstrap-only loading', async () => {
		const documentQueries = await renderOverviewPanels({
			walletBootstrapComplete: false,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
		expect(documentQueries.getByText('Connecting...')).toBeDefined()
	})

	test('renders the REP/ETH panel from the canonical REP per ETH quote', async () => {
		const documentQueries = await renderOverviewPanels({
			repPerEthPrice: 2439024390243902439024n,
		})
		expect(documentQueries.getByText('≈ 2 439.02')).toBeDefined()
		expect(documentQueries.queryByText(/0\.00041/)).toBeNull()
	})

	test('renders a refresh button for Uniswap prices and wires it to the provided handler', async () => {
		const onRefreshRepPrices = mock(() => undefined)
		const documentQueries = await renderOverviewPanels({
			onRefreshRepPrices,
		})
		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh Uniswap prices' })
		fireEvent.click(refreshButton)

		expect(onRefreshRepPrices).toHaveBeenCalledTimes(1)
	})
})
