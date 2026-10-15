import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { ReputationToken_ReputationToken as repArtifact, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: bounded aggregate position retirement', () => {
	const { fixture, deposit, mint, assets, fees, shares, withdraw, sync, claim } = useAggregatePortfolioFixture()
	const position = (positionId: bigint) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'frozenPositions', args: [positionId] })
	const ownerShares = (positionId: bigint, owner = fixture.owner().account.address) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'getOwnerPositionShares', args: [positionId, owner] })
	const activeQuestions = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'getActiveQuestions' })
	const redeemNativeFees = (questionId: bigint, account: `0x${string}`) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: fixture.poolFor(questionId).securityPool, functionName: 'redeemFees', args: [account] }))

	test('a seventeenth small question retires a position and the same question can reopen for a new cohort', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint(unit)
		for (let index = 1; index <= 16; index++) {
			const question = makeQuestion(`Aggregate retirement question ${index}`, fixture.base.questionData.endTime)
			await createQuestion(fixture.owner(), question, fixture.base.outcomes)
			const questionId = getQuestionId(question, fixture.base.outcomes)
			await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'addQuestion', args: [questionId] }))
			await mint(unit, questionId)
		}
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'frozenPositionCount' })).toBe(1n)
		expect((await activeQuestions()).length).toBe(16)
		const [retiredQuestion, , , originalCustody] = await position(1n)
		const pool = fixture.poolFor(retiredQuestion).securityPool
		expect(await activeQuestions()).not.toContain(retiredQuestion)
		expect((await getSecurityVault(fixture.owner(), pool, fixture.portfolio)).repBackingUnits).toBe(0n)
		const originalBacking = await fixture.repClaim(pool, originalCustody)
		expect(originalBacking).toBeGreaterThan(0n)
		expect(await assets()).toBe(5_000n * unit - originalBacking)

		await deposit(5_000n * unit, fixture.other())
		expect(await ownerShares(1n, fixture.other().account.address)).toBe(0n)
		await mint(unit, retiredQuestion)
		expect(await activeQuestions()).toContain(retiredQuestion)
		expect(await fixture.repClaim(pool, originalCustody)).toBe(originalBacking)
		expect(await fixture.repClaim(pool, fixture.portfolio)).toBeGreaterThan(0n)
		expect((await activeQuestions()).length).toBe(16)

		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await sync()
		const ids = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'getFrozenPositionIds', args: [0n, 64n] })
		const snapshots = await Promise.all(ids.map(async id => ({ id, data: await position(id) })))
		const reopened = snapshots.find(snapshot => snapshot.id !== 1n && snapshot.data[0] === retiredQuestion)
		if (!reopened) throw new Error('Reopened question did not produce a separate ownership snapshot')
		expect(reopened.data[3]).not.toBe(originalCustody)
		expect(await ownerShares(reopened.id, fixture.other().account.address)).toBeGreaterThan(0n)
		expect(await ownerShares(1n, fixture.other().account.address)).toBe(0n)

		const commonFeesBefore = await fees()
		await redeemNativeFees(retiredQuestion, originalCustody)
		const archivedFees = await fixture.owner().getBalance({ address: originalCustody })
		expect(archivedFees).toBeGreaterThan(0n)
		expect(await fees()).toBe(commonFeesBefore)
		await claim(1n)
		expect(await fixture.repClaim(pool, fixture.vault)).toBe(originalBacking)
		expect(await fixture.owner().getBalance({ address: fixture.vault })).toBeGreaterThanOrEqual(archivedFees)
		expect(await fixture.owner().getBalance({ address: originalCustody })).toBe(0n)
		await expect(claim(1n)).rejects.toThrow('No frozen question position')
		await expect(claim(1n, fixture.other().account.address)).rejects.toThrow('No frozen question position')
		await claim(reopened.id)
		const otherVault = await fixture.createVault(fixture.other())
		await claim(reopened.id, fixture.other().account.address)
		expect(await fixture.repClaim(pool, otherVault)).toBeGreaterThan(0n)
		expect(await fixture.repClaim(pool, reopened.data[3])).toBe(0n)
		expect((await position(reopened.id))[2]).toBe(0n)
	})

	test('permissionless native fee redemption keeps ended-question ETH with its historical owners', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		const upfrontFees = await fees()
		await fixture.base.mockWindow.advanceTime(DAY)
		await redeemNativeFees(fixture.base.questionId, fixture.portfolio)
		const activeFees = await fees()
		expect(activeFees).toBeGreaterThan(upfrontFees)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await redeemNativeFees(fixture.base.questionId, fixture.portfolio)
		expect(await fees()).toBe(activeFees)
		await deposit(5_000n * unit, fixture.other())
		const [, , , custody] = await position(1n)
		const heldFees = await fixture.owner().getBalance({ address: custody })
		expect(heldFees).toBeGreaterThan(0n)
		expect(await fees(fixture.other().account.address)).toBe(0n)
		expect(await ownerShares(1n, fixture.other().account.address)).toBe(0n)
		await claim(1n)
		expect(await fixture.owner().getBalance({ address: fixture.vault })).toBeGreaterThanOrEqual(heldFees)
		expect(await fixture.owner().getBalance({ address: custody })).toBe(0n)
		expect(await fees()).toBe(activeFees)
	})

	test('near-total backing loss cannot inflate recapitalization shares beyond fee precision and retains in-kind exit', async () => {
		await deposit(240n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		const pool = fixture.base.securityPoolAddresses.securityPool
		const rep = getRepTokenAddress(fixture.base.genesisUniverse)
		const position = await getSecurityVault(fixture.owner(), pool, fixture.portfolio)
		const totalUnits = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool, functionName: 'totalRepBackingUnits' })
		const oneAttoClaimBacking = (totalUnits + position.repBackingUnits - 1n) / position.repBackingUnits
		const held = await getERC20Balance(fixture.owner(), rep, pool)
		// Isolate the exact one-atto accounting boundary without coupling this arithmetic test to
		// liquidation tick sizes. Native units stay intact while the fixture removes almost all REP.
		await fixture.base.mockWindow.impersonateAccount(pool)
		await fixture.base.mockWindow.setBalance(pool, 1_000n * unit)
		const poolClient = createWriteClient(fixture.base.mockWindow, BigInt(pool))
		await writeContractAndWait(poolClient, () => poolClient.writeContract({ abi: repArtifact.abi, address: rep, functionName: 'transfer', args: [fixture.other().account.address, held - oneAttoClaimBacking] }))
		expect(await assets()).toBe(1n)
		const beforeShares = await shares()
		await expect(deposit(5_000n * unit, fixture.other())).rejects.toThrow('Pool share precision exhausted')
		expect(await shares()).toBe(beforeShares)
		expect(await shares(fixture.other().account.address)).toBe(0n)
		await withdraw(beforeShares)
		expect(await shares()).toBe(0n)
		expect(await fixture.repClaim(pool, fixture.vault)).toBe(1n)
		expect((await getSecurityVault(fixture.owner(), pool, fixture.vault)).underwritingLimitAttoEth).toBeGreaterThan(0n)
	})
})
