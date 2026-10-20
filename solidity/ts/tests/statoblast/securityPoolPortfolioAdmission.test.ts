import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioAddQuestionRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as nativeForkArtifact,
	statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact,
	test_statoblast_QuestionAdmissionPolicyHarness_QuestionAdmissionPolicyHarness as policyArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { applyLibraries, getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: pluggable question admission', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const deployFixed = (questions: bigint[], universe = fixture.base.genesisUniverse) => deployContract(fixture.owner(), encodeDeployData({ abi: fixedArtifact.abi, bytecode: applyLibraries(fixedArtifact.evm.bytecode.object), args: [universe, questions] }))

	test('fixed membership permits lazy registration and rejects other questions or universes', async () => {
		const policy = await deployFixed([fixture.base.questionId])
		const portfolio = await fixture.deployPortfolio(policy)
		const sender = fixture.other()
		const register = (questionId: bigint, namespace = portfolio) => writeContractAndWait(sender, () => sender.sendTransaction(buildPortfolioAddQuestionRequest({ caller: sender.account.address, portfolio: namespace, questionId })))
		await register(fixture.base.questionId)
		await register(fixture.base.questionId)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(1n)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [0n, 64n] })).toEqual([fixture.base.questionId])
		await expect(register(fixture.secondQuestionId)).rejects.toThrow('Question rejected by admission policy')
		await expect(fixture.mint(unit, fixture.secondQuestionId, { namespace: portfolio })).rejects.toThrow('Question rejected by admission policy')
		const wrongUniverse = await deployFixed([fixture.base.questionId], fixture.base.genesisUniverse + 1n)
		await expect(register(fixture.base.questionId, await fixture.deployPortfolio(wrongUniverse))).rejects.toThrow('Question rejected by admission policy')
	})

	test('fixed membership cannot hide alternate entries and rejects invalid lists or pages', async () => {
		const questions = [fixture.base.questionId, fixture.secondQuestionId].toSorted((a, b) => (a < b ? -1 : 1))
		const policy = await deployFixed(questions)
		for (const question of questions) expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.portfolio, fixture.base.genesisUniverse, question] })).toBe(true)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.portfolio, fixture.base.genesisUniverse, 0n] })).toBe(false)
		await expect(deployFixed(questions.toReversed())).rejects.toThrow('Choose increasing unique questions')
		await expect(deployFixed([])).rejects.toThrow('Question list empty')
		await expect(deployFixed([fixture.base.questionId, fixture.base.questionId])).rejects.toThrow('Choose increasing unique questions')
		await expect(fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [3n, 1n] })).rejects.toThrow('Invalid page')
		await expect(fixture.deployPortfolio(zeroAddress)).rejects.toThrow()
	})

	test('a revoked or reverting custom policy prevents purchases but cannot block redemption or principal exit', async () => {
		const policy = await deployContract(fixture.owner(), encodeDeployData({ abi: policyArtifact.abi, bytecode: applyLibraries(policyArtifact.evm.bytecode.object) }))
		const portfolio = await fixture.deployPortfolio(policy)
		await fixture.register(fixture.base.questionId, portfolio)
		await fixture.deposit(1_000n * unit, fixture.owner(), portfolio)
		await fixture.refreshPrice(fixture.base.questionId, unit, portfolio)
		await fixture.authorize(1_000n * unit, 100n * unit, fixture.owner(), portfolio)
		await fixture.mint(10n * unit, fixture.base.questionId, { namespace: portfolio })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, false] }))
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: portfolio })).rejects.toThrow('Question rejected by admission policy')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, true] }))
		await expect(fixture.mint(unit, fixture.base.questionId, { namespace: portfolio })).rejects.toThrow('Admission unavailable')
		const pool = fixture.poolFor(fixture.base.questionId, fixture.base.genesisUniverse, zeroAddress, portfolio)
		const shares = await balanceOfShares(fixture.owner(), pool.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
		await redeemCompleteSet(fixture.other(), pool.securityPool, shares[0])
		const capital = await fixture.capitalFor(portfolio)
		const owner = await fixture.owner().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'ownerAccount', args: [fixture.owner().account.address] })
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'requestRetirement', args: [owner.positions[0]] }))
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: capitalArtifact.abi, address: capital, functionName: 'withdrawFree', args: [1_000n * unit, fixture.owner().account.address] }))
	})

	test('revoking admission also blocks new purchases of an already prepared descendant question', async () => {
		const owner = fixture.owner()
		const universe = fixture.base.genesisUniverse
		const policy = await deployContract(owner, encodeDeployData({ abi: policyArtifact.abi, bytecode: applyLibraries(policyArtifact.evm.bytecode.object) }))
		const portfolio = await fixture.deployPortfolio(policy)
		await fixture.register(fixture.secondQuestionId, portfolio)
		const parent = fixture.poolFor(fixture.secondQuestionId, universe, zeroAddress, portfolio).securityPool
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(owner, getRepTokenAddress(universe), getZoltarAddress())
		await forkUniverse(owner, universe, fixture.base.questionId)
		await initiateSecurityPoolFork(owner, parent)
		const forkTime = (await getUniverseData(owner, universe)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		const coordinator = await owner.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'forkController' })
		const child = getChildUniverseId(universe, QuestionOutcome.No)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'startBranch', args: [universe, BigInt(QuestionOutcome.No)] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: nativeForkArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [parent, child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: policyArtifact.abi, address: policy, functionName: 'setState', args: [false, false] }))
		await expect(owner.writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [child, fixture.secondQuestionId, unit, owner.account.address, 0n], value: 2n * unit })).rejects.toThrow('Question rejected by admission policy')
	})
})
