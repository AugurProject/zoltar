import { describe, expect, test } from 'bun:test'
import { encodeDeployData, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getSecurityVault, redeemCompleteSet, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares, getRequestPriceCostAttoEth, requestPriceWithValue } from '../../testSupport/simulator/utils/contracts/statoblast'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: automatic aggregate underwriting', () => {
	const { fixture, deposit, mint, assets, fees, shares, custody, rebalance, positionCount } = useAggregatePortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const prepare = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
	}

	test('paid mint reserves aggregate backing and delivers every outcome without naming an underwriter', async () => {
		await prepare()
		await mint()
		const position = await getSecurityVault(fixture.owner(), pool(), await custody())
		expect(position.underwritingLimitAttoEth).toBe(100n * unit)
		expect(position.repBackingUnits).toBeGreaterThan(0n)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.vault)).repBackingUnits).toBe(0n)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.portfolio)).toEqual([0n, 0n, 0n])
		expect((await assets()) + (await fixture.repClaim(pool(), await custody()))).toBe(5_000n * unit)
	})

	test('two questions consume one reserve and cannot each spend its whole capacity', async () => {
		await deposit(500n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint(100n * unit)
		await mint(100n * unit, fixture.secondQuestionId)
		const before = await assets()
		await expect(mint(100n * unit)).rejects.toThrow()
		expect(await assets()).toBe(before)
		for (const [index, question] of [fixture.base.questionId, fixture.secondQuestionId].entries()) {
			const address = fixture.poolFor(question).securityPool
			const commitment = (await getSecurityVault(fixture.owner(), address, await custody(BigInt(index + 1)))).underwritingLimitAttoEth
			expect(commitment).toBe(await fixture.owner().readContract({ abi: poolArtifact.abi, address, functionName: 'settlementCollateralAttoEth' }))
			expect(commitment).toBeGreaterThan(99n * unit)
			expect(commitment).toBeLessThanOrEqual(100n * unit)
		}
	})

	test('selected open-position recovery releases backing for another question without a new deposit', async () => {
		await deposit(300n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		await expect(mint(100n * unit, fixture.secondQuestionId)).rejects.toThrow('Insufficient aggregate backing')
		await rebalance()
		expect(await assets()).toBe(300n * unit)
		await mint(100n * unit, fixture.secondQuestionId)
		expect((await getSecurityVault(fixture.owner(), pool(), await custody())).underwritingLimitAttoEth).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, await custody(2n))).underwritingLimitAttoEth).toBe(100n * unit)
		expect(await assets()).toBe(60n * unit)
	})

	test('registration alone never consumes the aggregate reserve', async () => {
		await prepare()
		const before = await assets()
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'addQuestion', args: [fixture.secondQuestionId] }))
		expect(await assets()).toBe(before)
		expect((await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, fixture.portfolio)).repBackingUnits).toBe(0n)
	})

	test('a stale or pending price cannot create new backing, while existing capacity remains usable', async () => {
		await prepare()
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await fixture.base.mockWindow.advanceTime(2n * DAY)
		await mint(20n * unit)
		await expect(mint(100n * unit)).rejects.toThrow()
		const cost = await getRequestPriceCostAttoEth(fixture.owner(), fixture.base.securityPoolAddresses.openOraclePriceCoordinator)
		await requestPriceWithValue(fixture.owner(), fixture.base.securityPoolAddresses.openOraclePriceCoordinator, cost, unit)
		await expect(mint(100n * unit)).rejects.toThrow()
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.portfolio)).repBackingUnits).toBe(0n)
	})

	test.each(['share minimum', 'nonreceiver recipient'])('a final mint failure (%s) rolls back backing, fees, and shares', async failure => {
		await prepare()
		const recipient = failure === 'share minimum' ? fixture.other().account.address : getRepTokenAddress(fixture.base.genesisUniverse)
		await expect(mint(100n * unit, fixture.base.questionId, 10n * unit, failure === 'share minimum' ? 101n * unit : 0n, recipient)).rejects.toThrow()
		expect(await assets()).toBe(5_000n * unit)
		expect(await fees()).toBe(0n)
		expect(await positionCount()).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), pool(), fixture.portfolio)).repBackingUnits).toBe(0n)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(0n)
	})

	test('ended questions and a forked universe reject new aggregate exposure', async () => {
		await prepare()
		const before = await shares()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await expect(mint()).rejects.toThrow('Question has already ended')
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await expect(mint(100n * unit, fixture.secondQuestionId)).rejects.toThrow('Universe already forked')
		expect(await shares()).toBe(before)
	})

	test('the question horizon remains inclusive at its boundary and rejects expired minting', async () => {
		const { base, owner } = fixture
		await base.mockWindow.setTime(base.questionData.endTime - 29n * DAY)
		const hash = await owner().sendTransaction({ data: encodeDeployData({ abi: portfolioArtifact.abi, bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object), args: [getInfraContractAddresses().securityPoolFactory, pool(), 30n * DAY] }) })
		const receipt = await owner().waitForTransactionReceipt({ hash })
		const portfolio: Address | undefined = receipt.contractAddress
		if (!portfolio) throw new Error('Missing horizon portfolio')
		const endTime = (await base.mockWindow.getTime()) + 31n * DAY
		const question = makeQuestion('Aggregate horizon boundary', endTime)
		await createQuestion(owner(), question, base.outcomes)
		const questionId = getQuestionId(question, base.outcomes)
		const register = () => writeContractAndWait(owner(), () => owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))
		await base.mockWindow.setTime(endTime - 30n * DAY - 2n)
		await expect(register()).rejects.toThrow('Question exceeds pool horizon')
		await base.mockWindow.setTime(endTime - 30n * DAY - 1n)
		await register()
		await base.mockWindow.setTime(endTime)
		await expect(writeContractAndWait(owner(), () => owner().writeContract({ abi: aggregatePortfolioAbi, address: portfolio, functionName: 'createCompleteSet', args: [questionId, owner().account.address, 0n, unit], value: unit }))).rejects.toThrow('Question has already ended')
	})
})
