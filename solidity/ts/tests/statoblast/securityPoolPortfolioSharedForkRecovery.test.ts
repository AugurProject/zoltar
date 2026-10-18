import { describe, expect, test } from 'bun:test'
import { getERC20Balance, getChildUniverseId, requireAddress, requireArray } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityVault, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finalizeTruthAuction, getForkActivationTime, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { aggregatePortfolioAbi } from './securityPoolPortfolioAggregateFixture'
import { nativeMigrationDuration, sharedChoiceDuration, sharedForkControllerAbi, useSharedPortfolioForkFixture } from './securityPoolPortfolioSharedForkFixture'

describe('Statoblast: shared fork branch recovery', () => {
	const { fixture, allocate, fork, prepareChild, controller, choose, process, childContext, forkPosition, collect } = useSharedPortfolioForkFixture()

	test('collection can materialize a chosen branch before any child cash is withdrawable', async () => {
		await allocate()
		const sourceFork = await fork()
		await choose()
		await choose(1n, fixture.other())
		const child = await prepareChild(fixture.base.securityPoolAddresses.securityPool, 1n)
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		const context = await childContext()
		const token = getRepTokenAddress(getChildUniverseId(fixture.base.genesisUniverse, 1n))
		expect(await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)).toBe(0n)
		await collect(context, fixture.owner(), [0n], [1n])
		const migrated = await forkPosition(context)
		expect((await getSecurityVault(fixture.owner(), child, migrated[0])).repBackingUnits).toBeGreaterThan(0n)
		expect(await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)).toBe(0n)
		await expect(collect(context, fixture.owner(), [0n], [1n])).rejects.toThrow('No fork recovery progress')
	})

	test('already-final allocations recover the original REP without inventing a child-token claim', async () => {
		await allocate()
		await fixture.base.finalizeQuestionAsYesWithoutFork()
		const sourceFork = await fork({ activatePools: false })
		await choose()
		await choose(1n, fixture.other())
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		const bounty = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryBounties', args: [1n] })
		await process()
		const context = await childContext()
		expect((await forkPosition(context))[3]).toBe(true)
		expect(await getSystemState(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)).toBe(SystemState.Operational)
		const recovered = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveredRepAttoRep' })
		expect(recovered).toBeGreaterThan(0n)
		const token = getRepTokenAddress(getChildUniverseId(fixture.base.genesisUniverse, 1n))
		expect(await getERC20Balance(fixture.owner(), token, await controller())).toBe(0n)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(bounty)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [await controller()] })).toBe(0n)
	})

	test('one native recovery credits all branch owners and later owners collect without migrating again', async () => {
		const owners = await allocate(3, false)
		const sourceFork = await fork({ ownQuestion: true })
		for (const owner of owners) await choose(1n, owner)
		const parent = fixture.base.securityPoolAddresses.securityPool
		const child = await prepareChild(parent, 1n)
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		await process()
		const context = await childContext()
		const branchPosition = await forkPosition(context)
		const branch = requireArray(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'getContext', args: [context] }), 'Shared context')
		const ledger = requireAddress(branch[4], 'Branch recovery ledger')
		for (const owner of owners) expect(await owner.readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerIntervalCount', args: [owner.account.address] })).toBe(1n)
		await fixture.base.mockWindow.setTime((await getForkActivationTime(fixture.owner(), parent)) + nativeMigrationDuration + 1n)
		await startTruthAuction(fixture.owner(), child)
		if ((await getSystemState(fixture.owner(), child)) === SystemState.ForkTruthAuction) {
			await fixture.base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(fixture.owner(), child)
		}
		const beforeRecovery = await fixture.repClaim(child, branchPosition[0])
		expect(beforeRecovery).toBeGreaterThan(0n)
		const token = getRepTokenAddress(getChildUniverseId(fixture.base.genesisUniverse, 1n))
		let totalCollected = 0n
		for (const [index, owner] of owners.entries()) {
			const before = await getERC20Balance(owner, token, owner.account.address)
			const hash = await collect(context, owner, [0n], index === 0 ? [1n] : [])
			const amount = (await getERC20Balance(owner, token, owner.account.address)) - before
			expect(amount).toBeGreaterThan(0n)
			expect(amount).toBeLessThanOrEqual(beforeRecovery / 3n)
			totalCollected += amount
			const receipt = await owner.waitForTransactionReceipt({ hash })
			if (index > 0) expect(receipt.gasUsed).toBeLessThan(500_000n)
			expect((await getSecurityVault(owner, child, branchPosition[0])).repBackingUnits).toBe(0n)
		}
		expect(beforeRecovery - totalCollected).toBeLessThanOrEqual(3n)
		expect((await forkPosition(context))[3]).toBe(true)
	})
})
