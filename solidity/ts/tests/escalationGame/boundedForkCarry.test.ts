import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_EscalationGame_EscalationGame as gameArtifact, test_statoblast_EscalationGameProofTestSecurityPool_EscalationGameProofTestSecurityPool as poolArtifact } from '../../types/contractArtifact'
import { initializeForkCarrySnapshotAbi, initializeForkCarrySnapshotWithResolutionBalancesAbi } from '../carrySnapshotAbis'
import { zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'

describe('Escalation game: bounded carry readiness', () => {
	const fixture = useEscalationGameFixture()

	test('empty outcomes require all three steps; partial snapshots cannot resume, accept deposits or change their commitment', async () => {
		const child = await fixture.deployEscalationGameWithProofPool()
		const { client, reportBond, nonDecisionThresholdAttoRep } = fixture
		await fixture.startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const peaks = [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()] as const
		const zeros = [0n, 0n, 0n] as const
		const roots = [zeroHash(), zeroHash(), zeroHash()] as const
		const count = () => client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'forkCarrySnapshotOutcomesInitialized' })
		const funded = () => client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'isForkCarryFundingComplete' })
		const advance = () => writeContractAndWait(client, () => client.writeContract({ abi: initializeForkCarrySnapshotAbi, address: child.testSecurityPoolAddress, functionName: 'initializeForkCarrySnapshot', args: [peaks, zeros, zeros, roots] }))
		await expect(client.simulateContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'initializeForkCarryOutcome', args: [zeroAddress, zeroHash(), zeroPeakArray(), 0n, 0n, 0n, zeroHash()] })).rejects.toThrow('Only pool')
		for (let stage = 0; stage < 3; stage++) {
			expect(await count()).toBe(BigInt(stage))
			expect(await funded()).toBe(false)
			await expect(client.simulateContract({ abi: poolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'resumeEscalationGameFromFork' })).rejects.toThrow('Fork snapshot incomplete')
			await expect(client.simulateContract({ abi: poolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'recordDeposit', args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond] })).rejects.toThrow('Fork snapshot incomplete')
			await expect(client.simulateContract({ abi: poolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'recordForkedEscrowForOutcome', args: [client.account.address, QuestionOutcome.Yes, reportBond, reportBond] })).rejects.toThrow('Fork snapshot incomplete')
			if (stage > 0)
				await expect(client.simulateContract({ abi: initializeForkCarrySnapshotWithResolutionBalancesAbi, address: child.testSecurityPoolAddress, functionName: 'initializeForkCarrySnapshotWithResolutionBalances', args: [peaks, zeros, zeros, [reportBond, 0n, 0n], roots] })).rejects.toThrow('Snapshot changed')
			const hash = await advance()
			expect((await client.waitForTransactionReceipt({ hash })).gasUsed).toBeLessThan(16_777_216n)
		}
		expect(await count()).toBe(3n)
		expect(await funded()).toBe(true)
		expect(await client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		await expect(advance()).rejects.toThrow('Snapshot initialized')
		await writeContractAndWait(client, () => client.writeContract({ abi: poolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'resumeEscalationGameFromFork' }))
		expect(await client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'forkResumedAt' })).toBeGreaterThan(0n)
	})

	test('snapshot completeness never substitutes for backing and the harness funds a staged snapshot only once', async () => {
		const child = await fixture.deployEscalationGameWithProofPool()
		const { client, reportBond, nonDecisionThresholdAttoRep } = fixture
		await fixture.startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		const peaks = [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()] as const
		const zeros = [0n, 0n, 0n] as const
		const totals = [0n, reportBond, 0n] as const
		const roots = [zeroHash(), zeroHash(), zeroHash()] as const
		for (let stage = 0; stage < 3; stage++) await writeContractAndWait(client, () => client.writeContract({ abi: initializeForkCarrySnapshotWithResolutionBalancesAbi, address: child.testSecurityPoolAddress, functionName: 'initializeForkCarrySnapshotWithResolutionBalances', args: [peaks, zeros, totals, zeros, roots] }))
		expect(await client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'isForkCarryFundingComplete' })).toBe(false)
		await expect(client.simulateContract({ abi: poolArtifact.abi, address: child.testSecurityPoolAddress, functionName: 'resumeEscalationGameFromFork' })).rejects.toThrow('Fork carry underfunded')
		await fixture.fundEscalationGame(child.escalationGameAddress, reportBond)
		expect(await client.readContract({ abi: gameArtifact.abi, address: child.escalationGameAddress, functionName: 'isForkCarryFundingComplete' })).toBe(true)
		const fundedChild = await fixture.deployEscalationGameWithProofPool()
		await fixture.startEscalationFromFork(fundedChild.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
		for (let stage = 0; stage < 3; stage++) await writeContractAndWait(client, () => client.writeContract({ abi: initializeForkCarrySnapshotAbi, address: fundedChild.testSecurityPoolAddress, functionName: 'initializeForkCarrySnapshot', args: [peaks, zeros, totals, roots] }))
		expect(await getERC20Balance(client, getRepTokenAddress(0n), fundedChild.escalationGameAddress)).toBe(reportBond)
	})
})
