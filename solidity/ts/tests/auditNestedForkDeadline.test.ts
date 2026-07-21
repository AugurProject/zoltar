import { beforeEach, describe, test } from 'bun:test'
import { addRepToMigrationBalance, deployChild, getUniverseData, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { usePeripheralsForkMigrationFixture, type PeripheralsForkMigrationFixture } from './peripherals/fixture'
import { getForkActivationTime } from '../testSupport/simulator/utils/contracts/securityPoolForker'

describe('Nested fork migration deadline', () => {
	const fixture = usePeripheralsForkMigrationFixture()
	const assert: PeripheralsForkMigrationFixture['assert'] = fixture.assert
	const {
		DAY,
		approveToken,
		approveAndDepositRep,
		balanceOfShares,
		createChildUniverse,
		createCompleteSet,
		createWriteClient,
		finalizeTruthAuction,
		forkUniverse,
		genesisUniverse,
		getChildUniverseId,
		getCompleteSetCollateralAmount,
		getETHBalance,
		getRepTokenAddress,
		getSecurityPoolAddresses,
		getSecurityPoolForkerForkData,
		getSystemState,
		getZoltarAddress,
		getZoltarForkThreshold,
		initiateSecurityPoolFork,
		manipulatePriceOracleAndPerformOperation,
		migrateShares,
		migrateVault,
		OperationType,
		QuestionOutcome,
		repDeposit,
		securityMultiplier,
		startTruthAuction,
		SystemState,
		TEST_ADDRESSES,
		triggerExternalForkForSecurityPool,
	} = fixture

	let mockWindow: PeripheralsForkMigrationFixture['mockWindow']
	let client: PeripheralsForkMigrationFixture['client']
	let securityPoolAddresses: PeripheralsForkMigrationFixture['securityPoolAddresses']
	let questionId: PeripheralsForkMigrationFixture['questionId']

	beforeEach(() => {
		mockWindow = fixture.mockWindow
		client = fixture.client
		securityPoolAddresses = fixture.securityPoolAddresses
		questionId = fixture.questionId
	})

	test('a delayed canonical pool retains a complete outgoing migration window after an early universe fork', async () => {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveVault, repDeposit, questionId)

		await triggerExternalForkForSecurityPool(client, 'nested deadline parent fork')
		const parentFork = await getUniverseData(client, genesisUniverse)
		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		await deployChild(client, genesisUniverse, BigInt(QuestionOutcome.Yes))

		const childForkThreshold = await getZoltarForkThreshold(client, childUniverse)
		await addRepToMigrationBalance(client, genesisUniverse, childForkThreshold)
		await splitMigrationRep(client, genesisUniverse, childForkThreshold, [QuestionOutcome.Yes])
		await approveToken(client, getRepTokenAddress(childUniverse), getZoltarAddress())
		await forkUniverse(client, childUniverse, parentFork.forkQuestionId)
		const childFork = await getUniverseData(client, childUniverse)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.ForkMigration)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
		assert.ok((await getETHBalance(client, childPool.securityPool)) > 0n)
		assert.ok((await balanceOfShares(client, childPool.shareToken, childUniverse, client.account.address))[QuestionOutcome.Yes] > 0n)

		const migrationTime = 8n * 7n * DAY
		const parentMigrationDeadline = (await getForkActivationTime(client, securityPoolAddresses.securityPool)) + migrationTime
		const expiredUniverseDeadline = childFork.forkTime + migrationTime
		await mockWindow.setTime(parentMigrationDeadline)
		await startTruthAuction(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.ForkTruthAuction)
		const { truthAuctionStarted } = await getSecurityPoolForkerForkData(client, childPool.securityPool)

		const auctionDeadline = truthAuctionStarted + 7n * DAY
		await mockWindow.setTime(auctionDeadline - 1n)
		await assert.rejects(finalizeTruthAuction(client, childPool.securityPool), /Auction open/)
		await mockWindow.setTime(auctionDeadline)
		await finalizeTruthAuction(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.Operational)
		assert.ok((await getCompleteSetCollateralAmount(client, childPool.securityPool)) > 0n)
		assert.ok((await mockWindow.getTime()) > expiredUniverseDeadline)

		await initiateSecurityPoolFork(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.PoolForked)
		await createChildUniverse(client, childPool.securityPool, QuestionOutcome.Yes)
		await migrateShares(client, childPool.shareToken, childUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])

		const grandchildUniverse = getChildUniverseId(childUniverse, QuestionOutcome.Yes)
		assert.ok((await balanceOfShares(client, childPool.shareToken, grandchildUniverse, client.account.address))[QuestionOutcome.Yes] > 0n)
	})
})
