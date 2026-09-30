import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { buttonByLabel, waitForDom } from '../support/dom.js'
import { etherScaleMarketFixture } from '../support/liveMarketFixture.js'
import { connectedWalletServices, discoveryPage, installSilentInjectedWallet, offlineControllerServices } from '../support/liveTradingServices.js'

const account = `0x${'11'.repeat(20)}` as Address
const pool = `0x${'22'.repeat(20)}` as Address
const configuration = deploymentConfigurationFixture()
const market = etherScaleMarketFixture({ pool, title: 'Balance notice market', description: 'Balance notice fixture' })

describe('market page balance failure', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: `http://localhost/?demo=0#/market/${pool}`,
	})

	const services = {
		...offlineControllerServices,
		discoverAddressedMarket: async () => discoveryPage([{ ...market }]),
		discoverTradingMarketPage: async () => discoveryPage([{ ...market }]),
		discoverAllLiveMarketsInUniverse: async () => discoveryPage([{ ...market }]),
		...connectedWalletServices(account, configuration.chainId),
		createTradingWalletClient: () => ({ waitForTransactionReceipt: async () => ({ status: 'success' as const }) }),
		loadLiveBalances: async () => {
			throw new Error('Balance node unavailable')
		},
	}

	for (const route of [`market/${pool}`, `liquidity/${pool}`] as const)
		test(`shows one balance failure notice with its retry on ${route.split('/')[0]}`, async () => {
			installSilentInjectedWallet()
			const rendered = await renderIntoDocument(<LiveTrading route={route} configuration={configuration} configurationError={undefined} selectedUniverseId='1' onWorkflowLockChange={() => undefined} controllerServices={services} />)
			cleanupRendered = rendered.cleanup
			await waitForDom(() => document.querySelector('[role="tabpanel"]') !== null, 'market workspace')
			await act(async () => buttonByLabel('Connect wallet').click())
			await waitForDom(() => document.querySelector('.balance-recovery') !== null, 'balance failure notice')
			expect(document.querySelectorAll('.balance-recovery')).toHaveLength(1)
		})
})
