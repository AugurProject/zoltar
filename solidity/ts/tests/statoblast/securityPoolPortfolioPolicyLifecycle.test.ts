import { describe, expect, test } from 'bun:test'
import { decodeEventLog, encodeFunctionData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact,
	statoblast_VaultOperations_VaultOperations as operationsArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { emptyOperations, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: portfolio policy replacement and owner intervention', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const version = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyVersion' })
	const nonce = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })
	const policy = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicy' })
	const commitment = async () => (await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth
	const config = () => ({ universeId: fixture.base.genesisUniverse, executor: fixture.other().account.address, expiresAt: fixture.base.questionData.endTime - 1n, depositBudgetAttoRep: 2_000n * unit, commitmentIncreaseBudgetAttoEth: 200n * unit, minimumIdleAttoRep: 100n * unit, minimumHealthFactorBps: 12_000n })
	const limits = () => [{ questionId: fixture.base.questionId, depositBudgetAttoRep: 2_000n * unit, maximumCommitmentAttoEth: 100n * unit }]
	const install = async (expectedVersion: bigint, expectedNonce: bigint) => await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'setAllocationPolicy', args: [expectedVersion, expectedNonce, config(), limits()] }))
	const allocate = async (deposit = 1_000n * unit, target = 50n * unit) => {
		const expectedVersion = await version()
		const expectedNonce = await nonce()
		return await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'executeAllocation', args: [expectedVersion, expectedNonce, fixture.base.questionId, deposit, target] }))
	}
	const prepare = async () => {
		await fixture.transferRep(fixture.vault, 2_100n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await install(0n, 0n)
	}
	const reduceCall = () => ({ target: fixture.base.securityPoolAddresses.securityPool, value: 0n, data: encodeFunctionData({ abi: poolArtifact.abi, functionName: 'setUnderwritingLimit', args: [0n] }) })
	const withdrawCall = async () => ({
		target: await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'vaultOperations' }),
		value: 0n,
		data: encodeFunctionData({ abi: operationsArtifact.abi, functionName: 'submitVaultOperations', args: [{ ...emptyOperations(), withdrawAttoRep: 1_000n * unit }, 0n, 0n, 0n] }),
	})
	const unwind = () => ({ ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit })
	const batch = async (calls: ReturnType<typeof reduceCall>[]) => await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'executeBatch', args: [calls] }))
	const expectRevoked = async (previousVersion: bigint) => {
		expect(await version()).toBe(previousVersion + 1n)
		expect((await policy())[0].executor).toBe(zeroAddress)
		await expect(allocate(0n, 50n * unit)).rejects.toThrow('Only allocation executor')
	}

	test('spending before replacement rejects the stale nonce and preserves the old consumed budgets', async () => {
		await prepare()
		const observedVersion = await version()
		const observedNonce = await nonce()
		await allocate(500n * unit)
		await expect(install(observedVersion, observedNonce)).rejects.toThrow('Allocation authorization changed')
		expect(await version()).toBe(observedVersion)
		expect(await nonce()).toBe(observedNonce + 1n)
		expect((await policy()).slice(2)).toEqual([500n * unit, 50n * unit])
		await install(observedVersion, observedNonce + 1n)
		expect(await version()).toBe(observedVersion + 1n)
		expect(await nonce()).toBe(observedNonce + 1n)
		expect((await policy()).slice(2)).toEqual([0n, 0n])
	})

	test('replacement and revocation each invalidate previously observed policy versions even without spending', async () => {
		await prepare()
		await install(1n, 0n)
		await expect(install(1n, 0n)).rejects.toThrow('Allocation authorization changed')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'revokeAllocationPolicy' }))
		await expect(install(2n, 0n)).rejects.toThrow('Allocation authorization changed')
		expect(await version()).toBe(3n)
		expect(await nonce()).toBe(0n)
	})

	test('generic owner execution revokes before reducing commitment and emits the invalidated version', async () => {
		await prepare()
		await allocate()
		const call = reduceCall()
		const hash = await fixture.execute(call.target, call.data)
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash })
		const events = receipt.logs.filter(log => log.address.toLowerCase() === fixture.vault.toLowerCase()).map(log => decodeEventLog({ abi: vaultArtifact.abi, data: log.data, topics: log.topics }))
		expect(events[0]?.eventName).toBe('AllocationPolicyRevoked')
		expect(events.find(event => event.eventName === 'AllocationPolicyRevoked')?.args).toEqual({ version: 2n })
		await expectRevoked(1n)
		expect(await commitment()).toBe(0n)
	})

	test('generic owner batches revoke and unwind atomically without an intermediate rearm opportunity', async () => {
		await prepare()
		await allocate()
		await batch([reduceCall(), await withdrawCall()])
		await expectRevoked(1n)
		expect(await commitment()).toBe(0n)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
	})

	test('typed owner batches revoke and unwind in the same transaction', async () => {
		await prepare()
		await allocate()
		const operations = [{ questionId: fixture.base.questionId, universeId: fixture.base.genesisUniverse, input: unwind(), proposedRepPerEthPrice: 0n, requestedInitialAttoWeth: 0n, bountyAttoEth: 0n, value: 0n, minimumIdleAttoRep: 100n * unit }]
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'submitQuestionOperationsBatch', args: [operations, true] }))
		await expectRevoked(1n)
		expect(await commitment()).toBe(0n)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
	})

	test('a failed owner batch restores the policy, position and consumed budgets together', async () => {
		await prepare()
		await allocate()
		const before = await policy()
		await expect(batch([reduceCall(), { ...reduceCall(), target: zeroAddress }])).rejects.toThrow('Call target zero')
		expect(await version()).toBe(1n)
		expect(await nonce()).toBe(1n)
		expect(await policy()).toEqual(before)
		expect(await commitment()).toBe(50n * unit)
		await allocate(100n * unit, 60n * unit)
		expect(await version()).toBe(1n)
		expect(await nonce()).toBe(2n)
		expect((await policy()).slice(2)).toEqual([1_100n * unit, 60n * unit])
	})

	test('a successful queued owner request revokes immediately while its native change remains pending', async () => {
		await fixture.transferRep(fixture.vault, 2_100n * unit)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.refreshPrice(fixture.base.questionId)
		await install(0n, 0n)
		await allocate()
		await fixture.base.mockWindow.advanceTime(301n)
		await fixture.submit(fixture.base.questionId, unwind(), { price: unit, value: funding.cost })
		await expectRevoked(1n)
		expect(await commitment()).toBe(50n * unit)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'getActiveStagedOperationCount' })).toBe(1n)
	})

	test('owner operations without an installed policy do not advance the version, but explicit revocations do', async () => {
		await fixture.allocate(fixture.base.questionId)
		expect(await version()).toBe(0n)
		await fixture.submit(fixture.base.questionId, unwind())
		expect(await version()).toBe(0n)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'revokeAllocationPolicy' }))
		expect(await version()).toBe(1n)
		await expect(install(0n, 0n)).rejects.toThrow('Allocation authorization changed')
	})

	test('direct incoming REP preserves bounded multi-step authority and never refills consumed budgets', async () => {
		await prepare()
		await allocate(1_000n * unit, 0n)
		await fixture.transferRep(fixture.vault, 1_000n * unit)
		expect(await version()).toBe(1n)
		expect((await policy()).slice(2)).toEqual([1_000n * unit, 0n])
		await allocate(1_000n * unit, 50n * unit)
		await expect(allocate(unit, 50n * unit)).rejects.toThrow('Policy deposit budget exceeded')
		expect(await version()).toBe(1n)
		expect(await nonce()).toBe(2n)
		expect((await policy()).slice(2)).toEqual([2_000n * unit, 50n * unit])
	})
})
