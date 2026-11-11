import { describe, expect, test } from 'bun:test'
import { encodeDeployData } from '@zoltar/core-shared/evm/ethereum'
import {
	test_statoblast_CollateralTestToken_CollateralTestToken as tokenArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	trading_TwoWayConstantProductFactory_TwoWayConstantProductFactory as factoryArtifact,
	trading_TwoWayConstantProductRouter_TwoWayConstantProductRouter as routerArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { deployChild, forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { openOracleSettle } from '../../testSupport/simulator/utils/contracts/statoblast'
import { portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('ERC20 portfolio collateral', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test('rejects canonical REP collateral before deploying an unusable portfolio', async () => {
		await expect(fixture.deployPortfolio(undefined, undefined, { collateralToken: getRepTokenAddress(fixture.base.genesisUniverse) })).rejects.toThrow('REP cannot be portfolio collateral')
	})

	test('rejects a different existing child REP token as collateral', async () => {
		const owner = fixture.owner()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.base.questionId)
		await deployChild(owner, fixture.base.genesisUniverse, 1n)
		await deployChild(owner, fixture.base.genesisUniverse, 2n)
		const origin = getChildUniverseId(fixture.base.genesisUniverse, 1)
		const collateralUniverse = getChildUniverseId(fixture.base.genesisUniverse, 2)
		await expect(fixture.deployPortfolio(undefined, undefined, { universeId: origin, collateralToken: getRepTokenAddress(collateralUniverse) })).rejects.toThrow('REP cannot be portfolio collateral')
	})

	for (const noReturn of [false, true])
		test(`six-decimal collateral funds direct reports and round trips (no-return ${noReturn})`, async () => {
			const owner = fixture.owner()
			const buyer = fixture.other()
			const token = await deployContract(owner, encodeDeployData({ abi: tokenArtifact.abi, bytecode: applyLibraries(tokenArtifact.evm.bytecode.object), args: [6, noReturn] }))
			const floor = 10_000n
			const portfolio = await fixture.deployPortfolio(undefined, { ...portfolioEconomics, minimumCommitmentAttoEth: 1_000_000n, minimumPurchaseFeeAttoEth: 100n }, { collateralToken: token, minimumReportCollateral: floor })
			await fixture.register(fixture.base.questionId, portfolio)
			for (const recipient of [owner.account.address, buyer.account.address]) await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'mint', args: [recipient, 1_000_000_000n] }))
			await fixture.deposit(1_000n * unit, owner, portfolio)
			const feed = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'priceFeed', args: [fixture.base.genesisUniverse] })
			expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'collateralToken' })).toBe(token)
			expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })).toBe(floor)
			await approveToken(owner, token, feed)
			await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), feed)
			const bounty = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'getRequestPriceCostAttoEth' })
			const price = 10n ** 30n // 1 REP per whole six-decimal token, scaled raw-unit ratio.
			await writeContractAndWait(owner, () => owner.writeContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPortfolioPrice', args: [price, 2_000_000n + floor, bounty], value: bounty }))
			const report = await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'pendingReportId' })
			await fixture.base.mockWindow.advanceTime(481n)
			await openOracleSettle(owner, report)
			expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'lastPrice' })).toBe(price)
			await fixture.authorize(100_000_000n, owner, portfolio)
			expect(await owner.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })).toBe(floor + 1_000_000n)
			const cash = 10_000_000n
			const quote = await buyer.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'purchaseQuote', args: [fixture.base.genesisUniverse, fixture.base.questionId, cash] })
			const balance = () => buyer.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [buyer.account.address] })
			const before = await balance()
			await fixture.mint(cash, fixture.base.questionId, { namespace: portfolio, budget: quote[0] })
			expect(before - (await balance())).toBe(cash + quote[0])
			const pool = fixture.poolFor(fixture.base.questionId, undefined, undefined, portfolio).securityPool
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [100n] }))
			await expect(writeContractAndWait(buyer, () => buyer.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [cash] }))).rejects.toThrow('Collateral transfer amount mismatch')
			expect(await balance()).toBe(before - cash - quote[0])
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [0n] }))
			await writeContractAndWait(buyer, () => buyer.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'redeemCompleteSet', args: [cash] }))
			expect(await balance()).toBe(before - quote[0])
			const factory = await deployContract(owner, encodeDeployData({ abi: factoryArtifact.abi, bytecode: applyLibraries(factoryArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolFactory, 30n] }))
			const router = await deployContract(owner, encodeDeployData({ abi: routerArtifact.abi, bytecode: applyLibraries(routerArtifact.evm.bytecode.object), args: [factory] }))
			await approveToken(buyer, token, router)
			await writeContractAndWait(buyer, () => buyer.writeContract({ abi: routerArtifact.abi, address: router, functionName: 'createPairAndInitializeWithCollateral', args: [pool, cash, 5_000n, 1n, buyer.account.address, fixture.base.questionData.endTime - 1n, 2n * cash] }))
			expect(await buyer.readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [router] })).toBe(0n)
			expect(await buyer.getBalance({ address: router })).toBe(0n)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: tokenArtifact.abi, address: token, functionName: 'setFee', args: [100n] }))
			const taxedBalance = await balance()
			await expect(fixture.mint(cash, fixture.base.questionId, { namespace: portfolio })).rejects.toThrow('Collateral transfer amount mismatch')
			expect(await balance()).toBe(taxedBalance)
		})
})
