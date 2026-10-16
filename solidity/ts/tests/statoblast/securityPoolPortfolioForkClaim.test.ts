import { describe, expect, test } from 'bun:test'
import { type Address, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { buildPortfolioPositionForkClaimRequest } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityVault } from '../../testSupport/simulator/utils/contracts/securityPool'
import { finishChildInitialization, initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact, statoblast_SecurityPoolPortfolioVault_SecurityPoolPortfolioVault as vaultArtifact } from '../../types/contractArtifact'
import { unit } from './securityPoolPortfolioFixture'
import { useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'

describe('Statoblast: atomic portfolio fork choice', () => {
	const { fixture, deposit, mint, custody, ownerPositionShares, position } = useAggregatePortfolioFixture()
	const claimAndMigrate = (positionId = 1n, outcome = QuestionOutcome.Yes, sender = fixture.owner()) =>
		writeContractAndWait(sender, () => sender.sendTransaction(buildPortfolioPositionForkClaimRequest({ owner: sender.account.address, portfolio: fixture.portfolio, positionId, intervalId: 0n, outcomeIndex: BigInt(outcome) })))
	const allocate = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint(20n * unit)
	}
	const fork = async () => {
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await initiateSecurityPoolFork(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)
	}
	const prepareChild = async (parent: Address, outcome: QuestionOutcome) => {
		const client = fixture.owner()
		for (const functionName of ['preparePortfolioChildPriceFeed', 'prepareChildPoolDependencies'] as const) await writeContractAndWait(client, () => client.writeContract({ address: getInfraContractAddresses().securityPoolFactory, abi: factoryArtifact.abi, functionName, args: [parent, BigInt(outcome)] }))
		await writeContractAndWait(client, () => client.writeContract({ address: getInfraContractAddresses().securityPoolForker, abi: forkerArtifact.abi, functionName: 'createChildUniverse', args: [parent, BigInt(outcome)] }))
		await finishChildInitialization(client, parent, outcome)
		return fixture.poolFor(fixture.base.questionId, getChildUniverseId(fixture.base.genesisUniverse, outcome), parent).securityPool
	}

	test('an owner prepares a child and claims directly into its selected branch without a recovery job', async () => {
		await allocate()
		await writeContractAndWait(fixture.owner(), () =>
			fixture.owner().writeContract({
				address: fixture.vault,
				abi: vaultArtifact.abi,
				functionName: 'setAllocationPolicy',
				args: [
					0n,
					0n,
					{ universeId: fixture.base.genesisUniverse, executor: fixture.other().account.address, expiresAt: fixture.base.questionData.endTime + DAY, depositBudgetAttoRep: 100n * unit, commitmentIncreaseBudgetAttoEth: 10n * unit, minimumIdleAttoRep: 0n, minimumHealthFactorBps: 12_000n },
					[{ questionId: fixture.base.questionId, depositBudgetAttoRep: 100n * unit, maximumCommitmentAttoEth: 10n * unit }],
				],
			}),
		)
		const source = await custody()
		const parent = fixture.base.securityPoolAddresses.securityPool
		const allocated = await getSecurityVault(fixture.owner(), parent, source)
		await fork()
		const child = await prepareChild(parent, QuestionOutcome.Yes)
		const hash = await claimAndMigrate()
		expect((await fixture.owner().waitForTransactionReceipt({ hash })).gasUsed).toBeLessThanOrEqual(16_777_216n)
		expect(await ownerPositionShares()).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), parent, source)).repBackingUnits).toBe(0n)
		expect((await getSecurityVault(fixture.owner(), parent, fixture.vault)).repBackingUnits).toBe(0n)
		const migrated = await getSecurityVault(fixture.owner(), child, fixture.vault)
		expect(migrated.repBackingUnits).toBeGreaterThan(0n)
		expect(migrated.underwritingLimitAttoEth).toBe(allocated.underwritingLimitAttoEth)
		expect((await fixture.owner().readContract({ address: fixture.vault, abi: vaultArtifact.abi, functionName: 'allocationPolicy' })).config.executor).toBe(zeroAddress)
		expect(await fixture.owner().readContract({ address: fixture.vault, abi: vaultArtifact.abi, functionName: 'allocationPolicyVersion' })).toBe(2n)
	})

	test('owners choose different branches atomically without changing another question or the remaining owner', async () => {
		await deposit()
		await deposit(5_000n * unit, fixture.other())
		const otherVault = await fixture.createVault(fixture.other())
		await fixture.refreshPrice(fixture.base.questionId)
		await mint(20n * unit)
		await mint(20n * unit, fixture.secondQuestionId)
		const parent = fixture.base.securityPoolAddresses.securityPool
		const secondSource = await custody(2n)
		const secondBefore = await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, secondSource)
		await fork()
		const yesChild = await prepareChild(parent, QuestionOutcome.Yes)
		const noChild = await prepareChild(parent, QuestionOutcome.No)
		await claimAndMigrate(1n, QuestionOutcome.Yes)
		expect(await ownerPositionShares(1n, fixture.other().account.address)).toBe(5_000n * unit)
		expect((await getSecurityVault(fixture.owner(), yesChild, fixture.vault)).repBackingUnits).toBeGreaterThan(0n)
		expect((await getSecurityVault(fixture.owner(), noChild, fixture.vault)).repBackingUnits).toBe(0n)
		await claimAndMigrate(1n, QuestionOutcome.No, fixture.other())
		expect((await getSecurityVault(fixture.owner(), noChild, otherVault)).repBackingUnits).toBeGreaterThan(0n)
		expect((await getSecurityVault(fixture.owner(), yesChild, otherVault)).repBackingUnits).toBe(0n)
		expect(await ownerPositionShares(2n)).toBe(5_000n * unit)
		expect(await ownerPositionShares(2n, fixture.other().account.address)).toBe(5_000n * unit)
		expect(await getSecurityVault(fixture.owner(), fixture.poolFor(fixture.secondQuestionId).securityPool, secondSource)).toEqual(secondBefore)
	})

	test('a missing child preparation rolls the allocation claim back completely', async () => {
		await allocate()
		await fork()
		const parent = fixture.base.securityPoolAddresses.securityPool
		const source = await custody()
		const before = await getSecurityVault(fixture.owner(), parent, source)
		const positionBefore = await position()
		await expect(claimAndMigrate()).rejects.toThrow('Prepare shared child price feed')
		expect(await ownerPositionShares()).toBe(5_000n * unit)
		expect(await position()).toEqual(positionBefore)
		expect(await getSecurityVault(fixture.owner(), parent, source)).toEqual(before)
		expect((await getSecurityVault(fixture.owner(), parent, fixture.vault)).repBackingUnits).toBe(0n)
		await prepareChild(parent, QuestionOutcome.Yes)
		await claimAndMigrate()
		expect(await ownerPositionShares()).toBe(0n)
	})

	test('the atomic path refuses to select a branch for an existing individual question position', async () => {
		await allocate()
		await fixture.allocate(fixture.base.questionId)
		await fork()
		const parent = fixture.base.securityPoolAddresses.securityPool
		const before = await getSecurityVault(fixture.owner(), parent, fixture.vault)
		await expect(claimAndMigrate()).rejects.toThrow('Migrate existing question position first')
		expect(await ownerPositionShares()).toBe(5_000n * unit)
		expect(await getSecurityVault(fixture.owner(), parent, fixture.vault)).toEqual(before)
	})

	test('an expired choice rolls the claim back and cannot bypass the native migration deadline', async () => {
		await allocate()
		await fork()
		await prepareChild(fixture.base.securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await fixture.base.mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await expect(claimAndMigrate()).rejects.toThrow('Migration window closed')
		expect(await ownerPositionShares()).toBe(5_000n * unit)
	})

	test('neither another owner nor a direct helper caller can choose the allocation branch', async () => {
		await allocate()
		await fork()
		await prepareChild(fixture.base.securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await expect(claimAndMigrate(1n, QuestionOutcome.Yes, fixture.other())).rejects.toThrow('No allocation position')
		for (const sender of [fixture.owner(), fixture.other()]) await expect(sender.writeContract({ address: fixture.vault, abi: vaultArtifact.abi, functionName: 'migrateClaimedPosition', args: [fixture.base.securityPoolAddresses.securityPool, BigInt(QuestionOutcome.Yes)] })).rejects.toThrow('Only portfolio')
		expect(await ownerPositionShares()).toBe(5_000n * unit)
	})

	test('an unforked question cannot be extracted through the fork-choice path', async () => {
		await allocate()
		await expect(claimAndMigrate()).rejects.toThrow('Question pool not forked')
		expect(await ownerPositionShares()).toBe(5_000n * unit)
	})
})
