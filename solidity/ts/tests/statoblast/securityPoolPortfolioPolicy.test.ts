import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator as coordinatorArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { emptyOperations, unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: bounded portfolio allocation policies', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const config = () => ({
		universeId: fixture.base.genesisUniverse,
		executor: fixture.other().account.address,
		expiresAt: fixture.base.questionData.endTime - 1n,
		depositBudgetAttoRep: 2_000n * unit,
		commitmentIncreaseBudgetAttoEth: 200n * unit,
		minimumIdleAttoRep: 100n * unit,
		minimumHealthFactorBps: 12_000n,
	})
	const rules = () => [fixture.base.questionId, fixture.secondQuestionId].map(questionId => ({ questionId, depositBudgetAttoRep: 1_000n * unit, maximumCommitmentAttoEth: 100n * unit }))
	const version = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyVersion' })
	const nonce = async () => await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicyNonce' })
	const install = async (policy = config(), limits = rules(), sender = fixture.owner()) => {
		const expectedVersion = await version()
		const expectedNonce = await nonce()
		return await writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'setAllocationPolicy', args: [expectedVersion, expectedNonce, policy, limits] }))
	}
	const allocate = async (questionId: bigint, deposit = 1_000n * unit, commitment = 100n * unit, expectedVersion?: bigint, expectedNonce?: bigint, sender = fixture.other()) => {
		const allocationVersion = expectedVersion ?? (await version())
		const allocationNonce = expectedNonce ?? (await nonce())
		return await writeContractAndWait(sender, () => sender.writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'executeAllocation', args: [allocationVersion, allocationNonce, questionId, deposit, commitment] }))
	}
	const prepare = async (balance = 2_100n * unit) => {
		await fixture.transferRep(fixture.vault, balance)
		await fixture.refreshPrices([fixture.base.questionId, fixture.secondQuestionId])
	}
	const idle = async () => await getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.vault)

	test('only the owner can install or revoke bounded authority', async () => {
		await expect(install(config(), rules(), fixture.other())).rejects.toThrow('Only vault owner')
		await install()
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'revokeAllocationPolicy' }))).rejects.toThrow('Only vault owner')
		const installedVersion = await version()
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'revokeAllocationPolicy' }))
		expect(await version()).toBe(installedVersion + 1n)
		await expect(allocate(fixture.base.questionId, unit, 0n, installedVersion)).rejects.toThrow()
	})

	test('only approved questions receive separately accounted capital and the idle reserve remains liquid', async () => {
		await prepare()
		await install()
		await expect(allocate(123n)).rejects.toThrow()
		await allocate(fixture.base.questionId)
		await allocate(fixture.secondQuestionId)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(1_000n * unit)
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(1_000n * unit)
		expect(await idle()).toBe(100n * unit)
		expect(await nonce()).toBe(2n)
		expect(await fixture.owner().readContract({ abi: coordinatorArtifact.abi, address: fixture.base.securityPoolAddresses.openOraclePriceCoordinator, functionName: 'getActiveStagedOperationCount' })).toBe(0n)
	})

	test('execution is restricted to the chosen executor or owner and cannot replay', async () => {
		await prepare()
		await install({ ...config(), executor: fixture.owner().account.address })
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Only allocation executor')
		const allocationVersion = await version()
		const allocationNonce = await nonce()
		await allocate(fixture.base.questionId, 1_000n * unit, 100n * unit, allocationVersion, allocationNonce, fixture.owner())
		await expect(allocate(fixture.secondQuestionId, 1_000n * unit, 100n * unit, allocationVersion, allocationNonce, fixture.owner())).rejects.toThrow('Allocation authorization changed')
		expect(await fixture.repClaim(fixture.poolFor(fixture.secondQuestionId).securityPool)).toBe(0n)
		await install()
		await expect(allocate(fixture.secondQuestionId, 1_000n * unit, 100n * unit, allocationVersion)).rejects.toThrow('Allocation authorization changed')
		expect(await nonce()).toBe(allocationNonce + 1n)
	})

	test('separate deposit and commitment steps consume only their own cumulative budgets', async () => {
		await prepare()
		await install()
		await allocate(fixture.base.questionId, 500n * unit, 0n)
		await allocate(fixture.base.questionId, 0n, 100n * unit)
		await allocate(fixture.base.questionId, 100n * unit, 100n * unit)
		const policy = await fixture.owner().readContract({ abi: vaultArtifact.abi, address: fixture.vault, functionName: 'allocationPolicy' })
		expect(policy[2]).toBe(600n * unit)
		expect(policy[3]).toBe(100n * unit)
		expect(await nonce()).toBe(3n)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(600n * unit)
	})

	test('an owner commitment reduction cancels remaining delegated authority before it can rearm the position', async () => {
		await prepare()
		await install()
		await allocate(fixture.base.questionId, 1_000n * unit, 50n * unit)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n })
		await expect(allocate(fixture.base.questionId, 0n, 50n * unit)).rejects.toThrow('Only allocation executor')
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(0n)
	})

	test('install rejects duplicates, missing canonical pools, unbounded lists, expired authority and unsafe health factors', async () => {
		const [first] = rules()
		if (!first) throw new Error('Missing first question rule')
		await expect(install(config(), [first, first])).rejects.toThrow('Duplicate policy question')
		await expect(install(config(), [])).rejects.toThrow('Choose one to sixteen questions')
		await expect(
			install(
				config(),
				Array.from({ length: 17 }, () => first),
			),
		).rejects.toThrow('Choose one to sixteen questions')
		await expect(install(config(), [{ ...first, questionId: 123n }])).rejects.toThrow('Question not registered')
		await expect(install({ ...config(), universeId: 123n })).rejects.toThrow('Question pool unavailable')
		await expect(install({ ...config(), executor: zeroAddress })).rejects.toThrow('Invalid allocation executor')
		await expect(install({ ...config(), executor: fixture.vault })).rejects.toThrow('Invalid allocation executor')
		await expect(install({ ...config(), expiresAt: await fixture.base.mockWindow.getTime() })).rejects.toThrow('Policy already expired')
		await expect(install({ ...config(), minimumHealthFactorBps: 9_999n })).rejects.toThrow('Policy health factor below one')
		expect(await version()).toBe(0n)
	})

	test('expiry and an ended question cannot be bypassed with a fresh price', async () => {
		await prepare()
		const expiresAt = (await fixture.base.mockWindow.getTime()) + 100n
		await install({ ...config(), expiresAt })
		await fixture.base.mockWindow.setTime(expiresAt + 1n)
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Policy expired')
		await install({ ...config(), expiresAt: fixture.secondEndTime })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await fixture.refreshPrice(fixture.base.questionId)
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Allocation question ended')
		await expect(install({ ...config(), expiresAt: fixture.secondEndTime })).rejects.toThrow('Allocation question ended')
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
	})

	test('a universe fork disables policies even on questions whose end is still in the future', async () => {
		await prepare()
		await install({ ...config(), expiresAt: fixture.secondEndTime })
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await expect(allocate(fixture.secondQuestionId)).rejects.toThrow('Allocation universe forked')
		await expect(install({ ...config(), expiresAt: fixture.secondEndTime }, rules().slice(1))).rejects.toThrow('Allocation universe forked')
		expect(await idle()).toBe(2_100n * unit)
	})

	test('stale or pending prices cannot create a delayed automation obligation', async () => {
		await prepare()
		await install()
		await fixture.base.mockWindow.advanceTime(301n)
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Allocation needs settled fresh price')
		expect(await nonce()).toBe(0n)
		expect(await idle()).toBe(2_100n * unit)
		const funding = await fixture.fundVaultOracle(fixture.base.questionId)
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: 500n * unit, changeCommitment: true, commitmentAttoEth: 50n * unit }, { price: unit, value: funding.cost })
		await install()
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Allocation needs settled fresh price')
		expect(await nonce()).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(0n)
	})

	test('per-question and total deposit budgets cannot borrow unused authority from one another', async () => {
		await prepare(3_100n * unit)
		await install({ ...config(), depositBudgetAttoRep: 1_500n * unit })
		await expect(allocate(fixture.base.questionId, 1_001n * unit)).rejects.toThrow('Question deposit budget exceeded')
		await allocate(fixture.base.questionId)
		await expect(allocate(fixture.secondQuestionId, 501n * unit, 50n * unit)).rejects.toThrow('Policy deposit budget exceeded')
		await allocate(fixture.secondQuestionId, 500n * unit, 50n * unit)
		expect(await idle()).toBe(1_600n * unit)
		expect(await nonce()).toBe(2n)
	})

	test('cumulative commitment increases and absolute per-question limits both constrain risk', async () => {
		await prepare()
		await install({ ...config(), commitmentIncreaseBudgetAttoEth: 150n * unit })
		await expect(allocate(fixture.base.questionId, 1_000n * unit, 101n * unit)).rejects.toThrow('Question commitment cap exceeded')
		await allocate(fixture.base.questionId)
		await expect(allocate(fixture.secondQuestionId, 500n * unit, 51n * unit)).rejects.toThrow('Policy commitment budget exceeded')
		await allocate(fixture.secondQuestionId, 500n * unit, 50n * unit)
		await expect(allocate(fixture.secondQuestionId, 100n * unit, 51n * unit)).rejects.toThrow('Policy commitment budget exceeded')
		expect((await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, fixture.vault)).underwritingLimitAttoEth).toBe(50n * unit)
	})

	test('idle reserve and buffered health failures roll back deposit, nonce and budget consumption', async () => {
		await prepare(1_099n * unit)
		await install()
		await expect(allocate(fixture.base.questionId)).rejects.toThrow('Policy idle reserve violated')
		await fixture.transferRep(fixture.vault, unit)
		const multiplier = fixture.base.statoblastSecurityMultiplierBps
		const nativeBacking = (100n * unit * multiplier) / 10_000n
		await expect(allocate(fixture.base.questionId, nativeBacking, 100n * unit)).rejects.toThrow('Policy health buffer violated')
		expect(await idle()).toBe(1_100n * unit)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool)).toBe(0n)
		expect(await nonce()).toBe(0n)
		await allocate(fixture.base.questionId)
		expect(await nonce()).toBe(1n)
		expect(await idle()).toBe(100n * unit)
	})

	test('withdrawal revokes exhausted authority instead of refilling its deposit or commitment budgets', async () => {
		await prepare(1_100n * unit)
		await install({ ...config(), depositBudgetAttoRep: 1_000n * unit, commitmentIncreaseBudgetAttoEth: 100n * unit })
		await allocate(fixture.base.questionId)
		await expect(allocate(fixture.base.questionId, 0n, 99n * unit)).rejects.toThrow('Policy cannot reduce commitment')
		await expect(allocate(fixture.base.questionId, 0n, 100n * unit)).rejects.toThrow('Choose an allocation')
		await expect(allocate(fixture.secondQuestionId)).rejects.toThrow('Policy deposit budget exceeded')
		await expect(allocate(fixture.secondQuestionId, 0n, unit)).rejects.toThrow('Policy commitment budget exceeded')
		const exhaustedVersion = await version()
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), changeCommitment: true, commitmentAttoEth: 0n, withdrawAttoRep: 1_000n * unit })
		expect(await idle()).toBe(1_100n * unit)
		expect(await version()).toBe(exhaustedVersion + 1n)
		await expect(allocate(fixture.secondQuestionId)).rejects.toThrow('Only allocation executor')
		await fixture.submit(fixture.base.questionId, { ...emptyOperations(), depositAttoRep: 1_000n * unit })
		await expect(allocate(fixture.base.questionId, 0n, 100n * unit)).rejects.toThrow('Only allocation executor')
		expect(await version()).toBe(exhaustedVersion + 1n)
		expect(await nonce()).toBe(1n)
	})

	test('a new explicit owner authorization replaces question permissions without resetting the replay nonce', async () => {
		await prepare()
		await install()
		await allocate(fixture.base.questionId)
		const [second] = rules().slice(1)
		if (!second) throw new Error('Missing second question rule')
		await install(config(), [second])
		await expect(allocate(fixture.base.questionId, unit, 100n * unit)).rejects.toThrow('Question not approved by policy')
		expect(await nonce()).toBe(1n)
		await allocate(fixture.secondQuestionId)
		expect(await nonce()).toBe(2n)
	})
})
