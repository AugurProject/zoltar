import { describe, expect, test } from 'bun:test'
import { parseAbi, type Address } from '@zoltar/core-shared/evm/ethereum'
import { approveToken, getChildUniverseId, getERC20Balance, requireAddress, requireArray } from '../../testSupport/simulator/utils/utilities'
import { addRepToMigrationBalance, forkUniverse, getRepTokenAddress, getZoltarAddress, getZoltarForkThreshold, splitMigrationRep } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finalizeTruthAuction, getForkActivationTime, initiateSecurityPoolFork, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { aggregatePortfolioAbi } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'
import { nativeMigrationDuration, sharedChoiceDuration, sharedForkControllerAbi, useSharedPortfolioForkFixture } from './securityPoolPortfolioSharedForkFixture'

const terminalAbi = parseAbi([
	'function positionComplete(uint256 positionId) view returns (bool)',
	'function getOwnerActiveIntervalCount(address owner) view returns (uint256)',
	'function getOwnerActiveIntervals(address owner,uint256 cursor,uint256 count) view returns (uint256[],uint256)',
	'function getOwnerForkBranches(uint256 contextId,address owner,uint256 cursor,uint256 count) view returns (uint256[],uint256)',
])

describe('Statoblast: terminal shared fork recovery intervals', () => {
	const { fixture, allocate, fork, prepareChild, choose, process, childContext, forkPosition, controller, collect, withdraw, mint, revoke } = useSharedPortfolioForkFixture()
	const ledger = async (contextId = 0n) => {
		const context = requireArray(await fixture.owner().readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'getContext', args: [contextId] }), 'Fork context')
		return requireAddress(context[4], 'Fork recovery ledger')
	}
	const active = async (contextId = 0n, owner = fixture.owner()) => owner.readContract({ abi: terminalAbi, address: await ledger(contextId), functionName: 'getOwnerActiveIntervalCount', args: [owner.account.address] })
	const complete = async (contextId = 0n) => fixture.owner().readContract({ abi: terminalAbi, address: await ledger(contextId), functionName: 'positionComplete', args: [1n] })
	const branches = async (contextId = 0n, cursor = 0n, count = 64n, owner = fixture.owner()) => owner.readContract({ abi: terminalAbi, address: await controller(), functionName: 'getOwnerForkBranches', args: [contextId, owner.account.address, cursor, count] })
	const claimOrigin = async (owner: WriteClient) => writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))
	const finishIncoming = async (parent: Address, child: Address) => {
		await fixture.base.mockWindow.setTime((await getForkActivationTime(fixture.owner(), parent)) + nativeMigrationDuration + 1n)
		await startTruthAuction(fixture.owner(), child)
		if ((await getSystemState(fixture.owner(), child)) === SystemState.ForkTruthAuction) {
			await fixture.base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(fixture.owner(), child)
		}
	}

	test('collecting completed source intervals retains every unpaid imported child entitlement', async () => {
		const owners = await allocate(2, false)
		const sourceFork = await fork({ ownQuestion: true })
		for (const owner of owners) await choose(1n, owner)
		const parent = fixture.base.securityPoolAddresses.securityPool
		const child = await prepareChild(parent, 1n)
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		await process()
		const context = await childContext()
		expect(await complete()).toBe(true)
		expect(await complete(context)).toBe(false)
		for (const owner of owners) {
			await claimOrigin(owner)
			expect(await active(0n, owner)).toBe(0n)
			expect(await active(context, owner)).toBe(1n)
			expect(await branches(0n, 0n, 64n, owner)).toEqual([[context], 0n])
			const choice = requireArray(await owner.readContract({ abi: sharedForkControllerAbi, address: await controller(), functionName: 'choices', args: [0n, owner.account.address, 0n] }), 'Shared choice')
			expect(choice[0]).toBe(true)
		}
		await finishIncoming(parent, child)
		const childToken = getRepTokenAddress(getChildUniverseId(fixture.base.genesisUniverse, 1n))
		for (const [index, owner] of owners.entries()) {
			const before = await getERC20Balance(owner, childToken, owner.account.address)
			await collect(context, owner, [0n], index === 0 ? [1n] : [])
			expect(await getERC20Balance(owner, childToken, owner.account.address)).toBeGreaterThan(before)
			expect(await active(context, owner)).toBe(0n)
		}
		expect(await complete(context)).toBe(true)
	})

	test('branch navigation counts multiple interval selections and unlinks revoked choices directly', async () => {
		await allocate(1, false)
		await withdraw(100n * unit)
		await mint(20n * unit, fixture.secondQuestionId)
		await fork()
		await choose(1n, fixture.owner(), 0n, [0n, 1n])
		const first = await childContext(1n)
		expect(await branches()).toEqual([[first], 0n])
		await revoke(fixture.owner(), 0n, [0n])
		expect(await branches()).toEqual([[first], 0n])
		await choose(2n, fixture.owner(), 0n, [0n])
		const second = await childContext(2n)
		expect(await branches(0n, 0n, 1n)).toEqual([[first], second])
		expect(await branches(0n, second, 1n)).toEqual([[second], 0n])
		await choose(2n, fixture.owner(), 0n, [1n])
		expect(await branches()).toEqual([[second], 0n])
		await expect(branches(0n, first, 1n)).rejects.toThrow('Branch cursor retired')
		await choose(2n, fixture.owner(), 0n, [0n, 1n])
		expect(await branches()).toEqual([[second], 0n])
		await revoke(fixture.owner(), 0n, [0n])
		expect(await branches()).toEqual([[second], 0n])
		await revoke(fixture.owner(), 0n, [1n])
		expect(await branches()).toEqual([[], 0n])
		await choose(1n, fixture.owner(), 0n, [0n])
		expect(await branches()).toEqual([[first], 0n])
		expect(await branches(0n, 0n, 64n, fixture.other())).toEqual([[], 0n])
	})

	test('an empty imported child retires with zero cash and no processing prerequisite for the owner', async () => {
		await allocate(1, false)
		await fixture.base.finalizeQuestionAsYesWithoutFork()
		const sourceFork = await fork({ activatePools: false })
		await choose()
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		await process()
		const context = await childContext()
		expect(await complete(context)).toBe(true)
		const before = await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: await ledger(context), functionName: 'previewClaim', args: [fixture.owner().account.address, [0n]] })
		expect([...before]).toEqual([0n, 0n])
		await collect(context, fixture.owner(), [0n], [])
		expect(await active(context)).toBe(0n)
		await expect(collect(context, fixture.owner(), [0n], [])).rejects.toThrow('Owner interval retired')
	})

	test('the final individual descendant migration completes the source after an earlier shared split', async () => {
		await allocate(2, false)
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
		const parent = fixture.base.securityPoolAddresses.securityPool
		const child = await prepareChild(parent, 1n)
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + sharedChoiceDuration + 1n)
		await process()
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + nativeMigrationDuration + 1n)
		await choose(2n, fixture.owner(), context)
		await fixture.base.mockWindow.setTime(sourceFork.forkTime + nativeMigrationDuration + sharedChoiceDuration + 1n)
		await startTruthAuction(fixture.owner(), child)
		if ((await getSystemState(fixture.owner(), child)) === SystemState.ForkTruthAuction) {
			await fixture.base.mockWindow.advanceTime(8n * DAY)
			await finalizeTruthAuction(fixture.owner(), child)
		}
		await initiateSecurityPoolFork(fixture.owner(), child)
		await prepareChild(child, 2n, fixture.base.questionId, childUniverse)
		await process(1n, 2n, context)
		expect(await complete(context)).toBe(false)
		await prepareChild(child, 1n, fixture.base.questionId, childUniverse)
		const address = await controller()
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: sharedForkControllerAbi, address, functionName: 'claimPositionAndMigrate', args: [context, 1n, 0n, 1n] }))
		const source = await forkPosition(context)
		expect(source[1]).toBeGreaterThan(0n)
		expect(source[2]).toBe(0n)
		expect(source[3]).toBe(true)
		expect(await complete(context)).toBe(true)
		await collect(context, fixture.owner(), [0n], [])
		expect(await active(context)).toBe(0n)
		const grandchild = await childContext(2n, context)
		expect(await active(grandchild)).toBe(1n)
		expect(await complete(grandchild)).toBe(false)
	})
})
