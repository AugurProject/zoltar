import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getSecurityVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { depositOrdinaryEscalationPrincipals } from '../residualCaptureHelpers'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: explicit surplus recycling and owner reinvestment', () => {
	const { fixture, deposit, mint, shares, assets, custody, withdraw } = useAggregatePortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const prepare = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
	}
	const recycle = () => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [1n] }))
	const ledger = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryLedger' })
	const recovered = async (owner = fixture.owner().account.address) => fixture.owner().readContract({ abi: recoveryArtifact.abi, address: await ledger(), functionName: 'previewClaim', args: [owner, [0n]] })
	const reinvest = (minimumShares = 1n, owner = fixture.owner()) => writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimRecoveredAndDeposit', args: [[0n], [], minimumShares] }))

	test('redemption releases backing into idle on explicit recycling when ownership matches', async () => {
		await prepare()
		const committed = await fixture.repClaim(pool(), await custody())
		const idle = await assets()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		expect(await assets()).toBe(idle)
		await recycle()
		expect(await assets()).toBe(idle + committed)
		expect(await fixture.repClaim(pool(), await custody())).toBe(0n)
		expect((await recovered())[0]).toBe(0n)
		expect(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: await ledger(), functionName: 'unfinishedPositionCount' })).toBe(0n)
		await recycle()
		expect(await assets()).toBe(5_000n * unit)
	})

	test('historical recycling does not enrich new owners and only the entitled owner can reinvest', async () => {
		await prepare()
		const committed = await fixture.repClaim(pool(), await custody())
		await deposit(await assets(), fixture.other())
		const idle = await assets()
		const totalShares = (await shares()) + (await shares(fixture.other().account.address))
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		await recycle()
		expect(await assets()).toBe(idle)
		expect((await recovered())[0]).toBe(committed)
		expect((await recovered(fixture.other().account.address))[0]).toBe(0n)
		await expect(reinvest(1n, fixture.other())).rejects.toThrow('Deposit amount zero')
		const expectedShares = (committed * totalShares) / idle
		await expect(reinvest(expectedShares + 1n)).rejects.toThrow('Minimum pool shares not met')
		expect((await recovered())[0]).toBe(committed)
		expect(await assets()).toBe(idle)
		const originalShares = await shares()
		const walletRep = await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.owner().account.address)
		await reinvest(expectedShares)
		expect(await assets()).toBe(idle + committed)
		expect(await shares()).toBe(originalShares + expectedShares)
		expect((await recovered())[0]).toBe(0n)
		expect(await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.owner().account.address)).toBe(walletRep)
	})

	test('stale pricing cannot release backing and a later fresh retry completes recycling', async () => {
		await prepare()
		const idle = await assets()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		await fixture.base.mockWindow.advanceTime(301n)
		await recycle()
		expect(await assets()).toBe(idle)
		expect(await fixture.repClaim(pool(), await custody())).toBeGreaterThan(0n)
		await fixture.refreshPrice(fixture.base.questionId)
		await recycle()
		expect(await assets()).toBe(5_000n * unit)
	})

	test('recycling preserves ordinary-game residual ownership before finality', async () => {
		await prepare()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId)
		await depositOrdinaryEscalationPrincipals(fixture.owner(), pool())
		const source = await custody()
		const before = await getSecurityVault(fixture.owner(), pool(), source)
		const idle = await assets()
		await recycle()
		expect((await getSecurityVault(fixture.owner(), pool(), source)).repBackingUnits).toBe(before.repBackingUnits)
		expect(await assets()).toBe(idle)
		expect(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: await ledger(), functionName: 'unfinishedPositionCount' })).toBe(1n)
	})

	test('an owner can retire a completed zero-cash interval after reserve recycling and exit', async () => {
		await prepare()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		await recycle()
		await withdraw(await shares())
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimFees' }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))
		expect(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: await ledger(), functionName: 'getOwnerActiveIntervalCount', args: [fixture.owner().account.address] })).toBe(0n)
	})
})
