import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../../testSupport/deployContract'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { ensureZoltarDeployed, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { zeroHash, zeroPeakArray } from '../escalationGame/carryHelpers'
import { initializeForkCarrySnapshotAbi, initializeForkCarrySnapshotWithResolutionBalancesAbi } from '../carrySnapshotAbis'
import {
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate as depositArtifact,
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate as claimArtifact,
	statoblast_EscalationGameProofVerifier_EscalationGameProofVerifier as verifierArtifact,
	test_statoblast_EscalationGamePortfolioClockHarness_EscalationGamePortfolioClockHarness as poolArtifact,
	test_statoblast_EscalationGamePortfolioClockHarness_EscalationCentralClaimCheckpointHarness as centralCheckpointArtifact,
	test_statoblast_EscalationClaimCheckpointHarness_EscalationClaimCheckpointHarness as checkpointArtifact,
} from '../../types/contractArtifact'

describe('Statoblast: fixed portfolio reporter clock', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	test('late materialization and inherited attrition balances cannot extend the fixed native response cutoff', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		const wallAnchor = 1_000_000n
		const pool = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [getZoltarAddress(), wallAnchor, 1_000n] }))
		const verifier = await deployContract(owner, encodeDeployData({ abi: verifierArtifact.abi, bytecode: `0x${verifierArtifact.evm.bytecode.object}` }))
		const deposits = await deployContract(owner, encodeDeployData({ abi: depositArtifact.abi, bytecode: `0x${depositArtifact.evm.bytecode.object}` }))
		const claims = await deployContract(owner, encodeDeployData({ abi: claimArtifact.abi, bytecode: `0x${claimArtifact.evm.bytecode.object}` }))
		const game = await deployContract(owner, encodeDeployData({ abi: gameArtifact.abi, bytecode: `0x${gameArtifact.evm.bytecode.object}`, args: [pool, getRepTokenAddress(0n), verifier, claims, deposits] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'setEscalationGame', args: [game] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: gameArtifact.abi, address: game, functionName: 'startFromFork', args: [1n, 1_000n, 0n, 1, false, 0n] }))
		await approveToken(owner, getRepTokenAddress(0n), pool)
		for (let outcome = 0; outcome < 3; outcome++) {
			await writeContractAndWait(owner, () =>
				owner.writeContract({
					abi: initializeForkCarrySnapshotWithResolutionBalancesAbi,
					address: pool,
					functionName: 'initializeForkCarrySnapshotWithResolutionBalances',
					args: [
						[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
						[0n, 0n, 0n],
						[0n, 0n, 0n],
						[1_000n, 1_000n, 1_000n],
						[zeroHash(), zeroHash(), zeroHash()],
					],
				}),
			)
		}
		await ethereum.setTime(wallAnchor - 10n)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'resumeEscalationGameFromFork' })).rejects.toThrow('Portfolio response period has not started')
		await ethereum.setTime(wallAnchor + 5n * 86_400n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'resumeEscalationGameFromFork' }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkResumedAt' })).toBe(wallAnchor)
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })).toBe(wallAnchor + 3n * 86_400n)
		expect(Number(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getFinalQuestionResolution' }))).toBe(1)
	})

	test('central inherited claim coordinates do not traverse deep live fork history', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		let source: Address = zeroAddress
		for (let depth = 0; depth < 20; depth++) {
			source = await deployContract(owner, encodeDeployData({ abi: checkpointArtifact.abi, bytecode: `0x${checkpointArtifact.evm.bytecode.object}`, args: [source, 2n, 0n, 0n, 0n] }))
		}
		const target = await deployContract(owner, encodeDeployData({ abi: centralCheckpointArtifact.abi, bytecode: `0x${centralCheckpointArtifact.evm.bytecode.object}`, args: [source] }))
		const args = [1, 7n, 19n, 1n] as const
		expect([...(await owner.readContract({ abi: claimArtifact.abi, address: target, functionName: 'getInheritedClaimAllocation', args }))]).toEqual([7n, 7n, 7n, 19n])
		expect([...(await owner.readContract({ abi: claimArtifact.abi, address: target, functionName: 'getClaimCheckpointProgress', args }))]).toEqual([zeroAddress, 0n, true, true])
		const gas = await owner.estimateContractGas({ abi: claimArtifact.abi, address: target, functionName: 'getInheritedClaimAllocation', args })
		expect(gas).toBeLessThan(100_000n)
	})

	test('a wallet can report on an unrelated resumed central continuation', async () => {
		const ethereum = getAnvilWindowEthereum()
		const owner = createWriteClient(ethereum, TEST_ADDRESSES[0])
		await setupTestAccounts(ethereum)
		await ensureZoltarDeployed(owner)
		const wallAnchor = 1_000_000n
		const pool = await deployContract(owner, encodeDeployData({ abi: poolArtifact.abi, bytecode: `0x${poolArtifact.evm.bytecode.object}`, args: [getZoltarAddress(), wallAnchor, 1_000n] }))
		const verifier = await deployContract(owner, encodeDeployData({ abi: verifierArtifact.abi, bytecode: `0x${verifierArtifact.evm.bytecode.object}` }))
		const deposits = await deployContract(owner, encodeDeployData({ abi: depositArtifact.abi, bytecode: `0x${depositArtifact.evm.bytecode.object}` }))
		const claims = await deployContract(owner, encodeDeployData({ abi: claimArtifact.abi, bytecode: `0x${claimArtifact.evm.bytecode.object}` }))
		const game = await deployContract(owner, encodeDeployData({ abi: gameArtifact.abi, bytecode: `0x${gameArtifact.evm.bytecode.object}`, args: [pool, getRepTokenAddress(0n), verifier, claims, deposits] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'setEscalationGame', args: [game] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: gameArtifact.abi, address: game, functionName: 'startFromFork', args: [1n, 1_000n, 0n, 3, false, 0n] }))
		for (let outcome = 0; outcome < 3; outcome++) {
			await writeContractAndWait(owner, () =>
				owner.writeContract({
					abi: initializeForkCarrySnapshotAbi,
					address: pool,
					functionName: 'initializeForkCarrySnapshot',
					args: [
						[zeroPeakArray(), zeroPeakArray(), zeroPeakArray()],
						[0n, 0n, 0n],
						[0n, 0n, 0n],
						[zeroHash(), zeroHash(), zeroHash()],
					],
				}),
			)
		}
		await ethereum.setTime(wallAnchor + 10n)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'resumeEscalationGameFromFork' }))
		await approveToken(owner, getRepTokenAddress(0n), game)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: gameArtifact.abi, address: game, functionName: 'depositRepOnOutcome', args: [1, 1n] }))
		expect(await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getOutcomeBalancesAttoRep' })).toEqual([0n, 1n, 0n])
		expect(await owner.readContract({ abi: poolArtifact.abi, address: pool, functionName: 'lastReporter' })).toBe(owner.account.address)
		await expect(owner.writeContract({ abi: poolArtifact.abi, address: pool, functionName: 'onQuestionReporterChanged', args: [owner.account.address] })).rejects.toThrow('Only test game')
	})
})
