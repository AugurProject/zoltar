import { beforeEach, describe, test } from 'bun:test'
import { usePeripheralsDeploymentAndOwnForkEscalationFixture, type PeripheralsDeploymentAndOwnForkEscalationFixture } from './fixture'
import type { Abi, Address } from '@zoltar/shared/ethereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken } from '../../types/contractArtifact'
import { getQuestionResolution as readQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { deployChild } from '../../testSupport/simulator/utils/contracts/zoltar'
import { finalizeTruthAuction, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { createCarryProof, SparseNullifierTree } from '../carryProofHelpers'

describe('Peripherals: deployment and own-fork escalation', () => {
	const fixture = usePeripheralsDeploymentAndOwnForkEscalationFixture()
	const assert: PeripheralsDeploymentAndOwnForkEscalationFixture['assert'] = fixture.assert
	const strictEqualTypeSafe: PeripheralsDeploymentAndOwnForkEscalationFixture['strictEqualTypeSafe'] = fixture.strictEqualTypeSafe
	const {
		decodeEventLog,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		contractExists,
		getChildUniverseId,
		getERC20Balance,
		sortStringArrayByKeccak,
		addressString,
		approveAndDepositRep,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		deployOriginSecurityPool,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		createQuestion,
		getQuestionId,
		getQuestionEndDate,
		OperationType,
		QuestionOutcome,
		SystemState,
		createChildUniverse,
		getMigratedRep,
		getForkedEscrowChildRepByOutcomeAndVault,
		getOwnForkRepBuckets,
		getQuestionOutcome,
		getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame,
		claimForkedEscalationDeposits,
		migrateRepToZoltar,
		migrateVaultWithUnresolvedEscalation,
		getEscalationGameOutcomeState,
		forkUniverse,
		getRepTokenAddress,
		getTotalTheoreticalSupply,
		getUniverseData,
		getZoltarAddress,
		depositRep,
		depositToEscalationGame,
		getPoolOwnershipDenominator,
		getRepToken,
		getSecurityPoolsEscalationGame,
		getSecurityVault,
		getSystemState,
		poolOwnershipToRep,
		peripherals_EscalationGame_EscalationGame,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		MAX_RETENTION_RATE,
		outcomes,
		deployOwnForkEscalationClaimHarness,
	} = fixture

	let mockWindow: PeripheralsDeploymentAndOwnForkEscalationFixture['mockWindow']
	let client: PeripheralsDeploymentAndOwnForkEscalationFixture['client']
	let securityPoolAddresses: PeripheralsDeploymentAndOwnForkEscalationFixture['securityPoolAddresses']
	let questionEndDate: PeripheralsDeploymentAndOwnForkEscalationFixture['questionEndDate']
	let questionData: PeripheralsDeploymentAndOwnForkEscalationFixture['questionData']
	let questionId: PeripheralsDeploymentAndOwnForkEscalationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionEndDate = fixture.questionEndDate
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	test('cannot deploy security pool with non-binary question', async () => {
		// Create a question with 3 outcomes (not yes/no binary)
		const multiOutcomeQuestionData = {
			title: 'multi outcome test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const multiOutcomes = sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']) // sorted, but not Yes/No
		await createQuestion(client, multiOutcomeQuestionData, multiOutcomes)
		const multiOutcomeQuestionId = getQuestionId(multiOutcomeQuestionData, multiOutcomes)

		// Attempt to deploy security pool with non-binary question should fail.
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, multiOutcomeQuestionId, securityMultiplier), /Security pool question must have exactly two outcomes/)
	})

	test('cannot deploy security pool with scalar question', async () => {
		// Create a scalar question (no outcome labels)
		const scalarQuestionData = {
			title: 'scalar test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 100n,
			displayValueMin: 0n,
			displayValueMax: 100n,
			answerUnit: 'dollars',
		}
		const scalarOutcomes: string[] = []
		await createQuestion(client, scalarQuestionData, scalarOutcomes)
		const scalarQuestionId = getQuestionId(scalarQuestionData, scalarOutcomes)

		// Attempt to deploy security pool with scalar question should fail.
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, scalarQuestionId, securityMultiplier), /Security pool question must have exactly two outcomes/)
	})

	test('cannot deploy security pool with non-existent question', async () => {
		// Use a questionId that has not been created
		const nonExistentQuestionId = 999999999999n

		// Attempt to deploy security pool with non-existent question should fail
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, nonExistentQuestionId, securityMultiplier))
	})

	test('cannot deploy origin security pool in an already-forked universe', async () => {
		const forkSourceQuestionData = {
			...questionData,
			title: `factory fork source ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(client, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkSourceQuestionId)

		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier), /universe has already forked/)
	})

	test('cannot deploy origin security pool in a missing universe', async () => {
		const missingUniverseId = 999999n

		await assert.rejects(deployOriginSecurityPool(client, missingUniverseId, questionId, securityMultiplier), /universe is missing/)
	})

	test('reuses and authorizes the share token when sibling universes deploy the same market', async () => {
		const forkQuestionData = {
			...questionData,
			title: `sibling share token source ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkQuestionId = getQuestionId(forkQuestionData, outcomes)
		await createQuestion(client, forkQuestionData, outcomes)
		await mockWindow.setTime(forkQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkQuestionId)
		for (const outcome of [QuestionOutcome.Yes, QuestionOutcome.No]) {
			await deployChild(client, genesisUniverse, BigInt(outcome))
		}

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		await deployOriginSecurityPool(client, yesUniverse, questionId, securityMultiplier)
		await deployOriginSecurityPool(client, noUniverse, questionId, securityMultiplier)

		const yesPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), yesUniverse, questionId, securityMultiplier)
		const noPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), noUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(yesPoolAddresses.shareToken, noPoolAddresses.shareToken, 'sibling markets should reuse their share token')
		for (const [securityPool, universe] of [
			[yesPoolAddresses.securityPool, yesUniverse],
			[noPoolAddresses.securityPool, noUniverse],
		] as const) {
			await client.simulateContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: yesPoolAddresses.shareToken,
				functionName: 'mintCompleteSets',
				args: [universe, client.account.address, 1n],
				account: securityPool,
			})
		}
		assert.ok(await contractExists(client, yesPoolAddresses.securityPool), 'yes sibling security pool should deploy')
		assert.ok(await contractExists(client, noPoolAddresses.securityPool), 'no sibling security pool should deploy')
	})

	test('origin security pool deployment derives protocol parameters for the first deployer', async () => {
		const createBinaryQuestion = async (title: string) => {
			const deploymentQuestionData = {
				...questionData,
				title,
			}
			await createQuestion(client, deploymentQuestionData, outcomes)
			return getQuestionId(deploymentQuestionData, outcomes)
		}
		const zeroMultiplierQuestionId = await createBinaryQuestion(`zero multiplier ${await mockWindow.getTime()}`)
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, zeroMultiplierQuestionId, 0n), /security multiplier/i)

		const oneMultiplierQuestionId = await createBinaryQuestion(`one multiplier ${await mockWindow.getTime()}`)
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, oneMultiplierQuestionId, 1n), /security multiplier/i)

		const callerRetentionQuestionId = await createBinaryQuestion(`caller retention ${await mockWindow.getTime()}`)
		await deployOriginSecurityPool(client, genesisUniverse, callerRetentionQuestionId, securityMultiplier)
		const callerRetentionPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, callerRetentionQuestionId, securityMultiplier).securityPool
		const retentionRate = await client.readContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			functionName: 'currentRetentionRate',
			address: callerRetentionPool,
			args: [],
		})
		const factoryAddress = getInfraContractAddresses().securityPoolFactory
		const deploymentCount = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentCount',
			address: factoryAddress,
			args: [],
		})
		const deployments = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			address: factoryAddress,
			args: [deploymentCount - 1n, 1n],
		})
		const deployment = deployments[0]
		if (deployment === undefined) throw new Error('origin deployment record missing')

		strictEqualTypeSafe(retentionRate, MAX_RETENTION_RATE, 'origin retention rate should come from protocol math')
		strictEqualTypeSafe(deployment.currentRetentionRate, MAX_RETENTION_RATE, 'origin deployment record should store the protocol retention rate')
	})

	test('can fork security pool using separate initiate and migrate calls with multiple migrations', async () => {
		// Setup: trigger own fork and prepare
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositRep(attackerClient, securityPoolAddresses.securityPool, forkThreshold)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		// Verify the own-game fork left the parent pool fully initialized for migration
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		assert.ok(forkData.auctionableRepAtFork > 0n, 'rep at fork should stay positive after the own-game fork')
		assert.ok(forkData.auctionableRepAtFork <= repBalanceInGenesisPool + forkThreshold * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')

		// Step 2: Call migrateRepToZoltar separately for each outcome
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.No])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid])

		// Additional migration is idempotent once all REP for the branch has been split.
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		// Create child security pools to verify outcomes
		// Create Yes child
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Yes child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'Yes outcome should be set')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'YES security pool should exist')

		// Create No child using attacker client
		await createChildUniverse(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkMigration, 'No child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'No outcome should be set')
		assert.ok(await contractExists(client, noSecurityPool.securityPool), 'NO security pool should exist')

		// Create Invalid child using a third client
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createChildUniverse(thirdClient, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.ForkMigration, 'Invalid child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, invalidSecurityPool.securityPool), QuestionOutcome.Invalid, 'Invalid outcome should be set')
		assert.ok(await contractExists(client, invalidSecurityPool.securityPool), 'INVALID security pool should exist')

		const childUniverseIds = [yesUniverse, noUniverse, invalidUniverse]
		strictEqualTypeSafe(new Set(childUniverseIds).size, childUniverseIds.length, 'each supported fork outcome should map to a distinct child universe id')
		const yesUniverseData = await getUniverseData(client, yesUniverse)
		const noUniverseData = await getUniverseData(client, noUniverse)
		const invalidUniverseData = await getUniverseData(client, invalidUniverse)
		strictEqualTypeSafe(yesUniverseData.parentUniverseId, genesisUniverse, 'Yes child should point back to genesis')
		strictEqualTypeSafe(noUniverseData.parentUniverseId, genesisUniverse, 'No child should point back to genesis')
		strictEqualTypeSafe(invalidUniverseData.parentUniverseId, genesisUniverse, 'Invalid child should point back to genesis')
		strictEqualTypeSafe(yesUniverseData.forkingOutcomeIndex, BigInt(QuestionOutcome.Yes), 'Yes child should retain its outcome index')
		strictEqualTypeSafe(noUniverseData.forkingOutcomeIndex, BigInt(QuestionOutcome.No), 'No child should retain its outcome index')
		strictEqualTypeSafe(invalidUniverseData.forkingOutcomeIndex, BigInt(QuestionOutcome.Invalid), 'Invalid child should retain its outcome index')
	})

	test('own-fork initializes unresolved escalation child denominators', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(client, securityPoolAddresses.securityPool, vaultRepNeeded)
		}
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const yesChildVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesChildDenominator = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		assert.ok(yesChildDenominator > 0n, 'own-fork child denominator should be initialized when vault REP at fork is zero')
		strictEqualTypeSafe(yesChildVault.repDepositShare, 0n, 'own-fork escalation claim should not credit child ownership')
		const parentVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(parentVaultAfter.repInEscalationGame < parentVaultBefore.repInEscalationGame, 'unresolved escalation migration should clear parent vault escalation position')
		if (ownForkRepBuckets.vaultRepAtFork === 0n) {
			assert.strictEqual(parentVaultAfter.repDepositShare, 0n, 'all vault REP was in escalation so parent ownership should stay zero')
		}
	})

	test('own-fork claim path keeps denominator valid when all parent vault REP is escrowed', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		const halfVaultRep = vaultRep / 2n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, halfVaultRep)
		const vaultAfterFirstDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepRemaining = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterFirstDeposit.repDepositShare)
		const remainingVaultRep = vaultRepRemaining
		if (remainingVaultRep > 0n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, remainingVaultRep)
		}
		const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentRepAtFork = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, parentVaultBeforeFork.repDepositShare)
		strictEqualTypeSafe(parentRepAtFork, 0n, 'all parent vault REP should be escrowed before own fork')

		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.strictEqual(ownForkRepBuckets.vaultRepAtFork, 0n, 'all-rep-in-escalation scenario should have zero vaultRepAtFork')

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const walletChildRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesChildBalanceAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
		const walletChildRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		const yesChildVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesChildDenominator = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		assert.ok(yesChildDenominator > 0n, 'own-fork child denominator should stay non-zero when all REP is escrowed at fork')
		strictEqualTypeSafe(yesChildBalanceAfterClaim, 0n, 'own-fork escalation claim should not move REP into the child pool')
		strictEqualTypeSafe(yesChildVault.repDepositShare, 0n, 'own-fork escalation claim should not credit child ownership')
		assert.ok(walletChildRepAfterClaim > walletChildRepBeforeClaim, 'own-fork escalation claim should pay child REP directly to the wallet')
	})

	test('direct own-fork escalation claims do not require preparation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vaultBeforeDeposits = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeDeposits = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeDeposits.repDepositShare)
		const vaultRepNeeded = vaultRepBeforeDeposits < 2n * forkThreshold ? 2n * forkThreshold - vaultRepBeforeDeposits : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
		}
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const walletChildRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		const hash = await client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'claimForkedEscalationDeposits',
			args: [securityPoolAddresses.securityPool, client.account.address, Number(QuestionOutcome.Yes), [0n]],
		})
		await client.waitForTransactionReceipt({ hash })
		const walletChildRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		assert.ok(walletChildRepAfterClaim > walletChildRepBeforeClaim, 'own-fork claim should pay child REP without an explicit preparation transaction')
	})

	test('own-fork unresolved escalation migration does not contribute to child migrated REP accounting', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 4n * forkThreshold ? 4n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		assert.ok(vaultRep > 2n * forkThreshold, 'test setup needs unlocked REP alongside the unresolved escalation deposit')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentForkBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		const parentOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const expectedUnlockedMigratedRep = parentOwnershipDenominator === 0n ? 0n : (parentVaultBeforeMigration.repDepositShare * parentForkBuckets.vaultRepAtFork) / parentOwnershipDenominator
		const migratedRepBefore = await getMigratedRep(client, yesChildPool)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const migratedRepAfter = await getMigratedRep(client, yesChildPool)
		const childEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address)
		strictEqualTypeSafe(migratedRepAfter - migratedRepBefore, expectedUnlockedMigratedRep, 'own-fork unresolved migration should count only unlocked pool REP as migrated REP')
		assert.ok(childEscrow > 0n, 'own-fork unresolved migration should record child escalation escrow without preparation')
	})

	test('own-fork unresolved escalation resolves to the selected child outcome after maximum escalation time', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		if (vaultRep < 4n * forkThreshold) await approveAndDepositRep(client, 4n * forkThreshold - vaultRep, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesChildPool)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesChildPool)
		if ((await getSystemState(client, yesChildPool)) === SystemState.ForkTruthAuction) await finalizeTruthAuction(client, yesChildPool)
		const childEscalationEndDate = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getEscalationGameEndDate',
			address: childEscalationGame,
		})
		await mockWindow.setTime(childEscalationEndDate + 1n)

		strictEqualTypeSafe(await readQuestionResolution(client, childEscalationGame), QuestionOutcome.Yes, 'own-fork carried escrow should settle according to the selected child outcome instead of remaining tied forever')

		const winningProof = await createCarryProof(client, await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool), {
			expectedOutcome: QuestionOutcome.Yes,
			parentDepositIndex: 0n,
			leafIndex: 0n,
			merkleMountainRangePeakIndex: 0n,
			merkleMountainRangeSiblings: [],
			nullifierSiblings: new SparseNullifierTree().getProof(0n),
		})
		const childRepToken = getRepTokenAddress(yesUniverse)
		const walletRepBeforeClaim = await getERC20Balance(client, childRepToken, client.account.address)
		await client.writeContract({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			address: yesChildPool,
			functionName: 'withdrawForkedEscalationDeposits',
			args: [QuestionOutcome.Yes, [winningProof]],
		})
		const childYesEscrow = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			functionName: 'getForkedEscrowByVaultAndOutcome',
			address: childEscalationGame,
			args: [client.account.address, QuestionOutcome.Yes],
		})
		assert.ok((await getERC20Balance(client, childRepToken, client.account.address)) > walletRepBeforeClaim, 'own-fork carried winning proof should pay the selected child outcome')
		strictEqualTypeSafe(childYesEscrow[3], childYesEscrow[2], 'own-fork carried winning proof should claim its child escrow')
	})

	test('own-fork unresolved migration still works after a prior own-fork claim reduces parent escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const migratedEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.No, client.account.address)
		assert.ok(migratedEscrow > 0n, 'remaining unresolved own-fork escrow should still migrate after an earlier own-fork claim')
	})

	test('own-fork claim plus unresolved migration partitions the source escrow without replaying the claimed side', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 4n * forkThreshold ? 4n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		assert.ok(vaultRep > 2n * forkThreshold, 'test setup needs unlocked REP alongside the controlled own-fork deposits')
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const yesChildEscalationGame = await getSecurityPoolsEscalationGame(client, yesChildPool)
		const yesChildRepToken = getRepTokenAddress(yesUniverse)
		const aggregateBackingBeforeClaim = await getERC20Balance(client, yesChildRepToken, yesChildEscalationGame)

		const claimHash = await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const claimReceipt = await client.getTransactionReceipt({ hash: claimHash })
		const claimLog = claimReceipt.logs
			.filter(log => log.address.toLowerCase() === getInfraContractAddresses().securityPoolForker.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'ClaimForkedEscalationDepositsToWallet')
		if (claimLog === undefined) throw new Error('ClaimForkedEscalationDepositsToWallet log missing')
		const aggregateBackingAfterClaim = await getERC20Balance(client, yesChildRepToken, yesChildEscalationGame)

		const migrationHash = await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const migrationReceipt = await client.getTransactionReceipt({ hash: migrationHash })
		const exportLog = migrationReceipt.logs
			.filter(log => log.address.toLowerCase() === parentEscalationGame.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: peripherals_EscalationGame_EscalationGame.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'VaultUnresolvedTotalsExported')
		if (exportLog === undefined) throw new Error('VaultUnresolvedTotalsExported log missing after own-fork unresolved migration')

		const childYesEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.No, client.account.address)
		const childYesEscrowState = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: yesChildEscalationGame,
			functionName: 'getForkedEscrowByVaultAndOutcome',
			args: [client.account.address, QuestionOutcome.Yes],
		})
		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const aggregateBackingAfterMigration = await getERC20Balance(client, yesChildRepToken, yesChildEscalationGame)

		strictEqualTypeSafe(aggregateBackingBeforeClaim - aggregateBackingAfterClaim, claimLog.args.walletRepPaid, 'the direct claim should be paid from the selected childs aggregate escalation backing')
		strictEqualTypeSafe(aggregateBackingAfterMigration, aggregateBackingAfterClaim, 'logical entitlement materialization should not mint or transfer additional child REP')
		assert.deepStrictEqual([...exportLog.args.principalByOutcome], [0n, 0n, forkThreshold], 'unresolved migration should export only the remaining no-side source principal after the yes-side claim')
		strictEqualTypeSafe(exportLog.args.principalToTransfer, forkThreshold, 'unresolved migration should consume only the remaining no-side source principal')
		strictEqualTypeSafe(exportLog.args.repReceiver.toLowerCase(), addressString(0n).toLowerCase(), 'own-fork unresolved migration should not transfer parent REP to a receiver')
		strictEqualTypeSafe(exportLog.args.transferredRep, false, 'own-fork unresolved migration should not repeat the aggregate fork-time REP transfer')
		assert.ok(claimLog.args.sourceRepClaimed > forkThreshold, 'the winning claim should pay out more than principal when it consumes the losing-side escrow')
		strictEqualTypeSafe(childYesEscrowState[3], childYesEscrow, 'the direct yes-side claim should leave its child escrow history fully claimed')
		assert.ok(childNoEscrow > 0n, 'the remaining no-side deposit should still migrate into child escrow')
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'mixed own-fork claim and unresolved migration should clear the parent vault escalation lock')
	})

	test('direct own-fork unresolved migration allows arbitrary vault order without preparation', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await approveAndDepositRep(client, 2n * forkThreshold, questionId)
		await approveAndDepositRep(attackerClient, 2n * forkThreshold, questionId)
		const clientYesEscalation = forkThreshold / 2n
		const attackerYesEscalation = forkThreshold - clientYesEscalation
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, clientYesEscalation)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, attackerYesEscalation)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const clientEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address)
		const attackerEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, attackerClient.account.address)
		assert.ok(clientEscrow > 0n, 'direct migration should allow the client vault to migrate')
		assert.ok(attackerEscrow > 0n, 'direct migration should allow the attacker vault to migrate')
	})

	test('own-fork unresolved migration can migrate to the invalid child branch without preparation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeFork = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeFork.repDepositShare)
		const vaultRepNeeded = vaultRepBeforeFork < 2n * forkThreshold ? 2n * forkThreshold - vaultRepBeforeFork : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
		}
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const parentInvalidOutcomeState = await getEscalationGameOutcomeState(client, parentEscalationGame, QuestionOutcome.Invalid)
		const parentYesOutcomeState = await getEscalationGameOutcomeState(client, parentEscalationGame, QuestionOutcome.Yes)
		const parentNoOutcomeState = await getEscalationGameOutcomeState(client, parentEscalationGame, QuestionOutcome.No)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Invalid)

		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		const invalidEscalationGame = await getSecurityPoolsEscalationGame(client, invalidSecurityPool.securityPool)
		const invalidOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.Invalid)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.Yes)
		const noOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.No)
		const childEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Invalid, client.account.address)
		const childYesEscrowByOriginalDepositOutcome = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowByOriginalDepositOutcome = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childEscrowByOriginalDepositOutcome = childYesEscrowByOriginalDepositOutcome + childNoEscrowByOriginalDepositOutcome
		strictEqualTypeSafe(childEscrow, 0n, 'invalid child migration should not record forked escrow against the child branch outcome')
		assert.ok(childEscrowByOriginalDepositOutcome > 0n, 'invalid child migration should record forked escrow against the original deposit outcome')
		strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidOutcomeState.balance, 'invalid child continuation should preserve the parent invalid balance')
		strictEqualTypeSafe(yesOutcomeState.balance, parentYesOutcomeState.balance, 'invalid child continuation should preserve the parent yes balance')
		strictEqualTypeSafe(noOutcomeState.balance, parentNoOutcomeState.balance, 'invalid child continuation should preserve the parent no balance')
	})

	test('own-fork escalation claim zero child allocation does not revert', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const parent = securityPoolAddresses.securityPool

		await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'setOwnForkRepBuckets',
			args: [parent, 1n, 2n],
		})

		const claimHash = await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationClaim',
			args: [parent, 1n],
		})
		await client.waitForTransactionReceipt({ hash: claimHash })
	})

	test('own-fork escalation claim rounds positive source claims up to non-zero child REP', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const parent = securityPoolAddresses.securityPool
		const previewOwnForkEscalationClaimAbi = [
			{
				inputs: [
					{
						internalType: 'address',
						name: 'parent',
						type: 'address',
					},
					{
						internalType: 'uint256',
						name: 'sourceRepAmount',
						type: 'uint256',
					},
				],
				name: 'previewOwnForkEscalationClaim',
				outputs: [
					{
						internalType: 'uint256',
						name: 'childRepAmount',
						type: 'uint256',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
		] as const satisfies Abi

		await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'setOwnForkRepBuckets',
			args: [parent, 1n, 2n],
		})

		const childRepAmount = await client.readContract({
			abi: previewOwnForkEscalationClaimAbi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationClaim',
			args: [parent, 1n],
		})

		strictEqualTypeSafe(childRepAmount, 1n, 'a positive own-fork claim should round up to non-zero child REP')
	})

	test('own-fork escalation ownership credit rounds up small positive claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()

		const ownershipToCredit = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationOwnershipToCredit',
			args: [1n, 1n, 2n],
		})

		strictEqualTypeSafe(ownershipToCredit, 1n, 'a positive child REP claim should round up to at least one ownership unit')
	})

	test('own-fork escalation ownership credit stays conserved across split claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const [credits, totalOwnershipClaimed] = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationOwnershipSequence',
			args: [[1n, 1n], 3n, 2n],
		})

		assert.deepStrictEqual(credits, [2n, 1n], 'split own-fork claims should allocate the remaining ownership rather than rounding each claim independently')
		strictEqualTypeSafe(totalOwnershipClaimed, 3n, 'split own-fork claims should never mint more than the fixed child ownership denominator')
	})

	test('own-fork escalation collateral stays conserved across split claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const [collateralTransfers, totalCollateralTransferred] = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationCollateralSequence',
			args: [[1n, 1n], 3n, 2n],
		})

		assert.deepStrictEqual(collateralTransfers, [2n, 1n], 'split own-fork claims should transfer collateral from the fixed fork snapshot, not from the shrinking remainder')
		strictEqualTypeSafe(totalCollateralTransferred, 3n, 'split own-fork claims should transfer the same total collateral as a single combined claim')
	})

	test('own-fork escalation claim zero child allocation returns without moving child balance', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const parent = securityPoolAddresses.securityPool
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, parent))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, parent, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, parent, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, parent, client.account.address)
			vaultRep = await poolOwnershipToRep(client, parent, vault.repDepositShare)
		}
		assert.ok(vaultRep >= 2n * forkThreshold, 'test setup needs enough REP to trigger own fork')
		await triggerOwnGameFork(client, parent)

		const childRepAtForkSlot = getMappingStorageSlot(parent, 0n)
		const escalationChildRepAtForkSlot = formatStorageSlot(childRepAtForkSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[escalationChildRepAtForkSlot]: 0n,
				},
			},
		})

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(parent, yesUniverse, questionId, securityMultiplier)
		const parentVaultBefore = await getSecurityVault(client, parent, client.account.address)
		const yesRepTokenAddress = getRepTokenAddress(yesUniverse)
		const childBalanceBefore = (await contractExists(client, yesRepTokenAddress)) ? await getERC20Balance(client, yesRepTokenAddress, yesSecurityPool.securityPool) : 0n

		await claimForkedEscalationDeposits(client, parent, client.account.address, QuestionOutcome.Yes, [0n])

		const parentVaultAfter = await getSecurityVault(client, parent, client.account.address)
		const childBalanceAfter = (await contractExists(client, yesRepTokenAddress)) ? await getERC20Balance(client, yesRepTokenAddress, yesSecurityPool.securityPool) : 0n
		const childVaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		strictEqualTypeSafe(childBalanceAfter, childBalanceBefore, 'zero-child own-fork settlement should not move REP into the child pool')
		strictEqualTypeSafe(childVaultAfter.repDepositShare, 0n, 'zero-child own-fork settlement should not credit child ownership')
		assert.ok(parentVaultAfter.repInEscalationGame < parentVaultBefore.repInEscalationGame, 'zero-child own-fork settlement should consume the claimed parent escalation position')
	})

	test('own-fork escalation claim settlement is order independent across claims', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let clientVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let clientVaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, clientVault.repDepositShare)
		const clientVaultRepNeeded = clientVaultRep < 2n * forkThreshold ? 2n * forkThreshold - clientVaultRep : 0n
		if (clientVaultRepNeeded > 0n) {
			await approveAndDepositRep(client, clientVaultRepNeeded, questionId)
			clientVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			clientVaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, clientVault.repDepositShare)
		}
		const firstYesDeposit = reportBond
		const secondYesDeposit = clientVaultRep / 2n > firstYesDeposit ? clientVaultRep / 2n - firstYesDeposit : 0n
		assert.ok(secondYesDeposit > 0n, 'test setup needs two distinct yes-side deposits')
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstYesDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondYesDeposit)
		const vaultAfterFirstDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepRemaining = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterFirstDeposit.repDepositShare)
		if (vaultRepRemaining > 0n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, vaultRepRemaining)
		}
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const claimOrderSnapshot = await mockWindow.anvilSnapshot()

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])
		const clientChildShareAfterClientFirst = (await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).repDepositShare
		const childBalanceAfterClientFirst = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)

		await mockWindow.anvilRevert(claimOrderSnapshot)

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const clientChildShareAfterAttackerFirst = (await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).repDepositShare
		const childBalanceAfterAttackerFirst = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)

		strictEqualTypeSafe(clientChildShareAfterClientFirst, clientChildShareAfterAttackerFirst, 'client child ownership should not depend on claim order')
		strictEqualTypeSafe(childBalanceAfterClientFirst, childBalanceAfterAttackerFirst, 'child REP balance should not depend on claim order')
	})

	test('own-fork unresolved escalation allocation stays per-vault stable across input order', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const childRepAtFork = 7n * 10n ** 18n
		const vaults: Address[] = [client.account.address, addressString(TEST_ADDRESSES[1]), addressString(TEST_ADDRESSES[2])]
		const sourceAmounts: bigint[] = [10n * 10n ** 18n, 11n * 10n ** 18n, 13n * 10n ** 18n]
		const reversedVaults: Address[] = [vaults[2], vaults[1], vaults[0]]
		const reversedSourceAmounts: bigint[] = [sourceAmounts[2], sourceAmounts[1], sourceAmounts[0]]

		const allocationsInInputOrder = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [vaults, sourceAmounts, childRepAtFork],
		})
		const allocationsInReversedOrder = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [reversedVaults, reversedSourceAmounts, childRepAtFork],
		})

		const allocationByVault = new Map<Address, bigint>()
		for (let index = 0; index < vaults.length; index++) allocationByVault.set(vaults[index], allocationsInInputOrder[index])
		for (let index = 0; index < reversedVaults.length; index++) strictEqualTypeSafe(allocationsInReversedOrder[index], allocationByVault.get(reversedVaults[index]) ?? 0n, 'each vault should keep the same fixed-rate allocation regardless of batch order')
	})

	test('own-fork unresolved escalation allocation uses a fixed per-vault rate and leaves residual dust', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const vaults: Address[] = [client.account.address, addressString(TEST_ADDRESSES[1])]
		const sourceAmounts: bigint[] = [1n, 1n]
		const childRepAtFork = 1n
		const childAmounts = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [vaults, sourceAmounts, childRepAtFork],
		})

		assert.deepStrictEqual(childAmounts, [0n, 0n], 'each vault should receive its independently rounded-down fixed-rate share')
		strictEqualTypeSafe(childAmounts[0] + childAmounts[1], 0n, 'fixed-rate unresolved migration should be allowed to leave residual child REP dust unallocated')
	})

	test('own-fork unresolved escalation allocation stays stable across pools with different vault creation order', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const baseSnapshot = await mockWindow.anvilSnapshot()
		const runScenario = async (questionTitleSuffix: string, vaultCreationOrder: Address[]) => {
			const scenarioQuestionData = {
				...questionData,
				title: `${questionData.title} ${questionTitleSuffix}`,
				endTime: questionData.endTime + DAY,
			}
			const scenarioQuestionId = getQuestionId(scenarioQuestionData, outcomes)
			await createQuestion(client, scenarioQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, scenarioQuestionId, securityMultiplier)
			const scenarioPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, scenarioQuestionId, securityMultiplier).securityPool
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, scenarioPool))) / 20n / securityMultiplier
			const depositorsByAddress = new Map<Address, WriteClient>([
				[client.account.address, client],
				[attackerClient.account.address, attackerClient],
			])
			for (const vault of vaultCreationOrder) {
				const depositor = depositorsByAddress.get(vault)
				if (depositor === undefined) throw new Error(`missing depositor for ${vault}`)
				await approveAndDepositRep(depositor, 2n * forkThreshold, scenarioQuestionId)
			}
			await mockWindow.setTime(scenarioQuestionData.endTime + 10n * DAY)
			const clientYesEscalation = forkThreshold / 2n
			const attackerYesEscalation = forkThreshold - clientYesEscalation
			await depositToEscalationGame(client, scenarioPool, QuestionOutcome.Yes, clientYesEscalation)
			await depositToEscalationGame(attackerClient, scenarioPool, QuestionOutcome.Yes, attackerYesEscalation)
			await depositToEscalationGame(client, scenarioPool, QuestionOutcome.No, forkThreshold)

			await forkZoltarWithOwnEscalationGame(client, scenarioPool)
			await migrateRepToZoltar(client, scenarioPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, scenarioPool, QuestionOutcome.Yes)

			const parentEscalationGame = await getSecurityPoolsEscalationGame(client, scenarioPool)
			const decodeNoTransferVaultTotalsExported = async (transactionHash: `0x${string}`) => {
				const receipt = await client.getTransactionReceipt({ hash: transactionHash })
				const log = receipt.logs
					.filter(receiptLog => receiptLog.address.toLowerCase() === parentEscalationGame.toLowerCase())
					.map(receiptLog =>
						decodeEventLog({
							abi: peripherals_EscalationGame_EscalationGame.abi,
							data: receiptLog.data,
							topics: receiptLog.topics,
						}),
					)
					.find(receiptLog => receiptLog.eventName === 'VaultUnresolvedTotalsExported')
				if (log === undefined) throw new Error('own-fork VaultUnresolvedTotalsExported log missing')
				return log
			}
			const clientMigrationHash = await migrateVaultWithUnresolvedEscalation(client, scenarioPool, client.account.address, QuestionOutcome.Yes)
			const noTransferExportLog = await decodeNoTransferVaultTotalsExported(clientMigrationHash)
			strictEqualTypeSafe(noTransferExportLog.args.vault.toLowerCase(), client.account.address.toLowerCase(), 'own-fork export log should identify the client vault')
			strictEqualTypeSafe(noTransferExportLog.args.repReceiver.toLowerCase(), addressString(0n).toLowerCase(), 'own-fork export should not set a REP receiver')
			assert.deepStrictEqual([...noTransferExportLog.args.principalByOutcome], [0n, clientYesEscalation, forkThreshold], 'own-fork export log should preserve source principal by original outcome')
			strictEqualTypeSafe(noTransferExportLog.args.principalToTransfer, clientYesEscalation + forkThreshold, 'own-fork export log should report the consumed unresolved principal')
			strictEqualTypeSafe(noTransferExportLog.args.transferredRep, false, 'own-fork unresolved export should not transfer parent REP')
			await migrateVaultWithUnresolvedEscalation(attackerClient, scenarioPool, attackerClient.account.address, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(scenarioPool, yesUniverse, scenarioQuestionId, securityMultiplier).securityPool
			return {
				clientEscrow: await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address),
				attackerEscrow: await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, attackerClient.account.address),
			}
		}

		const firstScenario = await runScenario('creation order client-first', [client.account.address, attackerClient.account.address])
		await mockWindow.anvilRevert(baseSnapshot)
		const secondScenario = await runScenario('creation order attacker-first', [attackerClient.account.address, client.account.address])

		strictEqualTypeSafe(firstScenario.clientEscrow, secondScenario.clientEscrow, 'client child escrow allocation should not depend on parent vault creation order')
		strictEqualTypeSafe(firstScenario.attackerEscrow, secondScenario.attackerEscrow, 'attacker child escrow allocation should not depend on parent vault creation order')
	})

	test('own-fork unresolved escalation zero child allocation is a no-op', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const exportedAmounts: bigint[] = [3n * reportBond, 5n * reportBond, 7n * reportBond]

		const returnedAmounts = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationNoop',
			args: [exportedAmounts, 0n],
		})

		assert.deepStrictEqual(returnedAmounts, exportedAmounts, 'zero child allocation should preserve exported unresolved deposits')
	})
})
