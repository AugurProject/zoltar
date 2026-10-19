import { describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolFixedAdmissionPolicy_SecurityPoolFixedAdmissionPolicy as fixedArtifact,
	test_statoblast_QuestionAdmissionPolicyHarness_QuestionAdmissionPolicyHarness as policyHarnessArtifact,
} from '../../types/contractArtifact'
import { deployContract } from '../../testSupport/deployContract'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses, applyLibraries, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { maximumQuestionHorizonSeconds, portfolioEconomics, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: pluggable question admission', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const deployPortfolio = async (policy: Address, economics = portfolioEconomics) =>
		await deployContract(
			fixture.owner(),
			encodeDeployData({
				abi: portfolioArtifact.abi,
				bytecode: applyLibraries(portfolioArtifact.evm.bytecode.object),
				args: [getInfraContractAddresses().securityPoolFactory, fixture.base.securityPoolAddresses.securityPool, maximumQuestionHorizonSeconds, getInfraContractAddresses().securityPoolPortfolioVaultDeployer, policy, economics],
			}),
		)
	const deployFixed = async (questions: bigint[], universe = fixture.base.genesisUniverse) => await deployContract(fixture.owner(), encodeDeployData({ abi: fixedArtifact.abi, bytecode: applyLibraries(fixedArtifact.evm.bytecode.object), args: [universe, questions] }))
	const register = (portfolio: Address, questionId: bigint) => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'addQuestion', args: [questionId] }))

	test('fixed admission binds immutable membership to its universe and supports lazy permissionless registration', async () => {
		const policy = await deployFixed([fixture.base.questionId])
		const portfolio = await deployPortfolio(policy)
		await register(portfolio, fixture.base.questionId)
		await register(portfolio, fixture.base.questionId)
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'questionCount' })).toBe(1n)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [0n, 64n] })).toEqual([fixture.base.questionId])
		await expect(register(portfolio, fixture.secondQuestionId)).rejects.toThrow('Question rejected by admission policy')
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [fixture.secondQuestionId, fixture.other().account.address, 0n, unit], value: 2n * unit }))).rejects.toThrow(
			'Question rejected by admission policy',
		)
		const wrongUniversePolicy = await deployFixed([fixture.base.questionId], fixture.base.genesisUniverse + 1n)
		await expect(register(await deployPortfolio(wrongUniversePolicy), fixture.base.questionId)).rejects.toThrow('Question rejected by admission policy')
	})

	test('the enumerated fixed list is the only source of membership and rejects unsorted deployment', async () => {
		const questions = [fixture.base.questionId, fixture.secondQuestionId].toSorted((left, right) => (left < right ? -1 : 1))
		const policy = await deployFixed(questions)
		for (const questionId of questions) expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.portfolio, fixture.base.genesisUniverse, questionId] })).toBe(true)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [0n, 64n] })).toEqual(questions)
		expect(await fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'isQuestionAllowed', args: [fixture.portfolio, fixture.base.genesisUniverse, 0n] })).toBe(false)
		await expect(deployFixed(questions.toReversed())).rejects.toThrow('Choose increasing unique questions')
	})

	test('fixed admission rejects duplicate or empty lists and invalid page boundaries', async () => {
		await expect(deployFixed([])).rejects.toThrow('Question list empty')
		await expect(deployFixed([fixture.base.questionId, fixture.base.questionId])).rejects.toThrow('Choose increasing unique questions')
		const policy = await deployFixed([fixture.base.questionId])
		await expect(fixture.owner().readContract({ abi: fixedArtifact.abi, address: policy, functionName: 'getQuestions', args: [2n, 1n] })).rejects.toThrow('Invalid page')
		await expect(deployPortfolio(zeroAddress)).rejects.toThrow('Admission policy has no code')
	})

	test('custom policies are checked again for registered purchases and cannot block exits or recovery', async () => {
		const policy = await deployContract(fixture.owner(), encodeDeployData({ abi: policyHarnessArtifact.abi, bytecode: applyLibraries(policyHarnessArtifact.evm.bytecode.object) }))
		const portfolio = await deployPortfolio(policy)
		await register(portfolio, fixture.base.questionId)
		const pool = getSecurityPoolAddresses(zeroAddress, fixture.base.genesisUniverse, fixture.base.questionId, fixture.base.statoblastSecurityMultiplierBps, fixture.base.genesisUniverse, DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, portfolio)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), portfolio)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'deposit', args: [1_000n * unit, 1n] }))
		await manipulatePriceOracle(fixture.owner(), fixture.base.mockWindow, pool.openOraclePriceCoordinator)
		const [, purchaseFee] = await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteMint', args: [fixture.base.questionId, 10n * unit] })
		const mint = () => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [fixture.base.questionId, fixture.other().account.address, 0n, 10n * unit], value: 10n * unit + purchaseFee }))
		await mint()
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyHarnessArtifact.abi, address: policy, functionName: 'setState', args: [false, false] }))
		await expect(mint()).rejects.toThrow('Question rejected by admission policy')
		await expect(register(portfolio, fixture.base.questionId)).rejects.toThrow('Question rejected by admission policy')
		await expect(fixture.owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteMint', args: [fixture.base.questionId, unit] })).rejects.toThrow('Question rejected by admission policy')
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: policyHarnessArtifact.abi, address: policy, functionName: 'setState', args: [false, true] }))
		await expect(mint()).rejects.toThrow('Admission unavailable')
		await redeemCompleteSet(fixture.other(), pool.securityPool, 10n * unit)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'recyclePosition', args: [1n] }))
		expect(await fixture.owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'totalAssets' })).toBe(1_000n * unit)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'withdraw', args: [1_000n * unit, 1_000n * unit] }))
	})

	for (const [change, message] of [
		[{ targetHealthFactorBps: 9_999n }, 'Health factor below native floor'],
		[{ purchaseFeeBps: 10_001n }, 'Purchase fee exceeds 100 percent'],
		[{ minimumPurchaseFeeAttoEth: 0n }, 'Purchase fee does not fund completion'],
		[{ completionRewardAttoEth: 0n, ownershipChangeFeeAttoEth: 1n }, 'Ownership fee needs completion reward'],
	] as const) {
		test(`rejects invalid immutable economics: ${message}`, async () => {
			await expect(deployPortfolio(fixture.questionAdmissionPolicy, { ...portfolioEconomics, ...change })).rejects.toThrow(message)
		})
	}
})
