/// <reference types='bun-types' />

import { setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { marketDownloadStore } from '../../lib/favoriteMarkets.js'
import { h } from 'preact'
import { Zoltar_Zoltar } from '@zoltar/ui-core-shared/contractArtifact.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { WalletSummaryState } from '../../lib/walletSummaryState.js'
import { discoverAddressedMarket, discoverSavedMarkets, discoverTradingMarketPage, discoverUniverses, isSecurityPoolNotFoundError, type TradingPairIndex } from '../../protocol/marketDiscovery.js'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { latestBlockIdentity } from '../../protocol/tradeQuote.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { LiveTrading } from '../../features/LiveTrading.js'
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { deploymentConfigurationForPlan, getTradingDeploymentPlan } from '../../protocol/deployment.js'
import { createSecurityPoolDeploymentIndex, discoverLiveUniverseMarketPage, loadLiveBalances, marketNewRiskBlocker } from '../../protocol/live.js'
import { statoblast_SecurityPool_SecurityPool, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { shareTokenAbi } from '../../protocol/authorization.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO } from '../../simulation/index.js'

test('universe and address lookup discovery reads only the selected universe', async () => {
	const configuration = deploymentConfigurationFixture()
	const calls: bigint[] = []
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC method')
				const [transaction] = params
				if (typeof transaction !== 'object' || transaction === null || !('data' in transaction) || typeof transaction.data !== 'string') throw new Error('Missing contract call')
				const { functionName, args } = decodeFunctionData({ abi: Zoltar_Zoltar.abi, data: transaction.data })
				if (functionName !== 'getRepToken' || args === undefined) throw new Error(`Unbounded universe discovery: ${functionName}`)
				const id = args[0]
				if (typeof id !== 'bigint') throw new Error('Missing universe ID')
				calls.push(id)
				return encodeAbiParameters([{ type: 'address' }], [id === 999n ? '0x0000000000000000000000000000000000000000' : configuration.zoltar])
			},
		}),
	})
	const result = await discoverUniverses(client, configuration, 123n)
	expect(result.selectedUniverseId).toBe(123n)
	expect(result.universeIds).toEqual([0n, 123n])
	expect(result.markets).toEqual([])
	expect(calls).toEqual([123n])
	await expect(discoverUniverses(client, configuration, 999n)).rejects.toThrow('Universe does not exist')
	await expect(discoverUniverses(client, configuration, 0n, () => false)).rejects.toThrow('Market discovery cancelled')
	expect(calls).toEqual([123n, 999n])
})

test('only missing pool identity reads are classified as a missing security pool', async () => {
	const configuration = deploymentConfigurationFixture()
	const pool = getAddress(`0x${'12'.repeat(20)}`)
	const addresses: Readonly<Record<string, Address>> = {
		securityPoolFactory: configuration.securityPoolFactory,
		zoltar: configuration.zoltar,
		shareToken: getAddress(`0x${'34'.repeat(20)}`),
		getSecurityPool: pool,
		canonicalPoolByUniverse: pool,
		openOraclePriceCoordinator: getAddress(`0x${'56'.repeat(20)}`),
	}
	const abi = [...statoblast_SecurityPool_SecurityPool.abi, ...statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi, ...statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, ...shareTokenAbi]
	for (const failedFunction of ['securityPoolFactory', 'getSecurityPoolOriginId', 'getSecurityPool', 'initialReportPriorityFeeAttoEthPerGas']) {
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected RPC method: ${method}`)
					const transaction = params[0]
					if (typeof transaction !== 'object' || transaction === null || !('data' in transaction) || typeof transaction.data !== 'string') throw new Error('Expected contract call data')
					const { functionName } = decodeFunctionData({ abi, data: transaction.data })
					if (functionName === failedFunction) return '0x'
					const address = addresses[functionName]
					if (address !== undefined) return encodeAbiParameters([{ type: 'address' }], [address])
					if (['universeId', 'getSecurityPoolOriginId', 'questionId', 'statoblastSecurityMultiplierBps'].includes(functionName)) return encodeAbiParameters([{ type: 'uint256' }], [0n])
					throw new Error(`Unexpected contract read: ${functionName}`)
				},
			}),
		})
		let failure: unknown
		try {
			await discoverAddressedMarket(client, configuration, pool)
		} catch (error) {
			failure = error
		}
		expect(failure).toBeInstanceOf(Error)
		expect(isSecurityPoolNotFoundError(failure)).toBe(failedFunction === 'securityPoolFactory')
	}
})

for (const scenario of [DEPLOYED_TRADING_SIMULATION_SCENARIO, FUNDED_TRADING_SIMULATION_SCENARIO])
	describe(`${scenario} simulation market discovery`, () => {
		let backend: SimulationBackend

		beforeAll(async () => {
			backend = await createBootstrappedSimulationBackendWithRetry(scenario, 1, 'trading')
			await backend.setTransactionDelayMilliseconds(0)
			await backend.setQueryDelayMilliseconds(0)
		}, 180_000)

		if (scenario === FUNDED_TRADING_SIMULATION_SCENARIO)
			test('a timed-out saved pool does not prevent loading the following healthy pool', async () => {
				activateSimulationBackendProfile(backend)
				const addresses = getInfraContractAddresses(backend.profile)
				const plan = getTradingDeploymentPlan({ chainId: backend.profile.chain.id, chainName: backend.profile.displayName, defaultRpcUrl: 'http://127.0.0.1/', id: 'simulation', proxyDeployer: PROXY_DEPLOYER_ADDRESS, securityPoolFactory: addresses.securityPoolFactory, zoltar: addresses.zoltar }, 30)
				const configuration = deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
				const seeded = (await discoverLiveUniverseMarketPage(backend.createReadClient(), configuration, 0n)).markets[0]
				if (seeded === undefined) throw new Error('Missing seeded market')
				const stalledPool = getAddress('0x1111111111111111111111111111111111111111')
				const dom = installDomEnvironment()
				const restore = installActiveEnvironmentForTesting(backend, backend)
				const originalTimeout = globalThis.setTimeout
				const timer = spyOn(globalThis, 'setTimeout').mockImplementation((handler, delay, ...args) => originalTimeout(handler, delay === 30_000 ? 3_000 : delay, ...args))
				let result: Awaited<ReturnType<typeof discoverSavedMarkets>> | undefined
				try {
					const scope = getLocalEntityScope('trading', 'pool')
					marketDownloadStore.record(scope, [
						{ id: seeded.pool, data: seeded },
						{ id: stalledPool, data: { ...seeded, pool: stalledPool } },
					])
					setEntityFavorite(scope, seeded.pool, true)
					setEntityFavorite(scope, stalledPool, true)
					const client = backend.createReadClient()
					const readContract: typeof client.readContract = async parameters => {
						if (parameters.address === stalledPool) return await new Promise<never>(() => undefined)
						return await client.readContract(parameters)
					}
					const rendered = await renderIntoDocument(
						h(LiveTrading, {
							route: 'portfolio',
							configuration,
							configurationError: undefined,
							selectedUniverseId: '0',
							onWorkflowLockChange: () => undefined,
							controllerServices: {
								...liveTradingControllerServices,
								createTradingPublicClient: () => ({ ...client, readContract }),
								discoverSavedMarkets: async (...args) => {
									result = await discoverSavedMarkets(...args)
									return result
								},
							},
						}),
					)
					try {
						await waitFor(() => expect([...rendered.container.querySelectorAll('button')].find(button => button.textContent === 'Refresh portfolio')?.disabled).toBe(false), { timeout: 8_000 })
						expect(result?.markets).toHaveLength(2)
						expect(result?.markets.find(market => market.pool === stalledPool)?.loadError).toContain('timed out')
						expect(result?.markets.find(market => market.pool === seeded.pool)?.loadError).toBeUndefined()
						expect(result?.markets.find(market => market.pool === seeded.pool)?.pair).toBe(seeded.pair)
						await waitFor(() => expect(rendered.container.querySelector(`[data-portfolio-pool="${stalledPool}"]`)?.textContent).toContain('timed out'))
						expect(rendered.container.querySelector(`[data-portfolio-pool="${seeded.pool}"]`)?.textContent).not.toContain('timed out')
					} finally {
						await rendered.cleanup()
					}
				} finally {
					timer.mockRestore()
					restore()
					dom.cleanup()
				}
			}, 180_000)

		test('shows a missing pool without retry and offers a way back on addressed routes', async () => {
			const addresses = getInfraContractAddresses(backend.profile)
			const plan = getTradingDeploymentPlan({ chainId: backend.profile.chain.id, chainName: backend.profile.displayName, defaultRpcUrl: 'http://127.0.0.1/', id: 'simulation', proxyDeployer: PROXY_DEPLOYER_ADDRESS, securityPoolFactory: addresses.securityPoolFactory, zoltar: addresses.zoltar }, 30)
			const configuration = deploymentConfigurationForPlan(plan, 'http://127.0.0.1/')
			const missingPool = getAddress('0x1111111111111111111111111111111111111111')
			await expect(discoverAddressedMarket(backend.createReadClient(), configuration, missingPool)).rejects.toMatchObject({ name: 'SecurityPoolNotFoundError' })
			const dom = installDomEnvironment()
			const restore = installActiveEnvironmentForTesting(backend, backend)
			try {
				for (const route of [`security-pool/${missingPool}`, `market/${missingPool}`, `liquidity/${missingPool}`, `create-market/${missingPool}`] as const) {
					const rendered = await renderIntoDocument(h(LiveTrading, { route, configuration, configurationError: undefined, selectedUniverseId: '0', controllerServices: liveTradingControllerServices, onWorkflowLockChange: () => undefined }))
					try {
						await waitFor(() => expect(rendered.container.textContent).toContain('Security pool does not exist'))
						expect(rendered.container.textContent).not.toContain('discovery failed')
						expect(rendered.container.textContent).not.toContain('Retry')
						const back = Array.from(rendered.container.querySelectorAll('a')).find(link => link.textContent === 'Back to create market')
						expect(back?.getAttribute('href')).toContain('#/create-market')
					} finally {
						rendered.cleanup()
					}
				}
			} finally {
				restore()
				dom.cleanup()
			}
		}, 180_000)

		afterAll(async () => {
			if (backend !== undefined) await backend.dispose()
			resetActiveEnvironmentForTesting()
		}, 30_000)

		test('discovers the seeded market through current registries without log access', async () => {
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
			const noLogsClient = {
				...backend.createReadClient(),
				getLogs: async () => {
					throw new Error('Log access unavailable')
				},
			}
			const discovery = await discoverLiveUniverseMarketPage(noLogsClient, configuration, 0n)
			const tradingPage = await discoverTradingMarketPage(noLogsClient, configuration, 0n)
			expect(tradingPage.total).toBe(scenario === FUNDED_TRADING_SIMULATION_SCENARIO ? 1n : 0n)

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
				const savedMarket = discovery.markets[0]
				if (savedMarket === undefined) throw new Error('Missing saved pool fixture')
				const checkedPools: Address[] = []
				const savedClient = {
					...client,
					readContract: async (parameters: Parameters<typeof client.readContract>[0]) => {
						if (['securityPoolDeploymentCount', 'securityPoolDeploymentsRange', 'pairDeploymentCount', 'pairDeploymentsRange'].includes(parameters.functionName)) throw new Error('Portfolio must never scan a pool registry')
						if (parameters.functionName === 'getSecurityPoolOriginId') checkedPools.push(getAddress(String(parameters.args?.[0])))
						return await client.readContract(parameters)
					},
				}
				const savedPool = { pool: savedMarket.pool, universeId: savedMarket.universeId, market: savedMarket }
				const saved = await discoverSavedMarkets(savedClient, configuration, 0n, [savedPool, savedPool, { ...savedPool, pool: getAddress('0x1111111111111111111111111111111111111111'), universeId: 999n }])
				expect(saved.markets).toHaveLength(1)
				expect(saved.markets[0]?.loadError).toBeUndefined()
				expect(checkedPools).toEqual([savedMarket.pool])
				const empty = await discoverSavedMarkets(savedClient, configuration, 0n, [])
				expect(empty.markets).toEqual([])
				expect(checkedPools).toEqual([savedMarket.pool])
				const started = Date.now()
				const withUnavailable = await discoverSavedMarkets(savedClient, configuration, 0n, [savedPool, { ...savedPool, pool: getAddress('0x1111111111111111111111111111111111111111') }])
				expect(Date.now() - started).toBeGreaterThanOrEqual(1_000)
				expect(withUnavailable.markets[0]?.loadError).toBeUndefined()
				expect(withUnavailable.markets[1]?.loadError).toContain('does not exist')
				let current = true
				let cancelled: unknown
				try {
					await discoverSavedMarkets(
						savedClient,
						configuration,
						0n,
						[savedPool, { ...savedPool, pool: getAddress('0x1111111111111111111111111111111111111111') }],
						() => {
							current = false
						},
						() => current,
					)
				} catch (error) {
					cancelled = error
				}
				expect(cancelled).toBeInstanceOf(Error)
				expect(String(cancelled)).toContain('Portfolio refresh cancelled')
				expect(checkedPools).toEqual([savedMarket.pool, savedMarket.pool, savedMarket.pool])
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
					await expect(discoverAddressedMarket(failingClient, configuration, addressedPool)).rejects.toThrow(errorName === 'ContractFunctionZeroDataError' ? 'Security pool does not exist at this address. Check the address and network.' : 'RPC unavailable')
				}
				let rejectedDeployment: unknown
				try {
					await discoverAddressedMarket(directClient, { ...configuration, securityPoolFactory: configuration.factory }, addressedPool)
				} catch (error) {
					rejectedDeployment = error
				}
				expect(rejectedDeployment).toMatchObject({ name: 'SecurityPoolNotFoundError' })
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
								discoverSavedMarkets: async () => {
									throw new Error('Addressed pages must not discover every pool')
								},
							},
						}),
					)
					try {
						await waitFor(() => expect(addressed.container.textContent).toContain(directRoute.startsWith('security-pool/') ? 'Registered vaults' : 'Trading fee'), { timeout: 10_000 })
						expect(addressed.container.querySelector('.market-list')).toBeNull()
						expect(addressed.container.querySelector('.mobile-return')).toBeNull()
					} finally {
						await addressed.cleanup()
					}
				}
				const pairIndex: TradingPairIndex = createSecurityPoolDeploymentIndex()
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
				for (const route of ['market', 'liquidity', 'create-market', 'portfolio'] as const) {
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
						if (route !== 'portfolio') {
							// Fresh browser lists have no favorites; simulation registry seeding does not trigger scans.
							expect(rendered.container.querySelector('form.market-list-search')).not.toBeNull()
							expect(rendered.container.querySelectorAll('.market-record')).toHaveLength(0)
							expect(rendered.container.querySelector('.discovery-control')).toBeNull()
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
			await backend.advanceTime(60n)
			const refreshed = await discoverLiveUniverseMarketPage(backend.createReadClient(), configuration, 0n)
			const valued = refreshed.markets[0]
			if (valued?.valuation === undefined) throw new Error('Fee valuation is missing')
			expect(valued.valuation.timestamp).toBeGreaterThan(market.valuation?.timestamp ?? 0n)
			expect(valued.settlementCollateralAttoEth).toBeLessThan(market.settlementCollateralAttoEth)
			expect(valued.shareTokenSupplyAttoShares).toBe(market.shareTokenSupplyAttoShares)
			expect(valued.valuation.projectedCollateralAttoEth).toBeLessThanOrEqual(valued.settlementCollateralAttoEth)
			expect(await loadLiveBalances(backend.createReadClient(), valued, account)).toEqual(balances)
		}, 180_000)

		test('isolates one failed market read into an explicit unavailable row without leaking provider detail', async () => {
			activateSimulationBackendProfile(backend)
			const addresses = getInfraContractAddresses(backend.profile)
			const configuration = deploymentConfigurationForPlan(
				getTradingDeploymentPlan({ chainId: backend.profile.chain.id, chainName: backend.profile.displayName, defaultRpcUrl: 'http://127.0.0.1/', id: 'simulation', proxyDeployer: PROXY_DEPLOYER_ADDRESS, securityPoolFactory: addresses.securityPoolFactory, zoltar: addresses.zoltar }, 30),
				'http://127.0.0.1/',
			)
			const client = backend.createReadClient()
			const seeded = await discoverLiveUniverseMarketPage(client, configuration, 0n)
			const pool = seeded.markets[0]?.pool
			if (pool === undefined) throw new Error('Seeded market is missing')
			const readContract: typeof client.readContract = async parameters => {
				if (parameters.address.toLowerCase() === pool.toLowerCase()) throw new Error(`Contract read failed at ${pool}: token ID 1793, call arguments unavailable`)
				return await client.readContract(parameters)
			}
			const discovery = await discoverLiveUniverseMarketPage({ ...client, readContract }, configuration, 0n)
			expect(discovery.total).toBe(1n)
			const market = discovery.markets[0]
			if (market === undefined) throw new Error('Expected an unavailable market row')
			expect(market.pool).toBe(pool)
			expect(market.loadError).toBe('Market data could not be read.')
			expect(market.loadError).not.toContain('1793')
			expect(marketNewRiskBlocker(market, 0n)).toBe('Market data unavailable')
		}, 180_000)
	})
