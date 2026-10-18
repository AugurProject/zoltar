import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityVault, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finalizeTruthAuction, getForkActivationTime, initiateSecurityPoolFork, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { unit } from './securityPoolPortfolioFixture'
import { nativeMigrationDuration, sharedChoiceDuration, sharedForkControllerAbi, useSharedPortfolioForkFixture } from './securityPoolPortfolioSharedForkFixture'

describe('Statoblast: recursive shared portfolio fork choices', () => {
	const { fixture, allocate, fork, prepareChild, choose, process, childContext, forkPosition, window, branchWeight, controller } = useSharedPortfolioForkFixture()

	for (const allShared of [true, false])
		test(`an early descendant fork supports ${allShared ? 'shared migration' : 'individual fallback'} after delayed pool materialization`, async () => {
			await allocate()
			const sourceFork = await fork()
			await choose()
			await choose(1n, fixture.other())
			const context = await childContext()
			const childUniverse = getChildUniverseId(fixture.base.genesisUniverse, 1n)
			const threshold = await getZoltarForkThreshold(fixture.owner(), childUniverse)
			await addRepToMigrationBalance(fixture.owner(), fixture.base.genesisUniverse, threshold)
			await splitMigrationRep(fixture.owner(), fixture.base.genesisUniverse, threshold, [1n])
			await approveToken(fixture.owner(), getRepTokenAddress(childUniverse), getZoltarAddress())
			await forkUniverse(fixture.owner(), childUniverse, sourceFork.forkQuestionId)
			const descendantFork = await getUniverseData(fixture.owner(), childUniverse)
			const floor = sourceFork.forkTime + nativeMigrationDuration
			expect(descendantFork.forkTime).toBeLessThan(floor)
			expect(await window(context)).toEqual([floor, floor + sharedChoiceDuration])
			await expect(choose(2n, fixture.owner(), context)).rejects.toThrow()
			expect((await forkPosition(context))[0]).toBe(zeroAddress)
			await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
			const parent = fixture.base.securityPoolAddresses.securityPool
			const child = await prepareChild(parent, 1n)
			await process()
			await fixture.base.mockWindow.setTime(floor + 1n)
			await choose(2n, fixture.owner(), context)
			if (allShared) await choose(2n, fixture.other(), context)
			const selectedShares = (allShared ? 10_000n : 5_000n) * unit
			expect(await branchWeight(1n, 2n, context)).toBe(selectedShares)
			// The second allocation is still unmaterialized; choice registration never scans allocations.
			expect((await forkPosition(context, 2n))[0]).toBe(zeroAddress)
			expect(await branchWeight(2n, 2n, context)).toBe(selectedShares)
			await fixture.base.mockWindow.setTime(floor + sharedChoiceDuration + 1n)
			await process(1n, 2n, context)
			const grandchildContext = await childContext(2n, context)
			expect((await forkPosition(grandchildContext))[0]).toBe(zeroAddress)
			expect(await branchWeight(1n, 2n, context)).toBe(selectedShares)
			expect(await getSystemState(fixture.owner(), child)).toBe(SystemState.ForkMigration)
			await startTruthAuction(fixture.owner(), child)
			if ((await getSystemState(fixture.owner(), child)) === SystemState.ForkTruthAuction) {
				await fixture.base.mockWindow.advanceTime(8n * DAY)
				await finalizeTruthAuction(fixture.owner(), child)
			}
			await initiateSecurityPoolFork(fixture.owner(), child)
			const outgoingActivation = await getForkActivationTime(fixture.owner(), child)
			expect(outgoingActivation).toBeGreaterThanOrEqual(floor)
			const grandchild = await prepareChild(child, 2n, fixture.base.questionId, childUniverse)
			await process(1n, 2n, context)
			const migrated = await forkPosition(grandchildContext)
			expect(migrated[1]).toBe(selectedShares)
			expect((await getSecurityVault(fixture.owner(), grandchild, migrated[0])).repBackingUnits).toBeGreaterThan(0n)
			expect((await forkPosition(context))[2]).toBe(10_000n * unit - selectedShares)
			expect(await fixture.base.mockWindow.getTime()).toBeLessThan(outgoingActivation + nativeMigrationDuration)
			if (!allShared) {
				const otherChild = await prepareChild(child, 1n, fixture.base.questionId, childUniverse)
				const otherVault = await fixture.createVault(fixture.other())
				const address = await controller()
				await fixture.base.mockWindow.setTime(outgoingActivation + nativeMigrationDuration - 1n)
				await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: sharedForkControllerAbi, address, functionName: 'claimPositionAndMigrate', args: [context, 1n, 0n, 1n] }))
				expect(await fixture.base.mockWindow.getTime()).toBe(outgoingActivation + nativeMigrationDuration)
				expect((await getSecurityVault(fixture.owner(), otherChild, otherVault)).repBackingUnits).toBeGreaterThan(0n)
				expect((await forkPosition(context))[2]).toBe(0n)
				expect((await forkPosition(context))[1]).toBe(5_000n * unit)
				expect((await forkPosition(0n))[1]).toBe(10_000n * unit)
			}
		})
})
