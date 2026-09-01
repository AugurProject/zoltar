import { beforeEach, describe, test } from 'bun:test'
import { decodeEventLog, zeroAddress } from '@zoltar/shared/ethereum'
import { getMaxRepBeingSoldAttoRep, getMinBidSizeAttoEth } from '../testSupport/simulator/utils/contracts/auction'
import { getActiveStagedOperationCount, getStagedOperation, getStagedOperationCounter } from '../testSupport/simulator/utils/contracts/statoblast'
import { addRepToMigrationBalance, splitMigrationRep } from '../testSupport/simulator/utils/contracts/zoltar'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool, ReputationToken_ReputationToken } from '../types/contractArtifact'
import { useStatoblastTruthAuctionFixture, type StatoblastTruthAuctionFixture } from './statoblast/fixture'

describe('Truth-auction ownership overflow regression', () => {
	const fixture = useStatoblastTruthAuctionFixture()
	const assert: StatoblastTruthAuctionFixture['assert'] = fixture.assert

	const {
		DAY,
		OperationType,
		PRICE_PRECISION,
		QuestionOutcome,
		TEST_ADDRESSES,
		approveAndDepositRepToVault,
		approveToken,
		claimAuctionProceeds,
		createCompleteSet,
		createWriteClient,
		finalizeTruthAuction,
		genesisUniverse,
		getChildUniverseId,
		getERC20Balance,
		getMigratedAttoRep,
		getTotalRepBackingUnits,
		getRepTokenAddress,
		getSecurityPoolAddresses,
		getSecurityVault,
		getTotalRepPurchasedAttoRep,
		getZoltarAddress,
		manipulatePriceOracleAndPerformOperation,
		migrateVault,
		participateAuction,
		backingUnitsToAttoRep,
		startTruthAuction,
		statoblastSecurityMultiplierBps,
		triggerExternalForkForSecurityPool,
	} = fixture

	let client: StatoblastTruthAuctionFixture['client']
	let mockWindow: StatoblastTruthAuctionFixture['mockWindow']
	let questionId: StatoblastTruthAuctionFixture['questionId']
	let securityPoolAddresses: StatoblastTruthAuctionFixture['securityPoolAddresses']

	beforeEach(() => {
		client = fixture.client
		mockWindow = fixture.mockWindow
		questionId = fixture.questionId
		securityPoolAddresses = fixture.securityPoolAddresses
	})

	test('a full-cap winner can value REP without bypassing a tiny migrated vault live capacity commitment', async () => {
		const minimumVaultRep = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPoolAddresses.securityPool,
			functionName: 'minimumVaultRepDepositAttoRep',
			args: [],
		})
		const passiveRep = 1_300_000n * PRICE_PRECISION
		const attacker = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const passiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		const secondPassiveVault = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		const auctionWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const universeForker = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveAndDepositRepToVault(attacker, minimumVaultRep, questionId)
		await approveAndDepositRepToVault(passiveVault, passiveRep, questionId)
		await approveAndDepositRepToVault(secondPassiveVault, passiveRep, questionId)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * PRICE_PRECISION)

		await triggerExternalForkForSecurityPool(universeForker, 'audit ownership overflow source')
		await migrateVault(attacker, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const childUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverse, questionId, statoblastSecurityMultiplierBps)
		assert.strictEqual(await getMigratedAttoRep(client, childPool.securityPool), minimumVaultRep, 'the child should contain exactly one minimum-size migrated vault')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, childPool.securityPool)
		const auctionCap = await getMaxRepBeingSoldAttoRep(client, childPool.truthAuction)
		const minimumBid = await getMinBidSizeAttoEth(client, childPool.truthAuction)
		const winnerTick = await participateAuction(auctionWinner, childPool.truthAuction, 1n, minimumBid)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, childPool.securityPool)
		assert.strictEqual(await getTotalRepPurchasedAttoRep(client, childPool.truthAuction), auctionCap, 'the qualifying full-cap settlement should allocate every auctionable REP unit')
		await claimAuctionProceeds(auctionWinner, childPool.securityPool, auctionWinner.account.address, [{ tick: winnerTick, bidIndex: 0n }])

		const childRepToken = getRepTokenAddress(childUniverse)
		const childRepBalance = await getERC20Balance(client, childRepToken, childPool.securityPool)
		const winnerVault = await getSecurityVault(client, childPool.securityPool, auctionWinner.account.address)
		assert.ok(winnerVault.repBackingUnits * childRepBalance <= (1n << 256n) - 1n, 'the child-local ownership scale must keep valid conversion numerators within uint256')
		assert.strictEqual(await backingUnitsToAttoRep(client, childPool.securityPool, winnerVault.repBackingUnits), auctionCap, 'the winner ownership should value to its purchased REP')

		const reporterRep = 1_000n * PRICE_PRECISION
		await approveToken(auctionWinner, getRepTokenAddress(genesisUniverse), getZoltarAddress())
		await addRepToMigrationBalance(auctionWinner, genesisUniverse, reporterRep)
		await splitMigrationRep(auctionWinner, genesisUniverse, reporterRep, [QuestionOutcome.Yes])
		const donatedRep = 100n * PRICE_PRECISION
		const donationHash = await auctionWinner.writeContract({
			abi: ReputationToken_ReputationToken.abi,
			address: childRepToken,
			functionName: 'transfer',
			args: [childPool.securityPool, donatedRep],
		})
		await auctionWinner.waitForTransactionReceipt({ hash: donationHash })
		const donatedPoolRepBalance = await getERC20Balance(client, childRepToken, childPool.securityPool)
		const childOwnershipDenominator = await getTotalRepBackingUnits(client, childPool.securityPool)
		assert.strictEqual(await backingUnitsToAttoRep(client, childPool.securityPool, winnerVault.repBackingUnits), (winnerVault.repBackingUnits * donatedPoolRepBalance) / childOwnershipDenominator, 'a direct REP transfer should change pro-rata live valuation without changing auction ownership units')
		assert.ok((await backingUnitsToAttoRep(client, childPool.securityPool, winnerVault.repBackingUnits)) > auctionCap, 'unsolicited REP should make the winner live valuation exceed its snapshot-based purchased REP')
		const winnerWalletRepBefore = await getERC20Balance(client, childRepToken, auctionWinner.account.address)
		const winnerVaultBefore = await getSecurityVault(client, childPool.securityPool, auctionWinner.account.address)
		const operationCounterBefore = await getStagedOperationCounter(client, childPool.priceOracleManagerAndOperatorQueuer)
		const operationLogStartBlock = (await client.getBlockNumber()) + 1n

		await manipulatePriceOracleAndPerformOperation(auctionWinner, mockWindow, childPool.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, auctionWinner.account.address, minimumVaultRep)

		const operationId = operationCounterBefore + 1n
		const executionLog = (
			await client.getLogs({
				address: childPool.priceOracleManagerAndOperatorQueuer,
				fromBlock: operationLogStartBlock,
			})
		)
			.map(log =>
				decodeEventLog({
					abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
			.find(log => log.eventName === 'ExecutedStagedOperation')
		if (executionLog === undefined) throw new Error('missing ExecutedStagedOperation log for ownership-overflow withdrawal')
		assert.strictEqual(executionLog.args.operationId, operationId, 'the execution event should consume the newly queued operation')
		assert.strictEqual(executionLog.args.operation, BigInt(OperationType.WithdrawRep), 'the failed staged operation should be the requested REP withdrawal')
		assert.strictEqual(executionLog.args.success, false, 'the bounded ownership conversion should reject rather than overflow when live open interest commits the winner capacity')
		assert.strictEqual(executionLog.args.errorMessage, 'Capacity committed', 'the failed withdrawal should expose the live-open-interest invariant')
		assert.strictEqual(await getActiveStagedOperationCount(client, childPool.priceOracleManagerAndOperatorQueuer), 0n, 'the rejected withdrawal should be consumed')
		assert.strictEqual((await getStagedOperation(client, childPool.priceOracleManagerAndOperatorQueuer, operationId))[1], zeroAddress, 'the consumed withdrawal should clear its initiator')
		assert.strictEqual(await getERC20Balance(client, childRepToken, auctionWinner.account.address), winnerWalletRepBefore, 'the rejected withdrawal should not transfer REP')
		assert.strictEqual((await getSecurityVault(client, childPool.securityPool, auctionWinner.account.address)).repBackingUnits, winnerVaultBefore.repBackingUnits, 'the rejected withdrawal should retain winner ownership')
	})

	test('the documented theoretical-supply ceiling bounds every ownership conversion product', () => {
		const uint256Max = (1n << 256n) - 1n
		const maximumSupportedSupply = 48_740_834_812_604_276_470_692_694n
		const firstUnsupportedSupply = maximumSupportedSupply + 1n

		assert.ok(maximumSupportedSupply ** 3n <= uint256Max, 'positive-residue ownership-to-REP and REP-to-ownership numerators must fit at the documented ceiling')
		assert.ok(maximumSupportedSupply ** 2n * (PRICE_PRECISION + 1n) <= uint256Max, 'no-residue ownership-to-REP and REP-to-ownership numerators must fit at the documented ceiling')
		assert.ok(firstUnsupportedSupply ** 3n > uint256Max, 'the next REP base unit must violate the controlling positive-residue conversion bound')
	})
})
