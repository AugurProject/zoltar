import { statoblast_SecurityPoolForker_SecurityPoolForker } from '../../../types/contractArtifact'
import { depositRepToVault, getRepToken, getSystemState, redeemRepFromVault } from '../../../testSupport/simulator/utils/contracts/securityPool'
import { forkUniverse, getMigrationRepBalanceAttoRep, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress } from '../../../testSupport/simulator/utils/contracts/zoltar'
import { createChildUniverse, getQuestionOutcome, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateRepToZoltar, migrateVault } from '../../../testSupport/simulator/utils/contracts/securityPoolForker'
import { SystemState } from '../../../testSupport/simulator/types/statoblastTypes'
import { QuestionOutcome } from '../../../testSupport/simulator/types/types'
import { getQuestionEndDate } from '../../../testSupport/simulator/utils/contracts/statoblast'
import { createQuestion } from '../../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { deployOriginSecurityPool, getInfraContractAddresses, getSecurityPoolAddresses } from '../../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveAndDepositRepToVault, triggerOwnGameFork, setVaultCapacityFixture } from '../../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { addressString } from '../../../testSupport/simulator/utils/bigint'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance } from '../../../testSupport/simulator/utils/utilities'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../../testSupport/simulator/utils/constants'
import { createWriteClient } from '../../../testSupport/simulator/utils/clients'
import { strictEqualTypeSafe } from '../../../testSupport/simulator/utils/testUtils'
import assert from '../../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from '../fixture'

describe('Statoblast: truth auction', () => {
	const fixture = useStatoblastTruthAuctionFixture()

	const { repDeposit, genesisUniverse, statoblastSecurityMultiplierBps, outcomes, getYesChildPool } = fixture

	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']

	let client: StatoblastTruthAuctionFixture['client']

	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	let questionData: StatoblastTruthAuctionFixture['questionData']

	let questionId: StatoblastTruthAuctionFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionData = fixture.questionData
		questionId = fixture.questionId
	})

	describe('auction startup and migration isolation', () => {
		test('repro: migrateRepToZoltar shares migration balance across parent pools before child creation', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)

			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first child pool should receive only the REP migrated from the first parent pool')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second child pool should receive only the REP migrated from the second parent pool')
		})

		test('migration proxies deploy lazily at their predicted CREATE2 addresses', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question for proxy deployment checks',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question for proxy deployment checks',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			const securityPoolForkerAddress = getInfraContractAddresses().securityPoolForker
			const firstProxyAddress = await client.readContract({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [securityPoolAddresses.securityPool],
			})
			const secondProxyAddress = await client.readContract({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [secondSecurityPoolAddresses.securityPool],
			})

			assert.ok(!(await contractExists(client, firstProxyAddress)), 'first proxy should not exist before the first parent pool initiates its fork')
			assert.ok(!(await contractExists(client, secondProxyAddress)), 'second proxy should not exist before the second parent pool initiates its fork')

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			assert.ok(await contractExists(client, firstProxyAddress), 'first proxy should deploy when the first parent pool initiates its fork')
			assert.ok(!(await contractExists(client, secondProxyAddress)), 'second proxy should still be absent until its own pool initiates a fork')

			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			assert.ok(await contractExists(client, secondProxyAddress), 'second proxy should deploy when the second parent pool initiates its fork')
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
					functionName: 'getMigrationProxyAddress',
					address: securityPoolForkerAddress,
					args: [securityPoolAddresses.securityPool],
				}),
				firstProxyAddress,
				'first proxy address should stay stable after deployment',
			)
			strictEqualTypeSafe(
				await client.readContract({
					abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
					functionName: 'getMigrationProxyAddress',
					address: securityPoolForkerAddress,
					args: [secondSecurityPoolAddresses.securityPool],
				}),
				secondProxyAddress,
				'second proxy address should stay stable after deployment',
			)
		})

		test('migration proxy balances match the expected lock and sweep flow', async () => {
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question for proxy balance checks',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(client, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
			const securityPoolForkerAddress = getInfraContractAddresses().securityPoolForker
			const migrationProxyAddress = await client.readContract({
				abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [securityPoolAddresses.securityPool],
			})

			assert.ok(!(await contractExists(client, migrationProxyAddress)), 'proxy should not exist before fork initiation')
			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

			const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const yesUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const yesChildRepToken = getRepTokenAddress(yesUniverseId)

			assert.ok(await contractExists(client, migrationProxyAddress), 'proxy should exist after fork initiation')
			strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(genesisUniverse), migrationProxyAddress), 0n, 'proxy should not keep parent REP after locking it into Zoltar')
			strictEqualTypeSafe(await getMigrationRepBalanceAttoRep(client, genesisUniverse, migrationProxyAddress), forkData.auctionableAttoRepAtFork, 'proxy migration ledger should equal the parent pool-held REP tracked at fork time')
			assert.ok(!(await contractExists(client, yesChildRepToken)), 'child REP token should not exist before migration splitting deploys it')

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			assert.ok(await contractExists(client, yesChildRepToken), 'migration splitting should deploy the child REP token')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), forkData.auctionableAttoRepAtFork, 'proxy should temporarily hold the split child REP before the child pool exists')

			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), 0n, 'proxy should sweep child REP away once the child pool exists')
			strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, yesSecurityPool), forkData.auctionableAttoRepAtFork, 'child pool should receive the full split REP after the proxy sweep')
		})

		test('migrateRepToZoltar keeps child-universe REP isolated when both parent pools pre-create the same child outcome', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question with precreated child',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question with precreated child',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)

			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first pre-created child pool should receive only the first parent pool-held REP')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second pre-created child pool should receive only the second parent pool-held REP')
			strictEqualTypeSafe(await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker), 0n, 'forker should not retain child REP after both pre-created child pools are funded')
		})

		test('migrateRepToZoltar keeps later parent pools isolated after an earlier parent already migrated and deployed its child pool', async () => {
			const secondQuestionData = {
				...questionData,
				title: 'second security pool question after first migration',
			}
			const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
			await createQuestion(client, secondQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)

			const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1])
			await approveAndDepositRepToVault(secondPoolOwner, repDeposit, secondQuestionId)

			const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, statoblastSecurityMultiplierBps)
			const forkSourceQuestionData = {
				...questionData,
				title: 'fork source question after first migration',
				endTime: (await mockWindow.getTime()) + DAY,
			}
			const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
			await createQuestion(secondPoolOwner, forkSourceQuestionData, outcomes)
			await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
			await approveToken(secondPoolOwner, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
			await forkUniverse(secondPoolOwner, genesisUniverse, forkSourceQuestionId)

			await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
			const firstPoolForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			await initiateSecurityPoolFork(secondPoolOwner, secondSecurityPoolAddresses.securityPool)
			const secondPoolForkData = await getSecurityPoolForkerForkData(client, secondSecurityPoolAddresses.securityPool)
			await migrateRepToZoltar(secondPoolOwner, secondSecurityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await createChildUniverse(secondPoolOwner, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const yesChildUniverseId = getChildUniverseId(genesisUniverse, BigInt(QuestionOutcome.Yes))
			const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, statoblastSecurityMultiplierBps).securityPool
			const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, statoblastSecurityMultiplierBps).securityPool
			const childRepToken = await getRepToken(client, firstYesChildPool)
			const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
			const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

			strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableAttoRepAtFork, 'the first child pool balance should remain unchanged after the second pool migrates later')
			strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableAttoRepAtFork, 'the second child pool should still receive only its own migrated REP even after the first pool already migrated')
		})

		test('redeemRepFromVault should stay blocked until the own-fork child pool becomes operational', async () => {
			const endTime = await getQuestionEndDate(client, questionId)
			const forkThresholdAttoRep = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
			await depositRepToVault(client, securityPoolAddresses.securityPool, 2n * forkThresholdAttoRep)
			await mockWindow.setTime(endTime + 10000n)
			const securityPoolUnderwritingLimitAttoEth = repDeposit / 4n
			await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, securityPoolUnderwritingLimitAttoEth)

			await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
			await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
			await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

			const { yesSecurityPool } = getYesChildPool()

			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in fork migration before the truth-auction window ends')
			strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork child currently reports a finalized outcome before the pool is operational')
			await assert.rejects(redeemRepFromVault(client, yesSecurityPool.securityPool, client.account.address), /Pool inactive/)
		})
	})
})
