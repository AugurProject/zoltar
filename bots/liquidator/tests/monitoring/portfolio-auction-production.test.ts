import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, createRpcEndpointPool, privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import { paddedTransactionGas } from '@zoltar/bot-shared/execution/transaction-submission'
import { securityPoolCapitalLedgerAbi as capitalAbi, erc20Abi } from '@zoltar/bot-shared/contracts/abi'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioTruthAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioTruthAuctionFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { getZoltarAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { createWriteClient, writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioTarget } from '../../src/monitoring/portfolio-auction.ts'
import { executePortfolioCure, executePortfolioEarnings, simulatePortfolioCureReward } from '../../src/execution/portfolio-cure.ts'
import { executePortfolioTakeover, PortfolioOpportunityExpired } from '../../src/execution/portfolio-executor.ts'
import { settleInterruptedCycle } from '../../src/runtime/scan-cycle.ts'
import { initialRuntimeState } from '../../src/state/operator-state.ts'
import { portfolioSettings } from '../support/portfolio-observation.ts'

describe('portfolio operator funded auction capital integration', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test('a minimally funded keeper authenticates lazy winners, cures and collects rewards with bounded gas', async () => {
		const context = await preparePortfolioTruthAuction(fixture)
		await context.report()
		await context.open()
		// Set purchased collateral explicitly so the later price makes these
		// positions distressed, independently of the shared bidding helper default.
		const first = await context.bid(context.owner, 2n, (35n * unit) / 10n)
		const second = await context.bid(context.other, 3n, (35n * unit) / 10n)
		await context.closingQuote()
		await context.finalize()
		const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
		await context.mock.setBalance(account.address, unit / 50n)
		const reader = createPublicClient({ chain: mainnet, transport: custom(context.mock) })
		const wallet = createWalletClient({ account, chain: mainnet, transport: custom(context.mock) })
		const settings = portfolioSettings()
		const scope = { address: fixture.portfolio, universeId: context.child, nextPositionId: 1n, sweepEnd: 0n }
		settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
		settings.deployment.zoltar = getZoltarAddress()
		settings.deployment.multicall3 = getInfraContractAddresses().multicall3
		settings.selectedPortfolios = [scope]
		settings.approvedUniverses = [context.child]
		const initial = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const virtual = initial.positions.filter(position => position.auctionTarget !== undefined)
		expect(virtual.map(position => position.auctionTarget?.bidId)).toEqual([first.id, second.id])
		const cohort = await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionCohort' })
		expect(initial.positions.filter(position => position.auctionTarget === undefined).some(position => position.id === cohort[1])).toBe(false)
		expect(virtual[0]).toMatchObject({ rep: (await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })).principal })
		await context.report(3n * unit)
		const observation = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
		const target = observation.positions.find(position => position.auctionTarget?.bidId === first.id)
		if (target === undefined) throw new Error('Missing authenticated auction target')
		expect(target.maxHealthyPrice).toBeLessThan(observation.snapshot.liquidationPrice)
		const directory = await mkdtemp(join(tmpdir(), 'auction-keeper-production-'))
		const estimates: bigint[] = []
		const estimateRequests: unknown[] = []
		const simulationRequests: unknown[] = []
		const quoteRequests: unknown[] = []
		const estimateOverrides: unknown[] = []
		const simulationOverrides: unknown[] = []
		const quoteOverrides: unknown[] = []
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			async fetch(request) {
				const body: unknown = await request.json()
				if (typeof body !== 'object' || body === null || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params) || !('id' in body)) throw new Error('Invalid RPC fixture request')
				try {
					const result = await context.mock.request({ method: body.method, params: body.params })
					if (body.method === 'eth_estimateGas' && typeof result === 'string') {
						estimates.push(BigInt(result))
						estimateRequests.push(body.params[0])
						estimateOverrides.push(body.params[2])
					}
					const transaction: unknown = body.params[0]
					if (body.method === 'eth_call' && typeof transaction === 'object' && transaction !== null && 'to' in transaction && typeof transaction.to === 'string') {
						if ('gas' in transaction && transaction.to.toLowerCase() === context.capital.toLowerCase()) {
							simulationRequests.push(transaction)
							simulationOverrides.push(body.params[2])
						}
						if (transaction.to.toLowerCase() === settings.deployment.multicall3.toLowerCase()) {
							quoteRequests.push(transaction)
							quoteOverrides.push(body.params[2])
						}
					}
					if (body.method === 'eth_sendRawTransaction') await context.mock.request({ method: 'anvil_mine', params: ['0xc'] })
					return Response.json({ jsonrpc: '2.0', id: body.id, result })
				} catch (error) {
					return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
				}
			},
		})
		const endpoint = `http://127.0.0.1:${server.port}`
		settings.connectivity.readRpcUrl = endpoint
		settings.connectivity.quorumRpcUrls = []
		settings.connectivity.publicRpcUrls = [endpoint]
		settings.connectivity.rpcQuorum = 1
		settings.runtime.execute = true
		settings.runtime.pollMilliseconds = 100
		settings.runtime.stateFile = join(directory, 'state.json')
		settings.strategy.maximumGasCostAttoEth = unit / 200n
		settings.portfolioPolicy.minimumNetRewardAttoEth = 0n
		expect(observation.walletAttoEth).toBe(2n * settings.strategy.maximumGasCostAttoEth + settings.portfolioPolicy.walletReserveAttoEth)
		const pool = createRpcEndpointPool([endpoint])
		const state = initialRuntimeState(false, account.address, 1)
		state.portfolioScopes = [scope]
		try {
			const canonicalMulticall = settings.deployment.multicall3
			settings.deployment.multicall3 = context.capital
			await expect(simulatePortfolioCureReward(wallet, settings, pool, observation, portfolioTarget(target))).rejects.toThrow('runtime')
			settings.deployment.multicall3 = canonicalMulticall
			const quote = await simulatePortfolioCureReward(wallet, settings, pool, observation, portfolioTarget(target))
			expect(quote.removed).toBe(unit)
			expect((quote.reward * unit) / observation.snapshot.liquidationPrice).toBeGreaterThanOrEqual(2n * settings.strategy.maximumGasCostAttoEth)
			// No simulation may materialize or debit the real winning vault.
			expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })).materialized).toBe(false)
			await executePortfolioCure(wallet, settings, state, pool, observation, portfolioTarget(target), async () => true)
			const confirmed = state.activities.find(activity => activity.status === 'confirmed')
			if (confirmed?.hash === undefined) throw new Error('Auction cure was not confirmed')
			const receipt = await reader.waitForTransactionReceipt({ hash: confirmed.hash })
			const transaction = await reader.getTransaction({ hash: confirmed.hash })
			const estimate = estimates.at(-1)
			if (estimate === undefined) throw new Error('Cure gas was not estimated')
			expect(transaction.gas).toBe(paddedTransactionGas(estimate))
			const signedFees = { maxFeePerGas: `0x${transaction.maxFeePerGas?.toString(16)}`, maxPriorityFeePerGas: `0x${transaction.maxPriorityFeePerGas?.toString(16)}` }
			expect(estimateRequests.at(-1)).toMatchObject(signedFees)
			expect(simulationRequests.at(-1)).toMatchObject(signedFees)
			expect(quoteRequests.at(-1)).toMatchObject(signedFees)
			expect(quoteRequests.at(-1)).toMatchObject({ gas: '0x1000000' })
			const balanceOverride = { [account.address]: { balance: '0x100000000000000000000000000000000' } }
			expect(quoteOverrides.at(-1)).toEqual(balanceOverride)
			expect(estimateOverrides.at(-1)).toEqual(balanceOverride)
			expect(simulationOverrides.at(-1)).toBeUndefined()
			expect(transaction.gas).toBeLessThanOrEqual(16_777_216n)
			expect(receipt.status).toBe('success')
			const realized = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })
			expect(realized.materialized).toBe(true)
			expect(realized.commitment).toBe(unit)
			expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [second.id] })).materialized).toBe(false)
			const earned = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'storedOwnerAccount', args: [account.address] })
			expect(earned.feesAttoRep).toBeGreaterThanOrEqual(quote.reward)
			await executePortfolioEarnings(wallet, settings, state, pool, observation, async () => true)
			expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'storedOwnerAccount', args: [account.address] })).feesAttoRep).toBe(0n)
			expect(await reader.readContract({ address: context.token, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] })).toBe(earned.feesAttoRep)
			expect(await reader.getBalance({ address: account.address })).toBeLessThan(observation.walletAttoEth)
			expect(state.pendingTransactions).toHaveLength(0)
			expect(state.paused).toBe(false)
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ auctionKeeperCureGas: { estimate, signed: transaction.gas, used: receipt.gasUsed, reward: earned.feesAttoRep } })
			// The second winner remains virtual until a real funded acquisition.
			await context.mock.setBalance(account.address, 100n * unit)
			// Retire chosen capital down to claim demand so cure cannot change K.
			await context.report(unit)
			const chosen = await context.owner.readContract({ address: context.capital, abi: capitalAbi, functionName: 'ownerAccount', args: [context.owner.account.address] })
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'requestRetirement', args: [chosen.positionId, 6n * unit] }))
			await context.report(2n * unit)
			await context.mock.advanceTime(3601n)
			await context.report(2n * unit)
			await context.mock.impersonateAccount(account.address)
			const keeper = createWriteClient(context.mock, BigInt(account.address))
			await writeContractAndWait(keeper, () => keeper.writeContract({ address: context.capital, abi: capitalAbi, functionName: 'setHealthTarget', args: [15_000n] }))
			await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.token, abi: erc20Abi, functionName: 'transfer', args: [account.address, 20n * unit] }))
			settings.strategy.maximumGasCostAttoEth = unit / 50n
			const next = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
			const winner = next.positions.find(position => position.auctionTarget?.bidId === second.id)
			if (winner === undefined) throw new Error('Second auction target disappeared')
			expect(next.snapshot.totalCommitmentAttoEth).toBe(next.snapshot.demandAttoEth)
			for (let step = 0; step < 3; step++) {
				const before = state.activities.filter(activity => activity.status === 'confirmed').length
				await executePortfolioTakeover(wallet, settings, state, pool, next, portfolioTarget(winner), async () => true)
				expect(state.activities.filter(activity => activity.status === 'confirmed')).toHaveLength(before + 1)
				const after = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [second.id] })
				expect(after.materialized).toBe(step === 2)
			}
			const taken = await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'ownerCollateral', args: [account.address] })
			expect(taken[1]).toBe(3n * unit)
			const acquisition = state.activities.find(activity => activity.status === 'confirmed')
			if (acquisition?.hash === undefined) throw new Error('Takeover was not confirmed')
			const acquiredTransaction = await reader.getTransaction({ hash: acquisition.hash })
			const acquiredReceipt = await reader.waitForTransactionReceipt({ hash: acquisition.hash })
			const acquisitionEstimate = estimates.at(-1)
			if (acquisitionEstimate === undefined) throw new Error('Takeover gas estimate missing')
			expect(acquiredTransaction.gas).toBe(paddedTransactionGas(acquisitionEstimate))
			expect(acquiredTransaction.gas).toBeLessThanOrEqual(16_777_216n)
			expect(acquiredReceipt.status).toBe('success')
			if (process.env['COMMITMENT_REPORT_GAS'] === '1') console.log({ auctionKeeperTakeoverGas: { estimate: estimates.at(-1), signed: acquiredTransaction.gas, used: acquiredReceipt.gasUsed } })
		} finally {
			await server.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	})
})

describe('portfolio auction cure with a small operator gas budget', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })

	for (const enoughQuoteGas of [true, false])
		test(enoughQuoteGas ? 'skips an over-budget funded cure before signing without pausing the operator' : 'skips a cure whose reward quote exceeds wallet gas capacity without pausing', async () => {
			const context = await preparePortfolioTruthAuction(fixture)
			await context.report()
			await context.open()
			const first = await context.bid(context.owner, 2n, (35n * unit) / 10n)
			await context.bid(context.other, 3n, (35n * unit) / 10n)
			await context.closingQuote()
			await context.finalize()
			await context.report(3n * unit)
			const account = privateKeyToAccount(`0x${'01'.repeat(32)}`)
			await context.mock.setBalance(account.address, enoughQuoteGas ? 100n * unit : unit / 100n + 4n)
			if (!enoughQuoteGas) {
				await context.mock.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x2540be400'] })
				await context.mock.request({ method: 'anvil_mine', params: ['0x1'] })
			}
			const reader = createPublicClient({ chain: mainnet, transport: custom(context.mock) })
			const wallet = createWalletClient({ account, chain: mainnet, transport: custom(context.mock) })
			const settings = portfolioSettings()
			const scope = { address: fixture.portfolio, universeId: context.child, nextPositionId: 1n, sweepEnd: 0n }
			settings.deployment.securityPoolFactory = getInfraContractAddresses().securityPoolFactory
			settings.deployment.zoltar = getZoltarAddress()
			settings.deployment.multicall3 = getInfraContractAddresses().multicall3
			settings.selectedPortfolios = [scope]
			settings.approvedUniverses = [context.child]
			const observation = await loadPortfolioObservation(reader, settings, account.address, scope, await reader.getBlockNumber())
			const target = observation.positions.find(position => position.auctionTarget?.bidId === first.id)
			if (target === undefined) throw new Error('Missing authenticated auction target')
			const directory = await mkdtemp(join(tmpdir(), 'auction-keeper-small-budget-'))
			const submitted: unknown[] = []
			const server = Bun.serve({
				hostname: '127.0.0.1',
				port: 0,
				async fetch(request) {
					const body: unknown = await request.json()
					if (typeof body !== 'object' || body === null || !('method' in body) || typeof body.method !== 'string' || !('params' in body) || !Array.isArray(body.params) || !('id' in body)) throw new Error('Invalid RPC fixture request')
					try {
						if (body.method === 'eth_sendRawTransaction') submitted.push(body.params)
						return Response.json({ jsonrpc: '2.0', id: body.id, result: await context.mock.request({ method: body.method, params: body.params }) })
					} catch (error) {
						return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } })
					}
				},
			})
			const endpoint = `http://127.0.0.1:${server.port}`
			settings.connectivity = { readRpcUrl: endpoint, quorumRpcUrls: [], publicRpcUrls: [endpoint], rpcQuorum: 1 }
			settings.runtime.execute = true
			settings.runtime.once = false
			settings.runtime.stateFile = join(directory, 'state.json')
			settings.strategy.maximumGasCostAttoEth = 2n
			settings.portfolioPolicy.minimumNetRewardAttoEth = 0n
			settings.paused = false
			const pool = createRpcEndpointPool([endpoint])
			const state = initialRuntimeState(false, account.address, 1)
			state.portfolioScopes = [scope]
			try {
				// The target funds its cure from REP; the keeper still must afford gas.
				const quote = await simulatePortfolioCureReward(wallet, settings, pool, observation, portfolioTarget(target))
				expect(quote.removed).toBe(unit)
				expect(quote.reward).toBeGreaterThan(4n)
				const error: unknown = await executePortfolioCure(wallet, settings, state, pool, observation, portfolioTarget(target), async () => true).then(
					() => undefined,
					error => error,
				)
				expect(error).toBeInstanceOf(PortfolioOpportunityExpired)
				expect(error instanceof Error ? error.message : '').toBe('Estimated cure gas exceeds the configured budget')
				expect(await settleInterruptedCycle({ settings }, { state, shutdown: { isRequested: () => false } }, error)).toBe(false)
				expect(state.pendingTransactions).toHaveLength(0)
				expect(state.activities.some(activity => activity.status === 'pending')).toBe(false)
				expect(state.paused).toBe(false)
				expect(settings.paused).toBe(false)
				expect(submitted).toHaveLength(0)
				expect(await reader.getBalance({ address: account.address })).toBe(observation.walletAttoEth)
				expect((await reader.readContract({ address: context.capital, abi: capitalAbi, functionName: 'auctionPosition', args: [first.id] })).materialized).toBe(false)
			} finally {
				await server.stop(true)
				await rm(directory, { recursive: true, force: true })
			}
		})
})
