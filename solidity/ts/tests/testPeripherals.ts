import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approximatelyEqual, contractExists, getChildUniverseId, getERC20Balance, getETHBalance, getReportBond, getRepTokenAddress, getWinningOutcome, isFinalized, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import assert from 'node:assert'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { approveAndDepositRep, deployPeripherals, deployZoltarAndCreateMarket, genesisUniverse, MAX_RETENTION_RATE, PRICE_PRECISION, questionId, requestPrice, securityMultiplier, triggerFork } from '../testsuite/simulator/utils/peripheralsTestUtils.js'
import { getSecurityPoolAddresses } from '../testsuite/simulator/utils/deployPeripherals.js'
import { balanceOfShares, balanceOfSharesInCash, claimAuctionProceeds, createChildUniverse, createCompleteSet, finalizeTruthAuction, forkSecurityPool, getCompleteSetCollateralAmount, getCurrentRetentionRate, getEthAmountToBuy, getFeesAccrued, getLastPrice, getMigratedRep, getPoolOwnershipDenominator, getSecurityBondAllowance, getSecurityVault, getSystemState, migrateShares, migrateVault, OperationType, participateAuction, poolOwnershipToRep, redeemCompleteSet, redeemShares, sharesToCash, startTruthAuction } from '../testsuite/simulator/utils/peripherals.js'
import { QuestionOutcome } from '../testsuite/simulator/types/types.js'

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	let startBalance: bigint
	let reportBond: bigint
	const repDeposit = 1000n * 10n ** 18n
	let securityPoolAddresses: {
		securityPool: `0x${ string }`,
		priceOracleManagerAndOperatorQueuer: `0x${ string }`,
		shareToken: `0x${ string }`,
		truthAuction: `0x${ string }`
	}

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, questionId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
	 	startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const currentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
		await deployZoltarAndCreateMarket(client, currentTimestamp + DAY / 2n)
		await deployPeripherals(client)
		await approveAndDepositRep(client, repDeposit)
		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		reportBond = await getReportBond(client)
	})

	test('can deposit rep and withdraw it', async () => {
		await requestPrice(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
		assert.strictEqual(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance - reportBond, 100n, 'Did not get rep back')
	})

	test('can set security bonds allowance, mint complete sets and fork happily' , async () => {
		const securityPoolAllowance = repDeposit / 4n
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max');
		await requestPrice(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.strictEqual(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const openInterestAmount = 100n * 10n ** 18n
		const maxGasFees = openInterestAmount /4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		assert.ok(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool) < MAX_RETENTION_RATE, 'retention rate did not decrease after minting complete sets');
		const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		assert.strictEqual(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
		assert.strictEqual(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
		assert.strictEqual(openInterestAmount, await sharesToCash(client, securityPoolAddresses.securityPool, completeSetBalances[0]), 'Did not create enough complete sets')
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) > maxGasFees, 'Did not lose eth to create complete sets')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) < maxGasFees, 'Did not get ETH back from complete sets')
		const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		assert.strictEqual(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
		assert.strictEqual(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
		assert.strictEqual(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets');

		// forking
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await triggerFork(client, mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddresses.securityPool)
		assert.strictEqual(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		assert.strictEqual(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), 'Parents original rep is gone')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		approximatelyEqual(migratedRep, repBalance, 10n, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), openInterestAmount, 'child contract did not record the amount correctly')
	})
	test('two security pools with disagreement', async () => {
		const openInterestAmount = 10n * 10n ** 18n
		const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
		const securityPoolAllowance = repDeposit / 4n
		await requestPrice(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit)
		await requestPrice(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		assert.strictEqual(repBalanceInGenesisPool, 2n * repDeposit, 'After two deposits, the system should have 2 x repDeposit worth of REP')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddresses.securityPool), 2n * securityPoolAllowance, 'Security bond allowance should be 2x')
		assert.strictEqual(await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'Pool ownership denominator should equal `pool balance * PRICE_PRECISION` prior fork')

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')

		await triggerFork(client, mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddresses.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Shares exist after fork')
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes)
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No)
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid)

		// we migrate to yes
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		assert.ok(await isFinalized(client, yesUniverse, questionId), 'yes is finalized')
		assert.strictEqual(await getWinningOutcome(client, yesUniverse, questionId), QuestionOutcome.Yes, 'finalized as yes')
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
		approximatelyEqual(repBalanceInGenesisPool / 2n, migratedRepInYes, 10n, 'half migrated to yes')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool), repBalanceInGenesisPool, 'yes has all the rep')

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		assert.ok(await isFinalized(client, noUniverse, questionId), 'no is finalized')
		assert.strictEqual(await getWinningOutcome(client, noUniverse, questionId), QuestionOutcome.No, 'finalized as yes')
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
		approximatelyEqual(repBalanceInGenesisPool / 2n, migratedRepInNo, 10n, 'half migrated to no')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool), repBalanceInGenesisPool, 'no has all the rep')

		// invalid, no one migrated here
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		assert.ok(await isFinalized(client, invalidUniverse, questionId), 'invalid is finalized')
		assert.strictEqual(await getWinningOutcome(client, invalidUniverse, questionId), QuestionOutcome.Invalid, 'finalized as invalid')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		// auction yes
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, yesSecurityPool.truthAuction), openInterestAmount / 2n, 10n, 'Need to buy half of open interest')
		// participate yes auction by buying quarter of all REP (this is a open interest and rep holder happy case where REP holders win 50%)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repBalanceInGenesisPool / 4n, openInterestAmount / 2n)

		// auction no
		await startTruthAuction(client, noSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, noSecurityPool.truthAuction), openInterestAmount / 2n, 10n, 'Need to buy half of open interest')
		// participate no auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose 50%)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, repBalanceInGenesisPool * 3n / 4n, openInterestAmount / 2n)

		// auction invalid
		await startTruthAuction(client, invalidSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, invalidSecurityPool.truthAuction), openInterestAmount, 10n, 'Need to buy all of open interest')
		// participate no auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose 50%)
		const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		// buy half of the open interest for 3/4 of everything
		await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, repBalanceInGenesisPool - repBalanceInGenesisPool / 1_000_000n, openInterestAmount / 2n)

		await mockWindow.advanceTime(7n * DAY + DAY)

		// yes status: auction fully funds, 1/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Not enough shares in yes')

		approximatelyEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), openInterestAmount, 10n, 'yes child contract did not record the amount correctly')
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)

		const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
		const yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)
		approximatelyEqual(yesAuctionParticipantRep, repBalanceInGenesisPool / 4n, 10000n, 'yes auction participant did not get ownership of rep they bought')

		const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalYesVault.repDepositShare)
		approximatelyEqual(originalYesVaultRep, repBalanceInGenesisPool * 3n / 4n, 10000n, 'original yes vault holder should hold rest 3/4 of rep')
		assert.strictEqual((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

		const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2])), [openInterestAmount, 0n, openInterestAmount], 'Not enough shares')
		const fees = await getFeesAccrued(client, securityPoolAddresses.securityPool) + await getFeesAccrued(client, yesSecurityPool.securityPool)
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + openInterestAmount - fees, 10n ** 15n, 'did not gain eth after redeeming yes shares')

		// no status: auction fully funds, 3/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, noSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Not enough shares in no')

		assert.strictEqual(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool), openInterestAmount, 'no child contract did not record the amount correctly')
		await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)

		const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
		const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)
		approximatelyEqual(noAuctionParticipantRep, repBalanceInGenesisPool * 3n / 4n, 10000n, 'no auction participant did not get ownership of rep they bought')

		const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
		const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, originalNoVault.repDepositShare)
		approximatelyEqual(originalNoVaultRep, repBalanceInGenesisPool * 1n / 4n, 10000n, 'original no vault holder should hold rest 1/4 of rep')
		assert.strictEqual((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
		const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, noSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, noSecurityPool.securityPool, securityPoolAddresses.shareToken, noUniverse, addressString(TEST_ADDRESSES[2])), [openInterestAmount, openInterestAmount, 0n], 'Not enough shares')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + openInterestAmount-fees, 10n ** 15n, 'did not gain eth after redeeming no shares')

		// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
		await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, securityPoolAddresses.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray.map((x) => x / 2n), 'Not enough shares in invalid')
		assert.strictEqual(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, invalidSecurityPool.securityPool), openInterestAmount / 2n, 'Invalid child contract did not record the amount correctly')
		await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)

		const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
		const invalidAuctionParticipantRep = await poolOwnershipToRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.repDepositShare)
		approximatelyEqual(invalidAuctionParticipantRep, repBalanceInGenesisPool - repBalanceInGenesisPool / 1_000_000n, 10000n, 'Invalid auction participant did not get ownership of rep they bought')

		const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, openInterestAmount)

		const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2])), [0n, openInterestAmount, openInterestAmount].map((x) => x / 2n), 'Not enough shares after redeeming invalid 1')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + (openInterestAmount - fees) / 2n, 10n ** 15n, 'did not gain eth after redeeming invalid shares')

		const balancePriorInvalidRedeemal2 = await getETHBalance(client, addressString(TEST_ADDRESSES[4]))
		await redeemShares(openInterestHolder2, invalidSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[4])), [0n, openInterestAmount, openInterestAmount], 'Not enough shares after redeeming invalid 2')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[4])), balancePriorInvalidRedeemal2 + openInterestAmount, 10n ** 15n, 'did not gain eth after redeeming invalid shares')
	})
})
