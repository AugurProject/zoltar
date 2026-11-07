import { describe, expect, test } from 'bun:test'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { sharedPoolPriceFeedAbi, securityPoolPortfolioAbi } from '@zoltar/bot-shared/contracts/abi'
import { canonicalSecurityPoolFactory, networkConfiguration } from '#config/network'
import { parseOperatorSettings } from '#config/settings-store'
import { discoverStoredReports } from '#monitoring/report-index'
import { discoverCoordinatorPolicies } from '#monitoring/coordinator-discovery'
import { pendingCoordinatorReports } from '#execution/recovery-support'
import example from '../../config/operator.example.json'
import { useSecurityPoolPortfolioFixture, unit } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioFixture'
import { preparePortfolioTruthAuction } from '../../../../solidity/ts/tests/statoblast/securityPoolPortfolioTruthAuctionFixture'
import { getInfraContractAddresses } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../../../solidity/ts/testSupport/simulator/utils/clients'
import { approveToken } from '../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { openOracleSettle, wrapWeth } from '../../../../solidity/ts/testSupport/simulator/utils/contracts/statoblast'

describe('native portfolio report discovery', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	for (const branch of ['origin', 'child'] as const)
		test(`indexes concurrent ${branch} reports without question adapters and removes settled reports`, async () => {
			const context = await (async () => {
				if (branch === 'child') {
					const child = await preparePortfolioTruthAuction(fixture)
					expect(await child.owner.getCode({ address: fixture.poolFor(fixture.base.questionId, child.child, fixture.poolFor(fixture.base.questionId).securityPool).securityPool })).toBeUndefined()
					return { owner: child.owner, mock: child.mock, feed: child.feed, universeId: child.child }
				}
				const portfolio = await fixture.deployPortfolio()
				const owner = fixture.owner()
				expect(await owner.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'questionCount' })).toBe(0n)
				const feed = await owner.readContract({ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
				const weth = await owner.readContract({ address: feed, abi: sharedPoolPriceFeedAbi, functionName: 'weth' })
				await wrapWeth(owner, 100n * unit)
				await approveToken(owner, weth, feed)
				await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
				return { owner, mock: fixture.base.mockWindow, feed, universeId: fixture.base.genesisUniverse }
			})()
			const network = { ...networkConfiguration('mainnet'), multicall3: getInfraContractAddresses().multicall3 }
			// The fixture deploys current bytecode at deterministic addresses, while the
			// mainnet manifest names the release deployment. Redirect only that address;
			// all code, registry and report reads still execute against the native chain.
			const factory = canonicalSecurityPoolFactory('mainnet').toLowerCase()
			const client = createPublicClient({
				chain: network.chain,
				transport: custom({
					request: ({ method, params }) =>
						context.mock.request({
							method,
							params: Array.isArray(params)
								? params.map(value => {
										if (typeof value === 'string' && value.toLowerCase() === factory) return getInfraContractAddresses().securityPoolFactory
										if (typeof value === 'object' && value !== null && 'to' in value && typeof value.to === 'string' && value.to.toLowerCase() === factory) return { ...value, to: getInfraContractAddresses().securityPoolFactory }
										return value
									})
								: params,
						}),
				}),
			})
			const settings = parseOperatorSettings({ ...example, approvedUniverses: [context.universeId.toString()] })
			const config = { network, openOracle: getInfraContractAddresses().openOracle, operatorSettings: settings, execute: true, connectivity: settings.connectivity, quorumRpcUrls: [], rpcQuorum: 1 as const }
			const request = async () => {
				const bounty = await context.owner.readContract({ address: context.feed, abi: sharedPoolPriceFeedAbi, functionName: 'getRequestPriceCostAttoEth' })
				await writeContractAndWait(context.owner, () => context.owner.writeContract({ address: context.feed, abi: sharedPoolPriceFeedAbi, functionName: 'requestPortfolioPrice', args: [unit, 10n * unit, bounty], value: bounty }))
				return context.owner.readContract({ address: context.feed, abi: sharedPoolPriceFeedAbi, functionName: 'pendingReportId' })
			}
			const first = await request()
			const second = await request()
			expect(second).not.toBe(first)
			const block = await client.getBlock()
			if (block.number === undefined || block.hash === undefined) throw new Error('Missing canonical report block')
			const indexed = await discoverStoredReports([client], config, block.number, block.hash)
			expect(indexed.reports.map(report => report.reportId)).toEqual(expect.arrayContaining([first, second]))
			const policies = await discoverCoordinatorPolicies([client], config, block.number, block.hash, [], indexed.reports)
			expect(policies).toHaveLength(1)
			expect(policies[0]?.coordinator.toLowerCase()).toBe(context.feed.toLowerCase())
			const reports = await pendingCoordinatorReports(client, { ...config, coordinatorAddresses: [context.feed] }, block.number, policies)
			expect(reports.map(report => report.helper.reportId).sort()).toEqual([first, second].sort())
			expect(new Set(reports.map(report => report.helper.creator)).size).toBe(2)
			await context.mock.advanceTime(481n)
			await openOracleSettle(context.owner, first)
			const settledBlock = await client.getBlock()
			if (settledBlock.number === undefined || settledBlock.hash === undefined) throw new Error('Missing canonical settlement block')
			const remaining = await discoverStoredReports([client], config, settledBlock.number, settledBlock.hash, indexed.cursor)
			expect(remaining.reports.map(report => report.reportId)).not.toContain(first)
			expect(remaining.reports.map(report => report.reportId)).toContain(second)
			const retained = await discoverStoredReports([client], config, settledBlock.number, settledBlock.hash, remaining.cursor, [first])
			expect(retained.reports.map(report => report.reportId)).toContain(first)
			const unapproved = { ...config, operatorSettings: { ...settings, approvedUniverses: [context.universeId + 1n] } }
			expect(await discoverCoordinatorPolicies([client], unapproved, settledBlock.number, settledBlock.hash, [], remaining.reports)).toEqual([])
		}, 300_000)
})
