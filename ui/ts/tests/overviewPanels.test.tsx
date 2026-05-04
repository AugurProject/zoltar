/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from '@testing-library/dom'
import { OverviewPanels } from '../components/OverviewPanels.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('OverviewPanels', () => {
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

	test('renders the REP/ETH panel from the canonical REP per ETH quote', async () => {
		const renderedComponent = await renderIntoDocument(
			<OverviewPanels
				accountState={{
					address: undefined,
					chainId: '0x1',
					ethBalance: undefined,
					wethBalance: undefined,
				}}
				isConnectingWallet={false}
				isLoadingRepPrices={false}
				isLoadingUniverseRepBalance={false}
				isRefreshing={false}
				onConnect={() => undefined}
				onGoToGenesisUniverse={() => undefined}
				repPerEthPrice={2439024390243902439024n}
				repPerEthSource={undefined}
				repPerEthSourceUrl={undefined}
				repUsdcPrice={undefined}
				repUsdcSource={undefined}
				repUsdcSourceUrl={undefined}
				universeLabel='Genesis universe'
				universePresentation={undefined}
				universeRepBalance={undefined}
				walletBootstrapComplete={true}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('≈ 2 439.02')).toBeDefined()
		expect(documentQueries.queryByText(/0\.00041/)).toBeNull()
	})
})
