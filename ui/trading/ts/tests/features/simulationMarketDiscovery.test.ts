/// <reference types='bun-types' />

import { h } from 'preact'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import { discoverAddressedMarket, discoverTradingMarketPage, createTradingPairIndex } from '../../protocol/marketDiscovery.js'
import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { latestBlockIdentity } from '../../protocol/tradeQuote.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulationTestUtils.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { discoverLiveUniverseMarketPage, loadLiveBalances } from '../../protocol/live.js'
import { DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO } from '../../simulation/index.js'

for (const scenario of [DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO])
	describe(`${scenario} simulation market discovery`, () => {
		let backend: SimulationBackend

		beforeAll(async () => {
			backend = await createBootstrappedSimulationBackendWithRetry(scenario, 1, 'trading')
			await backend.setTransactionDelayMilliseconds(0)
			await backend.setQueryDelayMilliseconds(0)
		}, 180_000)

		afterAll(async () => {
			if (backend !== undefined) await backend.dispose()
			resetActiveEnvironmentForTesting()
		}, 30_000)

		test('discovers the seeded market through its Zoltar universe and factory event', async () => {
			activateSimulationBackendProfile(backend)
			const addresses = getInfraContractAddresses(backend.profile)
			const plan = getTradingDeploymentPlan(
				{
					chainId: backend.profile.chain.id,
					chainName: backend.profile.displayName,
					defaultRpcUrl: 'http://127.0.0.1/',
					id: 'simulation',
					proxyDeployer: PROXY_DEPLOYER_ADDRESS,
					securityPoolFactory: addresses.securityPoolFactory,
					zoltar: addresses.zoltar,
				},
				30,
			)
			const configuration = deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
			const discovery = await discoverLiveUniverseMarketPage(backend.createReadClient(), configuration, 0n)

			const dom = installDomEnvironment()
			const restore = installActiveEnvironmentForTesting(backend, backend)
			try {
				const addressedPool = discovery.markets[0]?.pool
				if (addressedPool === undefined) throw new Error('Missing pool for direct lookup regression')
				const client = backend.createReadClient()
				const readContract: typeof client.readContract = async parameters => {
					if (parameters.functionName === 'getDeployedChildUniverses') throw new Error('Direct lookup must not enumerate universes')
					return await client.readContract(parameters)
				}
				const directClient = {
					...client,
					readContract,
					getLogs: async () => {
						throw new Error('Direct lookup must not scan events')
					},
				}
				for (const errorName of ['ContractFunctionZeroDataError', 'RpcRequestError']) {
					const failure = new Error('RPC unavailable')
					failure.name = errorName
					const failingClient = {
						...directClient,
						readContract: async () => {
							throw failure
						},
					}
					await expect(discoverAddressedMarket(failingClient, configuration, addressedPool)).rejects.toThrow(errorName === 'ContractFunctionZeroDataError' ? 'No SecurityPool found at this address. Check the address and network.' : 'RPC unavailable')
				}
				let rejectedDeployment: unknown
				try {
					await discoverAddressedMarket(directClient, { ...configuration, securityPoolFactory: configuration.factory }, addressedPool)
				} catch (error) {
					rejectedDeployment = error
				}
				expect(rejectedDeployment).toBeInstanceOf(Error)
				expect(String(rejectedDeployment)).toContain('configured deployment')
				await expect(discoverAddressedMarket(directClient, configuration, '0x0000000000000000000000000000000000000000')).rejects.toThrow('nonzero')
				for (const directRoute of [`security-pool/${addressedPool}`, `market/${addressedPool}`, `liquidity/${addressedPool}`] as const) {
					const addressed = await renderIntoDocument(
						h(LiveTrading, {
							route: directRoute,
							configuration,
							configurationError: undefined,
							selectedUniverseId: '0',
							onWorkflowLockChange: () => undefined,
							controllerServices: {
								...liveTradingControllerServices,
								createTradingPublicClient: () => directClient,
								discoverAllLiveMarketsInUniverse: async () => {
									throw new Error('Addressed pages must not discover every pool')
								},
							},
						}),
					)
					try {
						await waitFor(() => expect(addressed.container.textContent).toContain(directRoute.startsWith('security-pool/') ? 'Registered vaults' : 'AMM fee'), { timeout: 10_000 })
						expect(addressed.container.querySelector('.market-list')).toBeNull()
						expect(addressed.container.querySelector('.mobile-return')).toBeNull()
					} finally {
						await addressed.cleanup()
					}
				}
				const pairIndex = createTradingPairIndex()
				pairIndex.key = `${configuration.chainId}:${configuration.factory}:${configuration.rpcUrl}:0`
				pairIndex.anchor = await latestBlockIdentity(client)
				pairIndex.deployments = Array.from({ length: 1_001 }, (_value, i) => ({ securityPool: getAddress(`0x${(i + 100_000).toString(16).padStart(40, '0')}`), shareToken: addressedPool, universeId: 0n }))
				const attemptedPools = new Set<Address>()
				const boundedRead: typeof client.readContract = async parameters => {
					if (parameters.functionName === 'getDeployedChildUniverses') return await client.readContract(parameters)
					attemptedPools.add(parameters.address)
					throw new Error('Pool read unavailable in bounded-page fixture')
				}
				const page = await discoverTradingMarketPage({ ...directClient, readContract: boundedRead }, configuration, 0n, 25n, 25n, pairIndex)
				expect(page.total).toBe(1_001n)
				expect(page.markets).toHaveLength(25)
				expect(attemptedPools.size).toBe(25)
				expect([...attemptedPools]).toEqual(pairIndex.deployments.slice(25, 50).map(deployment => deployment.securityPool))
				expect(page.previousStart).toBe(0n)
				expect(page.nextStart).toBe(50n)
				for (const route of ['markets', 'security-pools', 'market', 'liquidity', 'create-market', 'portfolio'] as const) {
					let summary: WalletSummaryState | undefined
					const rendered = await renderIntoDocument(
						h(LiveTrading, {
							onWalletSummaryChange: value => {
								summary = value
							},
							route,
							configuration,
							configurationError: undefined,
							selectedUniverseId: '0',
							onWorkflowLockChange: () => undefined,
						}),
					)
					try {
						await waitFor(() => expect(rendered.container.querySelector('[aria-busy="true"]')?.getAttribute('class'), `${scenario}/${route}: ${rendered.container.textContent}`).toBeUndefined(), { timeout: 10_000 })
						await waitFor(() => expect(summary?.status).toBe('ready'), { timeout: 10_000 })
						expect(rendered.container.textContent).not.toContain('Connect a wallet to load')
						if (route === 'markets' || route === 'security-pools') {
							const expectedMarkets = (route === 'security-pools') === (scenario === DEPLOYED_TRADING_SIMULATION_SCENARIO) ? 1 : 0
							expect(rendered.container.querySelectorAll('.market-row')).toHaveLength(expectedMarkets)
							expect(rendered.container.textContent).not.toContain('Pair not created')
							expect(rendered.container.textContent).not.toContain('Conditional prices only')
						} else if (route !== 'portfolio') {
							// Lookup routes wait for an address instead of discovering every pool.
							expect(rendered.container.querySelector('.market-lookup')).not.toBeNull()
							expect(rendered.container.querySelectorAll('.market-row')).toHaveLength(0)
						}
					} finally {
						await rendered.cleanup()
					}
				}
			} finally {
				restore()
				dom.cleanup()
			}

			expect(discovery.universeIds).toEqual([0n])
			expect(discovery.markets).toHaveLength(1)
			expect(discovery.markets[0]?.title).toBe('Will this resolve?')
			expect(discovery.markets[0]?.originUniverseId).toBe(0n)
			const market = discovery.markets[0]
			if (market === undefined) throw new Error('Seeded market is missing')
			if (scenario === DEPLOYED_TRADING_SIMULATION_SCENARIO) {
				expect(market.pair).toBeUndefined()
				return
			}
			expect(market.pair).toBeDefined()
			expect(market.yesReserve).toBeGreaterThan(0n)
			expect(market.noReserve).toBeGreaterThan(0n)
			expect(market.lpTotalSupply).toBeGreaterThan(0n)
			const account = backend.accounts[0]
			if (account === undefined) throw new Error('Simulation wallet is missing')
			const balances = await loadLiveBalances(backend.createReadClient(), market, account)
			for (const balance of [balances.yes, balances.no, balances.invalid, balances.lp]) expect(balance).toBeGreaterThan(0n)
		}, 180_000)
	})
