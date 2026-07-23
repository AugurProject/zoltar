import { beforeEach, describe, test } from 'bun:test'
import { usePeripheralsDeploymentAndOwnForkEscalationFixture, type PeripheralsDeploymentAndOwnForkEscalationFixture } from './fixture'
import type { Address } from '@zoltar/shared/ethereum'
import type { WriteClient } from '../../testSupport/simulator/utils/clients'
import { peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken } from '../../types/contractArtifact'
import { getQuestionResolution as readQuestionResolution } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { deployChild, getZoltarForkThreshold } from '../../testSupport/simulator/utils/contracts/zoltar'
import { finalizeTruthAuction, initiateSecurityPoolFork, startTruthAuction } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
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

	test('cannot deploy security pool when either binary outcome label is not canonical', async () => {
		const invalidLabelCases = [
			{
				title: 'wrong first binary outcome',
				outcomes: sortStringArrayByKeccak(['Apple', 'Banana']),
				expected: /Security pool first outcome must be Yes/,
			},
			{
				title: 'wrong second binary outcome',
				outcomes: sortStringArrayByKeccak(['Yes', 'Apple']),
				expected: /Security pool second outcome must be No/,
			},
		]

		for (const { expected, outcomes: invalidOutcomes, title } of invalidLabelCases) {
			const invalidQuestionData = {
				...questionData,
				title,
			}
			await createQuestion(client, invalidQuestionData, invalidOutcomes)
			const invalidQuestionId = getQuestionId(invalidQuestionData, invalidOutcomes)

			await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, invalidQuestionId, securityMultiplier), expected)
		}
	})

	test('cannot deploy security pool with non-existent question', async () => {
		// Use a questionId that has not been created
		const nonExistentQuestionId = 999999999999n

		// Attempt to deploy security pool with non-existent question should fail
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, nonExistentQuestionId, securityMultiplier), /Security pool question must exist before deployment/)
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

		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier), /Security pool universe has already forked/)
	})

	test('cannot deploy origin security pool in a missing universe', async () => {
		const missingUniverseId = 999999n

		await assert.rejects(deployOriginSecurityPool(client, missingUniverseId, questionId, securityMultiplier), /Security pool universe is missing a REP token/)
	})

	test('allows an independent descendant origin alongside the inherited child pool', async () => {
		const forkQuestionData = {
			...questionData,
			title: `parallel origin fork source ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkQuestionId = getQuestionId(forkQuestionData, outcomes)
		await createQuestion(client, forkQuestionData, outcomes)
		await mockWindow.setTime(forkQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkQuestionId)
		await deployChild(client, genesisUniverse, BigInt(QuestionOutcome.Yes))

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		await deployOriginSecurityPool(client, yesUniverse, questionId, securityMultiplier)
		const independentOrigin = getSecurityPoolAddresses(addressString(0n), yesUniverse, questionId, securityMultiplier, yesUniverse)
		assert.ok(await contractExists(client, independentOrigin.securityPool), 'the descendant origin pool should deploy in its own lineage')

		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'the inherited child pool should remain deployable beside the independent origin')
		assert.notStrictEqual(independentOrigin.securityPool, yesSecurityPool.securityPool, 'the independent origin and inherited child must have different pool addresses')
		assert.notStrictEqual(independentOrigin.shareToken, yesSecurityPool.shareToken, 'each origin lineage must use a separate collateral token namespace')
		const factory = getInfraContractAddresses().securityPoolFactory
		const inheritedOriginId = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'getSecurityPoolOriginId',
			address: factory,
			args: [securityPoolAddresses.securityPool],
		})
		const independentOriginId = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'getSecurityPoolOriginId',
			address: factory,
			args: [independentOrigin.securityPool],
		})
		strictEqualTypeSafe(
			inheritedOriginId,
			await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'getOriginId',
				address: factory,
				args: [genesisUniverse, questionId, securityMultiplier],
			}),
			'the inherited pool family should retain the Genesis origin hash',
		)
		strictEqualTypeSafe(
			independentOriginId,
			await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'getOriginId',
				address: factory,
				args: [yesUniverse, questionId, securityMultiplier],
			}),
			'the descendant origin should hash its own universe into a distinct family id',
		)
		assert.notStrictEqual(inheritedOriginId, independentOriginId, 'independent origins must create distinct lineage identifiers')
		const inheritedDepositId = await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getEscalationDepositId',
			address: getInfraContractAddresses().securityPoolForker,
			args: [yesSecurityPool.securityPool, QuestionOutcome.Yes, 0n],
		})
		const independentDepositId = await client.readContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'getEscalationDepositId',
			address: getInfraContractAddresses().securityPoolForker,
			args: [independentOrigin.securityPool, QuestionOutcome.Yes, 0n],
		})
		assert.notStrictEqual(inheritedDepositId, independentDepositId, 'the same local deposit index in independent origins must have different global ids')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'getSecurityPool',
				address: factory,
				args: [inheritedOriginId, yesUniverse],
			}),
			yesSecurityPool.securityPool,
			'factory registry should retain the inherited child under its origin lineage',
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'getSecurityPool',
				address: factory,
				args: [independentOriginId, yesUniverse],
			}),
			independentOrigin.securityPool,
			'factory registry should retain the independent descendant origin separately',
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'canonicalPoolByUniverse',
				address: securityPoolAddresses.shareToken,
				args: [yesUniverse],
			}),
			yesSecurityPool.securityPool,
			'share token should authorize exactly the canonical fork child for the child universe',
		)
		await assert.rejects(deployOriginSecurityPool(client, yesUniverse, questionId, securityMultiplier), /Security pool origin and universe already claimed/)
	})

	test('deploys a new origin without scanning higher security-pool ancestors', async () => {
		const firstForkQuestionData = {
			...questionData,
			title: `recursive origin first fork ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(client, firstForkQuestionData, outcomes)
		await mockWindow.setTime(firstForkQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, firstForkQuestionId)
		await deployChild(client, genesisUniverse, BigInt(QuestionOutcome.Yes))

		const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const firstChildRepToken = getRepTokenAddress(firstChildUniverse)
		const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
		const firstChildBalanceSlot = formatStorageSlot(getMappingStorageSlot(client.account.address, 0n))
		await mockWindow.addStateOverrides({
			[firstChildRepToken]: {
				stateDiff: {
					[firstChildBalanceSlot]: firstChildForkThreshold * 2n,
				},
			},
		})

		const secondForkQuestionData = {
			...questionData,
			title: `recursive origin second fork ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const secondForkQuestionId = getQuestionId(secondForkQuestionData, outcomes)
		await createQuestion(client, secondForkQuestionData, outcomes)
		await mockWindow.setTime(secondForkQuestionData.endTime + 1n)
		await approveToken(client, firstChildRepToken, getZoltarAddress())
		await forkUniverse(client, firstChildUniverse, secondForkQuestionId)
		await deployChild(client, firstChildUniverse, BigInt(QuestionOutcome.No))

		const grandchildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.No)
		await deployOriginSecurityPool(client, grandchildUniverse, questionId, securityMultiplier)
		const grandchildOrigin = getSecurityPoolAddresses(addressString(0n), grandchildUniverse, questionId, securityMultiplier, grandchildUniverse)
		assert.ok(await contractExists(client, grandchildOrigin.securityPool), 'a deep descendant should create an independent origin without an ancestor walk')

		const unrelatedQuestionData = {
			...questionData,
			title: `recursive origin unrelated market ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const unrelatedQuestionId = getQuestionId(unrelatedQuestionData, outcomes)
		await createQuestion(client, unrelatedQuestionData, outcomes)
		await deployOriginSecurityPool(client, grandchildUniverse, unrelatedQuestionId, securityMultiplier)
		const unrelatedPool = getSecurityPoolAddresses(addressString(0n), grandchildUniverse, unrelatedQuestionId, securityMultiplier, grandchildUniverse)
		assert.ok(await contractExists(client, unrelatedPool.securityPool), 'a genuinely unrelated grandchild market should remain deployable')
	})

	test('stateful factory sequences keep one canonical collateral ledger per child token namespace', async () => {
		const forkQuestionData = {
			...questionData,
			title: `stateful canonical pool fork ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkQuestionId = getQuestionId(forkQuestionData, outcomes)
		await createQuestion(client, forkQuestionData, outcomes)
		await mockWindow.setTime(forkQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkQuestionId)

		const branchOutcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]
		for (const outcome of branchOutcomes) {
			await deployChild(client, genesisUniverse, BigInt(outcome))
		}
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		let fuzzState = 0x5ec01n
		const shuffledOutcomes = [...branchOutcomes]
		for (let index = shuffledOutcomes.length - 1; index > 0; index--) {
			fuzzState = (fuzzState * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n)
			const swapIndex = Number(fuzzState % BigInt(index + 1))
			const currentOutcome = shuffledOutcomes[index]
			const swapOutcome = shuffledOutcomes[swapIndex]
			if (currentOutcome === undefined || swapOutcome === undefined) throw new Error('stateful outcome shuffle failed')
			shuffledOutcomes[index] = swapOutcome
			shuffledOutcomes[swapIndex] = currentOutcome
		}
		const factory = getInfraContractAddresses().securityPoolFactory
		const inheritedOriginId = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'getSecurityPoolOriginId',
			address: factory,
			args: [securityPoolAddresses.securityPool],
		})

		for (const outcome of shuffledOutcomes) {
			const childUniverse = getChildUniverseId(genesisUniverse, outcome)
			await createChildUniverse(client, securityPoolAddresses.securityPool, outcome)
			const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier).securityPool
			const factoryCanonicalPool = await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				functionName: 'getSecurityPool',
				address: factory,
				args: [inheritedOriginId, childUniverse],
			})
			const tokenCanonicalPool = await client.readContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				functionName: 'canonicalPoolByUniverse',
				address: securityPoolAddresses.shareToken,
				args: [childUniverse],
			})
			strictEqualTypeSafe(factoryCanonicalPool, childPool, 'factory should retain one canonical child collateral ledger')
			strictEqualTypeSafe(tokenCanonicalPool, childPool, 'share token namespace should retain the same canonical child ledger')
			await deployOriginSecurityPool(client, childUniverse, questionId, securityMultiplier)
			const independentOrigin = getSecurityPoolAddresses(addressString(0n), childUniverse, questionId, securityMultiplier, childUniverse)
			assert.notStrictEqual(independentOrigin.securityPool, childPool, 'an independent origin should not replace the inherited child')
			await assert.rejects(deployOriginSecurityPool(client, childUniverse, questionId, securityMultiplier), /Security pool origin and universe already claimed/)
		}
	})

	test('isolates share-token collateral when sibling universes deploy independent origins for the same market', async () => {
		const siblingMarketQuestionData = {
			...questionData,
			title: `sibling market ${await mockWindow.getTime()}`,
		}
		const siblingMarketQuestionId = getQuestionId(siblingMarketQuestionData, outcomes)
		await createQuestion(client, siblingMarketQuestionData, outcomes)
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
		await deployOriginSecurityPool(client, yesUniverse, siblingMarketQuestionId, securityMultiplier)
		await deployOriginSecurityPool(client, noUniverse, siblingMarketQuestionId, securityMultiplier)

		const yesPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), yesUniverse, siblingMarketQuestionId, securityMultiplier, yesUniverse)
		const noPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), noUniverse, siblingMarketQuestionId, securityMultiplier, noUniverse)
		assert.notStrictEqual(yesPoolAddresses.shareToken, noPoolAddresses.shareToken, 'independent sibling origins must not share collateral tokens')
		for (const [securityPool, shareToken, universe] of [
			[yesPoolAddresses.securityPool, yesPoolAddresses.shareToken, yesUniverse],
			[noPoolAddresses.securityPool, noPoolAddresses.shareToken, noUniverse],
		] as const) {
			await client.simulateContract({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				address: shareToken,
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
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, zeroMultiplierQuestionId, 0n), /Security multiplier must be greater than one/)

		const oneMultiplierQuestionId = await createBinaryQuestion(`one multiplier ${await mockWindow.getTime()}`)
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, oneMultiplierQuestionId, 1n), /Security multiplier must be greater than one/)

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
		const duplicateChildStateBefore = {
			childState: await getSystemState(client, yesSecurityPool.securityPool),
			childVault: await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address),
			parentForkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
		}
		await assert.rejects(createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes), /Child pool exists/)
		assert.deepStrictEqual(
			{
				childState: await getSystemState(client, yesSecurityPool.securityPool),
				childVault: await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address),
				parentForkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
			},
			duplicateChildStateBefore,
			'duplicate child creation must preserve the canonical child and parent fork accounting',
		)

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

		const ownForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.strictEqual(ownForkRepBuckets.vaultRepAtFork, 0n, 'all-rep-in-escalation scenario should have zero vaultRepAtFork')
		strictEqualTypeSafe(ownForkRepBuckets.escrowSourceRepAtFork - ownForkRepBuckets.escalationChildRepPerSelectedOutcome, ownForkThreshold / 5n, 'own-fork escalation backing should exclude exactly one fork admission haircut')

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesChildEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesChildEscalationGame), ownForkRepBuckets.escalationChildRepPerSelectedOutcome, 'the child escalation game should receive the post-haircut aggregate backing before claims')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: yesChildEscalationGame,
				functionName: 'isForkCarryFundingComplete',
			}),
			true,
			'aggregate own-fork carry should be fully funded before any depositor claims',
		)
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
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				address: getInfraContractAddresses().securityPoolFactory,
				functionName: 'getSecurityPoolHasInheritedForkOutcome',
				args: [yesChildPool],
			}),
			true,
			'a child should cache that its question was fixed by the parent universe fork',
		)
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

	test('optional own-fork vault migration does not duplicate aggregate escalation backing', async () => {
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
		strictEqualTypeSafe(childEscrow, 0n, 'optional vault migration should not create per-vault child escalation escrow')
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
		const winningPayout = (await getERC20Balance(client, childRepToken, client.account.address)) - walletRepBeforeClaim
		assert.ok(winningPayout > winningProof.amount, 'aggregate post-haircut backing should support the configured winning reward')
		strictEqualTypeSafe(childYesEscrow[3], childYesEscrow[2], 'own-fork carried winning proof should claim its child escrow')
	})

	test('optional vault cleanup still works after a prior own-fork claim reduces parent escrow', async () => {
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
		const parentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(migratedEscrow, 0n, 'optional vault cleanup should not duplicate aggregate child backing')
		strictEqualTypeSafe(parentVault.repInEscalationGame, 0n, 'optional vault cleanup should clear the remaining parent lock after a direct claim')
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
		strictEqualTypeSafe(childNoEscrow, 0n, 'the remaining no-side deposit should remain represented only by aggregate carry backing')
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'mixed own-fork claim and unresolved migration should clear the parent vault escalation lock')
	})

	test('optional own-fork vault cleanup allows arbitrary vault order without preparation', async () => {
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
		const clientParentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerParentVault = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(clientEscrow, 0n, 'client cleanup should not create per-vault child escrow')
		strictEqualTypeSafe(attackerEscrow, 0n, 'attacker cleanup should not create per-vault child escrow')
		strictEqualTypeSafe(clientParentVault.repInEscalationGame, 0n, 'client cleanup should clear its parent lock')
		strictEqualTypeSafe(attackerParentVault.repInEscalationGame, 0n, 'attacker cleanup should clear its parent lock')
	})

	test('optional own-fork vault cleanup works for the invalid child branch without preparation', async () => {
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
		strictEqualTypeSafe(childEscrowByOriginalDepositOutcome, 0n, 'invalid child cleanup should not create per-vault escrow for original outcomes')
		strictEqualTypeSafe(invalidOutcomeState.balance, parentInvalidOutcomeState.balance, 'invalid child continuation should preserve the parent invalid balance')
		strictEqualTypeSafe(yesOutcomeState.balance, parentYesOutcomeState.balance, 'invalid child continuation should preserve the parent yes balance')
		strictEqualTypeSafe(noOutcomeState.balance, parentNoOutcomeState.balance, 'invalid child continuation should preserve the parent no balance')
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

	test('optional own-fork cleanup creates no child escrow regardless of vault creation order', async () => {
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

		strictEqualTypeSafe(firstScenario.clientEscrow, 0n, 'client cleanup should not create per-vault child escrow')
		strictEqualTypeSafe(firstScenario.attackerEscrow, 0n, 'attacker cleanup should not create per-vault child escrow')
		strictEqualTypeSafe(secondScenario.clientEscrow, 0n, 'reordered client cleanup should not create per-vault child escrow')
		strictEqualTypeSafe(secondScenario.attackerEscrow, 0n, 'reordered attacker cleanup should not create per-vault child escrow')
	})
})
