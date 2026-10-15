import { describe, expect, test } from 'bun:test'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: aggregate multi-question underwriting', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('two owners fund one common reserve and a buyer mints without naming either owner', async () => {
		for (const owner of [fixture.owner(), fixture.other()]) {
			await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.portfolio)
			await writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'deposit', args: [5_000n * unit, 1n] }))
		}
		await fixture.refreshPrice(fixture.base.questionId)
		const firstShares = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'balanceOf', args: [fixture.owner().account.address] })
		const secondShares = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'balanceOf', args: [fixture.other().account.address] })
		expect(firstShares).toBeGreaterThan(0n)
		expect(secondShares).toBe(firstShares)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'createCompleteSet', args: [fixture.base.questionId, fixture.other().account.address, 100n * unit, 100n * unit], value: 110n * unit }))
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'totalAssets' })).toBe(10_000n * unit)
	})
})

describe('Statoblast: aggregate ownership across exits and question boundaries', () => {
	const { fixture, deposit, shares, assets, fees, sync, mint, withdraw, claim } = useAggregatePortfolioFixture()
	const pool = (questionId = fixture.base.questionId) => fixture.poolFor(questionId).securityPool
	const ownerPositionShares = (positionId = 1n, owner = fixture.owner().account.address) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'getOwnerPositionShares', args: [positionId, owner] })
	const frozen = (positionId = 1n) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'frozenPositions', args: [positionId] })
	const prepare = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
	}

	test('unsolicited REP cannot inflate initial shares or dilute a later depositor', async () => {
		await fixture.transferRep(fixture.portfolio, 10_000n * unit)
		await deposit(100n * unit)
		await deposit(100n * unit, fixture.other())
		expect(await assets()).toBe(200n * unit)
		expect(await shares()).toBe(100n * unit)
		expect(await shares(fixture.other().account.address)).toBe(100n * unit)
		await withdraw(await shares())
		expect(await assets()).toBe(100n * unit)
	})

	test('withdrawing shares transfers proportional native obligations and only the idle REP immediately', async () => {
		await prepare()
		await deposit(5_000n * unit, fixture.other())
		const before = await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.owner().account.address)
		await withdraw(await shares())
		expect(await shares()).toBe(0n)
		expect(await shares(fixture.other().account.address)).toBe(5_000n * unit)
		expect(await assets()).toBe(5_000n * unit)
		const owned = await getSecurityVault(fixture.owner(), pool(), fixture.vault)
		const shared = await getSecurityVault(fixture.owner(), pool(), fixture.portfolio)
		expect(owned.repBackingUnits).toBeGreaterThan(0n)
		expect(shared.repBackingUnits - owned.repBackingUnits).toBeLessThanOrEqual(1n)
		expect(owned.underwritingLimitAttoEth + shared.underwritingLimitAttoEth).toBeGreaterThan(99n * unit)
		const returned = (await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.owner().account.address)) - before
		expect(returned + (await fixture.repClaim(pool(), fixture.vault))).toBe(5_000n * unit)
		const ownedBefore = await fixture.repClaim(pool(), fixture.vault)
		await mint(100n * unit, fixture.secondQuestionId)
		expect(await fixture.repClaim(pool(), fixture.vault)).toBe(ownedBefore)
		expect(await fixture.repClaim(pool(fixture.secondQuestionId), fixture.vault)).toBe(0n)
	})

	test('idle-return slippage failure leaves shares and every native position unchanged', async () => {
		await prepare()
		const before = await shares()
		await expect(withdraw(before, fixture.owner(), 5_000n * unit)).rejects.toThrow('Minimum idle REP not met')
		expect(await shares()).toBe(before)
		expect(await assets()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool(), fixture.vault)).toBe(0n)
	})

	test('ending one question freezes its owners while another remains open to new capital', async () => {
		await prepare()
		await mint(100n * unit, fixture.secondQuestionId)
		const firstBacking = await fixture.repClaim(pool(), fixture.portfolio)
		const oldShares = await shares()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await deposit(5_000n * unit, fixture.other())
		expect(await ownerPositionShares()).toBe(oldShares)
		expect(await ownerPositionShares(1n, fixture.other().account.address)).toBe(0n)
		expect(await assets()).toBe(10_000n * unit - firstBacking)
		const [questionId, totalShares, remainingShares, custody] = await frozen()
		expect(questionId).toBe(fixture.base.questionId)
		expect(totalShares).toBe(oldShares)
		expect(remainingShares).toBe(oldShares)
		expect(await fixture.repClaim(pool(), custody)).toBe(firstBacking)
		await fixture.refreshPrice(fixture.secondQuestionId)
		await mint(100n * unit, fixture.secondQuestionId)
		expect(await ownerPositionShares(1n, fixture.other().account.address)).toBe(0n)
	})

	test('permissionless claims deliver historical ownership only to its canonical owner vault', async () => {
		await prepare()
		await deposit(5_000n * unit, fixture.other())
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await sync()
		const [, , , custody] = await frozen()
		const before = await fixture.repClaim(pool(), custody)
		await claim()
		expect(await fixture.repClaim(pool(), fixture.vault)).toBe(before / 2n)
		expect(await ownerPositionShares()).toBe(0n)
		await expect(claim()).rejects.toThrow()
		const secondVault = await fixture.createVault(fixture.other())
		await claim(1n, fixture.other().account.address)
		expect(await fixture.repClaim(pool(), secondVault)).toBe(before - before / 2n)
		expect(await fixture.repClaim(pool(), custody)).toBe(0n)
		expect((await frozen())[2]).toBe(0n)
	})

	test('withdrawing all active shares does not surrender an older frozen position or earned fees', async () => {
		await prepare()
		const earned = await fees()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await sync()
		const historical = await ownerPositionShares()
		await withdraw(await shares())
		expect(await shares()).toBe(0n)
		expect(await ownerPositionShares()).toBe(historical)
		expect(await fees()).toBeGreaterThanOrEqual(earned)
		await deposit(1_000n * unit, fixture.other())
		expect(await ownerPositionShares(1n, fixture.other().account.address)).toBe(0n)
		await claim()
		expect(await fixture.repClaim(pool(), fixture.vault)).toBeGreaterThan(0n)
	})

	test('exhausted active generations reset without erasing archived claims or old fee entitlement', async () => {
		await deposit(240n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		const earned = await fees()
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await sync()
		expect(await assets()).toBe(0n)
		expect(await shares()).toBe(0n)
		expect(await ownerPositionShares()).toBe(240n * unit)
		await deposit(240n * unit, fixture.other())
		expect(await shares(fixture.other().account.address)).toBe(240n * unit)
		await fixture.refreshPrice(fixture.secondQuestionId)
		await mint(100n * unit, fixture.secondQuestionId)
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await sync()
		expect(await shares(fixture.other().account.address)).toBe(0n)
		expect(await ownerPositionShares(2n, fixture.other().account.address)).toBe(240n * unit)
		await deposit(240n * unit)
		expect(await shares()).toBe(240n * unit)
		expect(await fees()).toBeGreaterThanOrEqual(earned)
		await claim()
		await claim(2n, fixture.other().account.address)
		expect(await fixture.repClaim(pool(), fixture.vault)).toBe(240n * unit)
	})
})
