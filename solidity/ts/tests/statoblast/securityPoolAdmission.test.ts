import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildSecurityPoolAddQuestionRequest } from '@zoltar/statoblast-shared/statoblast/securityPool'
import {
	statoblast_SecurityPool_SecurityPool as securityPoolArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinator as forkArtifact,
	statoblast_QuestionForker_QuestionForker as nativeForkArtifact,
	statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact,
	test_statoblast_QuestionAdmissionPolicyHarness_QuestionAdmissionPolicyHarness as policyArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/questionLedger'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { initiateQuestionLedgerFork } from '../../testSupport/simulator/utils/contracts/questionForker'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { unit, useSecurityPoolFixture } from './securityPoolFixture'

describe('Statoblast: pluggable question admission', () => {
	const fixture = useSecurityPoolFixture()
	const deployFixed = (questions: bigint[], universe = fixture.base.genesisUniverse) => deployContract(fixture.owner(), encodeDeployData({ abi: fixedArtifact.abi, bytecode: `0x${fixedArtifact.evm.bytecode.object}`, args: [universe, questions] }))

	test('the interface’s maximum list of 700 full-width question IDs fits the transaction gas cap (#1354)', async () => {
		const owner = fixture.owner()
		const questions = Array.from({ length: 700 }, (_, index) => (1n << 256n) - 700n + BigInt(index))
		const transactionGasLimit = 16_777_216n
		const data = encodeDeployData({ abi: fixedArtifact.abi, bytecode: `0x${fixedArtifact.evm.bytecode.object}`, args: [fixture.base.genesisUniverse, questions] })
		const hash = await writeContractAndWait(owner, () => owner.sendTransaction({ data, gas: transactionGasLimit }))
		const receipt = await owner.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === undefined) throw new Error('Missing fixed admission policy')
		expect(receipt.gasUsed).toBeLessThan(transactionGasLimit)
		expect(await owner.readContract({ abi: fixedArtifact.abi, address: receipt.contractAddress, functionName: 'questionCount' })).toBe(700n)
	})

	test('fixed membership permits lazy registration and rejects other questions or universes', async () => {
		const policy = await deployFixed([fixture.base.questionId])
		const securityPool = await fixture.deploySecurityPool(policy)
		const sender = fixture.other()
		const register = (questionId: bigint, namespace = securityPool) => writeContractAndWait(sender, () => sender.sendTransaction(buildSecurityPoolAddQuestionRequest({ caller: sender.account.address, securityPool: namespace, questionId })))
		await register(fixture.base.questionId)
		await register(fixture.base.questionId)
		expect(await fixture.owner().readContract({ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'questionCount' })).toBe(1n)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [0n, 64n] })).toEqual([fixture.base.questionId])
		await expect(register(fixture.secondQuestionId)).rejects.toThrow('Question rejected by admission policy')
		await expect(fixture.mint(unit, fixture.secondQuestionId, { namespace: securityPool })).rejects.toThrow('Question rejected by admission policy')
		const wrongUniverse = await deployFixed([fixture.base.questionId], fixture.base.genesisUniverse + 1n)
		await expect(register(fixture.base.questionId, await fixture.deploySecurityPool(wrongUniverse))).rejects.toThrow('Question rejected by admission policy')
	})

	test('fixed membership cannot hide alternate entries and rejects invalid lists or pages', async () => {
		const questions = [fixture.base.questionId, fixture.secondQuestionId].toSorted((a, b) => (a < b ? -1 : 1))
		const policy = await deployFixed(questions)
		for (const question of questions) expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.securityPool, fixture.base.genesisUniverse, question] })).toBe(true)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.securityPool, fixture.base.genesisUniverse, 0n] })).toBe(false)
		await expect(deployFixed(questions.toReversed())).rejects.toThrow('Choose increasing unique questions')
		await expect(deployFixed([])).rejects.toThrow('Question list empty')
		await expect(deployFixed([fixture.base.questionId, fixture.base.questionId])).rejects.toThrow('Choose increasing unique questions')
		await expect(fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [3n, 1n] })).rejects.toThrow('Invalid page')
		await expect(fixture.deploySecurityPool(zeroAddress)).rejects.toThrow()
	})

	test('a revoked or reverting custom policy prevents purchases but cannot block redemption or principal exit', async () => {
		const policy = await deployContract(fixture.owner(), encodeDeployData({ abi: policyArtifact.abi, bytecode: `0x${policyArtifact.evm.bytecode.object}` }))
		const securityPool = await fixture.deploySecurityPool(policy)
		await fixture.register(fixture.base.questionId, securityPool)
		await fixture.deposit(1_000n * unit, fixture.owner(), securityPool)
		await fixture.refreshPrice(fixture.base.questionId, unit, securityPool)
		await fixture.authorize(100n * unit, fixture.owner(), securityPool)
		await fixture.mint(10n * unit, fixture.base.questionId, { namespace: securityPool })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, false] }))
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: securityPool })).rejects.toThrow('Question rejected by admission policy')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, true] }))
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: securityPool })).rejects.toThrow('Admission unavailable')
		const pool = fixture.poolFor(fixture.base.questionId, fixture.base.genesisUniverse, zeroAddress, securityPool)
		const shares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.questionLedger, shares[0])
		const capital = await fixture.capitalFor(securityPool)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'setCommitment', args: [0n] }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'withdrawPrincipal', args: [1_000n * unit, fixture.owner().account.address] }))
	})

	test('revoking admission also blocks new purchases of an already prepared descendant question', async () => {
		const owner = fixture.owner()
		const universe = fixture.base.genesisUniverse
		const policy = await deployContract(owner, encodeDeployData({ abi: policyArtifact.abi, bytecode: `0x${policyArtifact.evm.bytecode.object}` }))
		const securityPool = await fixture.deploySecurityPool(policy)
		await fixture.register(fixture.secondQuestionId, securityPool)
		const parent = fixture.poolFor(fixture.secondQuestionId, universe, zeroAddress, securityPool).questionLedger
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, fixture.base.questionId)
		await initiateQuestionLedgerFork(owner, parent)
		const forkTime = (await getUniverseData(owner, universe)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		const coordinator = await owner.readContract({ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'forkController' })
		const child = getChildUniverseId(universe, QuestionOutcome.No)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'startBranch', args: [universe, BigInt(QuestionOutcome.No)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: nativeForkArtifact.abi, address: getInfraContractAddresses().questionForker, functionName: 'prepareSecurityPoolQuestion', args: [parent, child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, false] }))
		await expect(owner.writeContract({ abi: securityPoolArtifact.abi, address: securityPool, functionName: 'createCompleteSet', args: [child, fixture.secondQuestionId, unit, owner.account.address, 0n, 2n * unit - unit], value: 0n })).rejects.toThrow('Question rejected by admission policy')
	})
})
