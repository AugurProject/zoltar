import { describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getZoltarAddress, getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { openOracleSettle } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('collateral-independent outcome disputes', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const prepare = async () => {
		const owner = fixture.owner()
		const other = fixture.other()
		const collateral = await deployContract(
			owner,
			encodeDeployData({
				abi: tokenArtifact.abi,
				bytecode: applyLibraries(tokenArtifact.evm.bytecode.object),
				args: [18],
			}),
		)
		const token = { abi: tokenArtifact.abi, address: collateral }
		const portfolio = await fixture.deployPortfolio(undefined, undefined, {
			collateralToken: collateral,
		})
		const target = { abi: portfolioArtifact.abi, address: portfolio }
		await fixture.register(fixture.base.questionId, portfolio)
		for (const recipient of [owner.account.address, other.account.address]) {
			await writeContractAndWait(owner, () =>
				owner.writeContract({
					...token,
					functionName: 'mint',
					args: [recipient, 10_000n * unit],
				}),
			)
		}
		await fixture.deposit(1_000n * unit, owner, portfolio)
		const feed = {
			abi: feedArtifact.abi,
			address: await owner.readContract({
				...target,
				functionName: 'priceFeed',
				args: [fixture.base.genesisUniverse],
			}),
		}
		await approveToken(owner, collateral, feed.address)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed.address)
		const bounty = await owner.readContract({
			...feed,
			functionName: 'getRequestPriceCostAttoEth',
		})
		await writeContractAndWait(owner, () =>
			owner.writeContract({
				...feed,
				functionName: 'requestPortfolioPrice',
				args: [unit, 500n * unit, bounty],
				value: bounty,
			}),
		)
		const report = await owner.readContract({
			...feed,
			functionName: 'pendingReportId',
		})
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		await fixture.authorize(200n * unit, owner, portfolio)
		await fixture.mint(100n * unit, fixture.base.questionId, {
			namespace: portfolio,
		})
		const pool = {
			abi: poolArtifact.abi,
			address: fixture.poolFor(fixture.base.questionId, undefined, undefined, portfolio).securityPool,
		}
		return { owner, other, token, portfolio, target, pool, feed }
	}
	for (const mode of ['paused', 'blocked burn address'] as const) {
		test(`#1336 permits a REP dispute with ${mode}`, async () => {
			const { owner, other, token, portfolio, target, pool } = await prepare()
			await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
			for (const reporter of [owner, other]) await approveToken(reporter, getRepTokenAddress(fixture.base.genesisUniverse), pool.address)
			await writeContractAndWait(owner, () =>
				owner.writeContract({
					...pool,
					functionName: 'depositWalletRepToEscalationGame',
					args: [2, 100n * unit],
				}),
			)
			await other.simulateContract({
				...pool,
				functionName: 'depositWalletRepToEscalationGame',
				args: [1, 300n * unit],
			})
			if (mode === 'paused')
				await writeContractAndWait(owner, () =>
					owner.writeContract({
						...token,
						functionName: 'setPaused',
						args: [true],
					}),
				)
			else
				await writeContractAndWait(owner, () =>
					owner.writeContract({
						...token,
						functionName: 'setBlocked',
						args: ['0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', true],
					}),
				)
			await fixture.base.mockWindow.advanceTime(3_600n)
			await writeContractAndWait(other, () =>
				other.writeContract({
					...pool,
					functionName: 'depositWalletRepToEscalationGame',
					args: [1, 300n * unit],
				}),
			)
			const capital = {
				abi: capitalArtifact.abi,
				address: await owner.readContract({
					...target,
					functionName: 'capitalLedger',
					args: [fixture.base.genesisUniverse],
				}),
			}
			// The same checkpoint must keep REP-only provider funding available (#1337).
			await fixture.deposit(unit, owner, portfolio)
			if (mode === 'paused')
				await writeContractAndWait(owner, () =>
					owner.writeContract({
						...token,
						functionName: 'setPaused',
						args: [false],
					}),
				)
			else
				await writeContractAndWait(owner, () =>
					owner.writeContract({
						...token,
						functionName: 'setBlocked',
						args: ['0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF', false],
					}),
				)
			const before = await owner.readContract({
				...token,
				functionName: 'balanceOf',
				args: [owner.account.address],
			})
			await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'claimEarnings', args: [owner.account.address] }))
			expect(
				await owner.readContract({
					...token,
					functionName: 'balanceOf',
					args: [owner.account.address],
				}),
			).toBeGreaterThan(before)
		})
	}
	test('#1337 quarantines collateral burns without blocking REP checkpoints', async () => {
		const { owner, other, token, target, portfolio, feed } = await prepare()
		const capital = { abi: capitalArtifact.abi, address: await owner.readContract({ ...target, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] }) }
		const bounty = await owner.readContract({ ...feed, functionName: 'getRequestPriceCostAttoEth' })
		await writeContractAndWait(owner, () => owner.writeContract({ ...feed, functionName: 'requestPortfolioPrice', args: [4n * unit, 500n * unit, bounty], value: bounty }))
		const report = await owner.readContract({ ...feed, functionName: 'pendingReportId' })
		await fixture.base.mockWindow.advanceTime(481n)
		await openOracleSettle(owner, report)
		const burn = '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF'
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'setBlocked', args: [burn, true] }))
		await fixture.base.mockWindow.advanceTime(86_401n)
		await expect(fixture.deposit(unit, owner, portfolio)).rejects.toThrow('Position is liquidating')
		// An idle provider can checkpoint the deferred burn without curing the liquidating owner.
		await fixture.deposit(unit, other, portfolio)
		const pending = await owner.readContract({ ...capital, functionName: 'pendingBurnCash' })
		expect(pending).toBeGreaterThan(0n)
		await expect(owner.simulateContract({ ...capital, functionName: 'flushBurn' })).rejects.toThrow('SafeERC20Ops token call reverted')
		expect(await owner.readContract({ ...capital, functionName: 'pendingBurnCash' })).toBe(pending)
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'setBlocked', args: [burn, false] }))
		const before = await owner.readContract({ ...token, functionName: 'balanceOf', args: [burn] })
		await writeContractAndWait(owner, () => owner.writeContract({ ...capital, functionName: 'flushBurn' }))
		expect(await owner.readContract({ ...capital, functionName: 'pendingBurnCash' })).toBe(0n)
		expect(await owner.readContract({ ...token, functionName: 'balanceOf', args: [burn] })).toBeGreaterThan(before)
	})
	test('#1337 a collateral pause cannot block fork freeze or provider choice', async () => {
		const { owner, token, target } = await prepare()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.base.questionId)
		await writeContractAndWait(owner, () => owner.writeContract({ ...token, functionName: 'setPaused', args: [true] }))
		const forks = { abi: forkArtifact.abi, address: await owner.readContract({ ...target, functionName: 'forkController' }) }
		await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'freeze', args: [fixture.base.genesisUniverse] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...forks, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const [outcome, chosen] = await owner.readContract({ ...forks, functionName: 'choices', args: [fixture.base.genesisUniverse, owner.account.address] })
		expect(outcome).toBe(1n)
		expect(chosen).toBe(true)
		const capital = await owner.readContract({ ...target, functionName: 'capitalLedger', args: [fixture.base.genesisUniverse] })
		expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'exported', args: [owner.account.address] })).toBe(true)
	})
})
