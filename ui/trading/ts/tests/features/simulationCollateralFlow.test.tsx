import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { activateSimulationBackendProfile, createBootstrappedSimulationBackendWithRetry, simulationSetupTimeoutMs, type SimulationBackend } from '@zoltar/ui-core-shared/tests/simulation/testUtils.js'
import { discoverLiveUniverseMarketPage, loadLiveBalances, simulateEntry, submitFreshEntry, simulateExit, submitFreshExit, type LiveMarket } from '../../protocol/live.js'
import { LiveLiquidityControls } from '../../features/LiveLiquidityControls.js'
import { LivePositionControls } from '../../features/LivePositionControls.js'
import { LiveSettlementControls } from '../../features/LiveSettlementControls.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { positionTicket } from '../support/positionTicket.js'
import { buttonByLabel } from '../support/dom.js'
import { passthroughWorkflowPanelProps } from '../support/liveWorkflowPanelProps.js'
import { simulationDeploymentConfiguration } from '../support/simulationDeploymentConfiguration.js'
import { registerTradingSimulationScenario } from '../../simulation/index.js'

for (const symbol of ['USDC', 'USDT'])
	describe(`${symbol} on-chain UI funding flows`, () => {
		let backend: SimulationBackend
		beforeAll(async () => {
			registerTradingSimulationScenario()
			backend = await createBootstrappedSimulationBackendWithRetry(`trading-${symbol.toLowerCase()}`, 1, 'trading')
			await backend.setTransactionDelayMilliseconds(0)
			await backend.setQueryDelayMilliseconds(0)
		}, simulationSetupTimeoutMs)
		afterAll(async () => {
			if (backend !== undefined) await backend.dispose()
			resetActiveEnvironmentForTesting()
		}, 30_000)

		test('keeps reset, approval and consuming transactions separate, then buys, adds, removes and redeems collateral', async () => {
			activateSimulationBackendProfile(backend)
			const dom = installDomEnvironment(`http://localhost/?simulate=1&genesis=yes&simScenario=trading-${symbol.toLowerCase()}`)
			const restore = installActiveEnvironmentForTesting(backend, backend)
			const account = backend.accounts[0]
			if (account === undefined) throw new Error('Missing account')
			const configuration = simulationDeploymentConfiguration(backend)
			const read = backend.createReadClient()
			const wallet = backend.createWriteClient(account)
			const requests: Parameters<typeof wallet.writeContract>[0][] = []
			const client = {
				...wallet,
				writeContract: async (request: Parameters<typeof wallet.writeContract>[0]) => {
					requests.push(request)
					return await wallet.writeContract(request)
				},
			}
			let rendered: Awaited<ReturnType<typeof renderIntoDocument>> | undefined
			try {
				const initial = await discoverLiveUniverseMarketPage(read, configuration, 0n)
				const market = initial.markets[0]
				if (market?.collateral === undefined) throw new Error(`Missing token market: ${initial.markets[0]?.loadError}`)
				expect(market.collateral).toMatchObject({ symbol, decimals: 6, native: false })
				const token = market.collateral.token
				const allowance = () => read.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [account, configuration.router] })
				const balance = () => read.readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [account] })
				const clear = async () => {
					const hash = await wallet.writeContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [configuration.router, 0n] })
					await read.waitForTransactionReceipt({ hash })
				}
				const context = async (selected: LiveMarket) => ({
					...passthroughWorkflowPanelProps,
					configuration,
					market: selected,
					balances: await loadLiveBalances(read, selected, account),
					balanceState: 'ready' as const,
					account,
					walletClient: client,
					settings: DEFAULT_TRADE_SETTINGS,
					nowSeconds: (await read.getBlock()).timestamp,
					refresh: async () => undefined,
				})
				const typeAmount = async (value: string) =>
					await act(() => {
						const input = document.querySelector('input[name="amount"]')
						if (!(input instanceof HTMLInputElement)) throw new Error('Missing amount input')
						input.value = value
						input.dispatchEvent(new Event('input', { bubbles: true }))
					})
				const approvalButton = () => {
					const button = Array.from(document.querySelectorAll('button')).find(button => /^Approve /u.test(button.textContent?.trim() ?? ''))
					if (!(button instanceof HTMLButtonElement)) throw new Error('Missing approval button')
					return button
				}
				await clear()
				rendered = await renderIntoDocument(<LiveLiquidityControls {...(await context(market))} walletEthAttoEth={10n ** 18n} walletEthStatus='ready' />)
				await typeAmount('0.1')
				await waitFor(() => expect(approvalButton().disabled).toBe(false), { timeout: 10_000, interval: 50 })
				expect(buttonByLabel('Add liquidity').disabled).toBe(true)
				const setApproval = async (value: string) =>
					await act(() => {
						const input = document.querySelector('.approval-amount-field input')
						if (!(input instanceof HTMLInputElement)) throw new Error('Missing approval input')
						input.value = value
						input.dispatchEvent(new Event('input', { bubbles: true }))
					})
				await setApproval('0.05')
				await act(() => approvalButton().click())
				await waitFor(async () => expect(await allowance()).toBe(50_000n), { timeout: 10_000, interval: 50 })
				expect(buttonByLabel('Add liquidity').disabled).toBe(true)
				expect(requests).toHaveLength(1)
				if (symbol === 'USDT') {
					await waitFor(() => expect(buttonByLabel('Reset USDT approval').disabled).toBe(false), { timeout: 10_000, interval: 50 })
					await act(() => buttonByLabel('Reset USDT approval').click())
					await waitFor(async () => expect(await allowance()).toBe(0n), { timeout: 10_000, interval: 50 })
				}
				await setApproval('')
				await waitFor(() => expect(approvalButton().disabled).toBe(false), { timeout: 10_000, interval: 50 })
				const beforeFullApproval = requests.length
				await act(() => approvalButton().click())
				await waitFor(async () => expect(await allowance()).toBe(100_000n), { timeout: 10_000, interval: 50 })
				await waitFor(() => expect(buttonByLabel('Add liquidity').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				expect(requests).toHaveLength(beforeFullApproval + 1)
				expect(requests.at(-1)).toMatchObject({ address: token, functionName: 'approve', args: [configuration.router, 100_000n] })
				if (symbol === 'USDT') {
					await act(() => {
						const label = Array.from(document.querySelectorAll('label')).find(label => label.textContent?.includes('USDT approval amount'))
						const input = label?.querySelector('input')
						if (input === undefined || input === null) throw new Error('Missing custom approval')
						input.value = '0.2'
						input.dispatchEvent(new Event('input', { bubbles: true }))
					})
					expect(approvalButton().disabled).toBe(true)
					expect(document.body.textContent).toContain('Reset USDT approval first.')
					await act(() => buttonByLabel('Reset USDT approval').click())
					await waitFor(async () => expect(await allowance()).toBe(0n), { timeout: 10_000, interval: 50 })
					await waitFor(() => expect(approvalButton().disabled).toBe(false), { timeout: 10_000, interval: 50 })
					await act(() => approvalButton().click())
					await waitFor(async () => expect(await allowance()).toBe(200_000n), { timeout: 10_000, interval: 50 })
					await waitFor(() => expect(buttonByLabel('Add liquidity').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				}
				const previousLp = (await loadLiveBalances(read, market, account)).lp
				const beforeAdd = requests.length
				await act(() => buttonByLabel('Add liquidity').click())
				await waitFor(async () => expect((await loadLiveBalances(read, market, account)).lp).toBeGreaterThan(previousLp), { timeout: 10_000, interval: 50 })
				expect(requests).toHaveLength(beforeAdd + 1)
				expect(requests.at(-1)).toMatchObject({ functionName: 'addLiquidityWithCollateral' })
				expect(requests.at(-1)?.value ?? 0n).toBe(0n)
				await waitFor(() => expect(buttonByLabel('Remove').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				await act(() => buttonByLabel('Remove').click())
				await typeAmount('0.00000000000001')
				await waitFor(() => expect(buttonByLabel('Remove liquidity').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				const lpBeforeRemove = (await loadLiveBalances(read, market, account)).lp
				const beforeRemove = requests.length
				await act(() => buttonByLabel('Remove liquidity').click())
				await waitFor(async () => expect((await loadLiveBalances(read, market, account)).lp).toBeLessThan(lpBeforeRemove), { timeout: 10_000, interval: 50 })
				expect(requests).toHaveLength(beforeRemove + 1)
				expect(requests.at(-1)).toMatchObject({ functionName: 'removeLiquidity' })
				rendered.cleanup()
				rendered = undefined
				await clear()
				const ctx = await context(market)
				let bought = false
				rendered = await renderIntoDocument(
					<LivePositionControls
						market={market}
						nowSeconds={ctx.nowSeconds}
						settings={DEFAULT_TRADE_SETTINGS}
						fundingContext={ctx}
						ticket={positionTicket({
							amount: '0.01',
							submit: async estimate => {
								if (estimate?.kind !== 'entry') throw new Error('Missing entry estimate')
								const quote = await simulateEntry(client, configuration, market, account, 'YES', estimate.payAttoEth)
								const hash = await submitFreshEntry(client, configuration, account, quote, async write => await write())
								await read.waitForTransactionReceipt({ hash })
								bought = true
							},
						})}
						wallet={{ connected: true, networkMismatchReason: undefined, walletEthAttoEth: 10n ** 18n, walletEthState: 'ready', actionLabel: 'Connect wallet', connect: async () => undefined }}
						holdings={{ balances: ctx.balances, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }}
						externallyLocked={false}
					/>,
				)
				await waitFor(() => expect(approvalButton().disabled).toBe(false), { timeout: 10_000, interval: 50 })
				expect(buttonByLabel('Buy Yes').disabled).toBe(true)
				await act(() => approvalButton().click())
				await waitFor(() => expect(buttonByLabel('Buy Yes').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				const beforeBuy = await balance()
				await act(() => buttonByLabel('Buy Yes').click())
				await waitFor(() => expect(bought).toBe(true), { timeout: 10_000, interval: 50 })
				expect(requests.at(-1)).toMatchObject({ functionName: 'enterPositionWithCollateral' })
				expect(await balance()).toBeLessThan(beforeBuy)
				rendered.cleanup()
				rendered = undefined
				const sellContext = await context(market)
				let sold = false
				rendered = await renderIntoDocument(
					<LivePositionControls
						market={market}
						nowSeconds={sellContext.nowSeconds}
						settings={DEFAULT_TRADE_SETTINGS}
						fundingContext={sellContext}
						ticket={positionTicket({
							mode: 'exit',
							amount: '0.01',
							submit: async estimate => {
								if (estimate?.kind !== 'exit') throw new Error('Missing exit estimate')
								const quote = await simulateExit(client, configuration, market, account, 'YES', estimate.quote.completeSetShares)
								const hash = await submitFreshExit(client, configuration, account, quote, async write => await write())
								await read.waitForTransactionReceipt({ hash })
								sold = true
							},
						})}
						wallet={{ connected: true, networkMismatchReason: undefined, walletEthAttoEth: 10n ** 18n, walletEthState: 'ready', actionLabel: 'Connect wallet', connect: async () => undefined }}
						holdings={{ balances: sellContext.balances, balanceState: 'ready', balanceError: undefined, retry: async () => undefined }}
						externallyLocked={false}
					/>,
				)
				await waitFor(() => expect(buttonByLabel('Sell Yes').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				const beforeSell = await balance()
				const sellWrites = requests.length
				await act(() => buttonByLabel('Sell Yes').click())
				await waitFor(() => expect(sold).toBe(true), { timeout: 10_000, interval: 50 })
				expect(await balance()).toBeGreaterThan(beforeSell)
				expect(requests).toHaveLength(sellWrites + 1)
				expect(requests.at(-1)).toMatchObject({ functionName: 'safeBatchTransferFrom' })
				rendered.cleanup()
				rendered = undefined
				rendered = await renderIntoDocument(<LiveSettlementControls {...(await context(market))} />)
				await typeAmount('0.01')
				await waitFor(() => expect(buttonByLabel('Redeem complete sets').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				const beforeRedeem = await balance()
				await act(() => buttonByLabel('Redeem complete sets').click())
				await waitFor(async () => expect(await balance()).toBeGreaterThan(beforeRedeem), { timeout: 10_000, interval: 50 })
				expect(document.body.textContent).not.toContain('ETH to redeem')
				rendered.cleanup()
				rendered = undefined
				await clear()
				const empty = initial.markets.find(candidate => candidate.pair === undefined)
				if (empty === undefined) throw new Error('Missing uninitialized token market')
				rendered = await renderIntoDocument(<LiveLiquidityControls {...(await context(empty))} walletEthAttoEth={10n ** 18n} walletEthStatus='ready' />)
				await typeAmount('0.1')
				await waitFor(() => expect(approvalButton().disabled).toBe(false), { timeout: 10_000, interval: 50 })
				expect(buttonByLabel('Create market and add liquidity').disabled).toBe(true)
				await act(() => approvalButton().click())
				await waitFor(() => expect(buttonByLabel('Create market and add liquidity').disabled).toBe(false), { timeout: 10_000, interval: 50 })
				await act(() => buttonByLabel('Create market and add liquidity').click())
				await waitFor(
					async () => {
						const current = await discoverLiveUniverseMarketPage(read, configuration, 0n)
						expect(current.markets.find(candidate => candidate.pool === empty.pool)?.pair).toBeDefined()
					},
					{ timeout: 10_000, interval: 50 },
				)
				expect(requests.at(-1)).toMatchObject({ functionName: 'createPairAndInitializeWithCollateral' })
			} finally {
				rendered?.cleanup()
				restore()
				dom.cleanup()
			}
		}, 180_000)
	})
