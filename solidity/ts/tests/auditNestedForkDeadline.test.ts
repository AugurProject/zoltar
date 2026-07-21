import { beforeEach, describe, test } from 'bun:test'
import { addRepToMigrationBalance, deployChild, getUniverseData, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { usePeripheralsForkMigrationFixture, type PeripheralsForkMigrationFixture } from './peripherals/fixture'

describe('Audit PoC: nested fork deadline', () => {
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

	test('an early child-universe fork expires before its pool can open the grandchild migration', async () => {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, repDeposit / 4n)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveVault, repDeposit, questionId)

		await triggerExternalForkForSecurityPool(client, 'audit nested deadline parent fork')
		const parentFork = await getUniverseData(client, genesisUniverse)
		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		await deployChild(client, genesisUniverse, BigInt(QuestionOutcome.Yes))

		const childForkThreshold = await getZoltarForkThreshold(client, childUniverse)
		await addRepToMigrationBalance(client, genesisUniverse, childForkThreshold)
		await splitMigrationRep(client, genesisUniverse, childForkThreshold, [QuestionOutcome.Yes])
		const childRepToken = getRepTokenAddress(childUniverse)
		await approveToken(client, childRepToken, getZoltarAddress())
		await forkUniverse(client, childUniverse, parentFork.forkQuestionId)
		const childFork = await getUniverseData(client, childUniverse)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, securityMultiplier)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.ForkMigration, 'the canonical child pool is deployed even though its universe has already forked')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateShares(client, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes])
		assert.ok((await getETHBalance(client, childPool.securityPool)) > 0n, 'the already-forked child pool should hold migrated collateral before it can become operational')
		const childShareBalances = await balanceOfShares(client, childPool.shareToken, childUniverse, client.account.address)
		assert.ok(childShareBalances[QuestionOutcome.Yes] > 0n, 'the already-forked child pool should hold the migrated outcome shares')

		const migrationTime = 8n * 7n * DAY
		const parentMigrationDeadline = parentFork.forkTime + migrationTime
		const childMigrationDeadline = childFork.forkTime + migrationTime
		await mockWindow.setTime(parentMigrationDeadline)
		await startTruthAuction(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.ForkTruthAuction, 'the unmigrated passive vault should force the child through a one-week truth auction')
		assert.ok((await mockWindow.getTime()) <= childMigrationDeadline, 'the truth auction should start before the child migration deadline expires')
		const { truthAuctionStarted } = await getSecurityPoolForkerForkData(client, childPool.securityPool)
		assert.strictEqual(truthAuctionStarted, parentMigrationDeadline + 1n, 'the truth auction should start at the first block after parent migration closes')

		const auctionDeadline = truthAuctionStarted + 7n * DAY
		await mockWindow.setTime(auctionDeadline - 1n)
		await assert.rejects(finalizeTruthAuction(client, childPool.securityPool), /Auction open/)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.ForkTruthAuction, 'the child pool should remain in auction at the exact auction deadline')
		await mockWindow.setTime(auctionDeadline)
		await finalizeTruthAuction(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.Operational)
		assert.ok((await getCompleteSetCollateralAmount(client, childPool.securityPool)) > 0n)
		assert.strictEqual(await mockWindow.getTime(), auctionDeadline + 1n, 'the child pool should activate at the earliest block allowed after the auction deadline')
		assert.ok((await mockWindow.getTime()) > childMigrationDeadline, 'the mandatory auction should make operational activation later than the child migration deadline')

		await initiateSecurityPoolFork(client, childPool.securityPool)
		assert.strictEqual(await getSystemState(client, childPool.securityPool), SystemState.PoolForked)
		await assert.rejects(createChildUniverse(client, childPool.securityPool, QuestionOutcome.Yes), /Migration closed/)
		await assert.rejects(migrateShares(client, childPool.shareToken, childUniverse, QuestionOutcome.Yes, [QuestionOutcome.Yes]), /migration window closed/i)
	})
})
