import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approximatelyEqual, contractExists, getChildUniverseId, getERC20Balance, getETHBalance, getReportBond, getRepTokenAddress, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import assert from 'node:assert'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { approveAndDepositRep, deployPeripherals, deployZoltarAndCreateMarket, genesisUniverse, MAX_RETENTION_RATE, PRICE_PRECISION, questionId, requestPrice, securityMultiplier, triggerFork } from '../testsuite/simulator/utils/peripheralsTestUtils.js'
import { getSecurityPoolAddresses } from '../testsuite/simulator/utils/deployPeripherals.js'
import { balanceOfQuestionShares, claimAuctionProceeds, createCompleteSet, finalizeTruthAuction, forkSecurityPool, getCompleteSetCollateralAmount, getCurrentRetentionRate, getEthAmountToBuy, getLastPrice, getMigratedRep, getPoolOwnershipDenominator, getSecurityBondAllowance, getSecurityVault, getSystemState, migrateVault, OperationType, participateAuction, poolOwnershipToRep, redeemCompleteSet, startTruthAuction } from '../testsuite/simulator/utils/peripherals.js'
import { QuestionOutcome } from '../testsuite/simulator/types/types.js'

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum
	let client: WriteClient
	let startBalance: bigint
	let reportBond: bigint
	const repDeposit = 100n * 10n ** 18n
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
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 'Did not empty security pool of rep')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance - reportBond, 'Did not get rep back')
	})

	test('can set security bonds allowance, mint complete sets and fork happily' , async () => {
		const securityPoolAllowance = repDeposit / 4n
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max');
		await requestPrice(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.strictEqual(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const openInterestAmount = 1n * 10n ** 18n
		const maxGasFees = openInterestAmount /4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		assert.ok(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool) < MAX_RETENTION_RATE, 'retention rate did not decrease after minting complete sets');
		const completeSetBalances = await balanceOfQuestionShares(client, securityPoolAddresses.shareToken, genesisUniverse, questionId,client.account.address)
		assert.strictEqual(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
		assert.strictEqual(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
		assert.strictEqual(openInterestAmount, completeSetBalances[0], 'Did not create enough complete sets')
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) > maxGasFees, 'Did not lose eth to create complete sets')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) < maxGasFees, 'Did not get ETH back from complete sets')
		const newBalanes = await balanceOfQuestionShares(client, securityPoolAddresses.shareToken, genesisUniverse, questionId,client.account.address)
		assert.strictEqual(newBalanes[0], 0n, 'Did not lose complete sets')
		assert.strictEqual(newBalanes[1], 0n, 'Did not lose complete sets')
		assert.strictEqual(newBalanes[2], 0n, 'Did not lose complete sets')
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
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), await getCurrentRetentionRate(client, yesSecurityPool.securityPool), 'Parent and childs retention rate should be equal')

		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		assert.strictEqual(migratedRep, repBalance, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), openInterestAmount, 'child contract did not record the amount correctly')
	})
	test('two security pools with disagreement', async () => {
		const openInterestAmount = 1n * 10n ** 18n
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
		const completeSetBalance = await balanceOfQuestionShares(client, securityPoolAddresses.shareToken, genesisUniverse, questionId, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(completeSetBalance[0], openInterestAmount, 'Did not create enough complete sets')
		assert.strictEqual(completeSetBalance[1], openInterestAmount, 'Did not create enough complete sets')
		assert.strictEqual(completeSetBalance[2], openInterestAmount, 'Did not create enough complete sets')

		await triggerFork(client, mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddresses.securityPool)

		// we migrate to yes
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
		assert.strictEqual(repBalanceInGenesisPool / 2n, migratedRepInYes, 'half migrated to yes')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool), repBalanceInGenesisPool, 'yes has all the rep')

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
		assert.strictEqual(repBalanceInGenesisPool / 2n, migratedRepInNo, 'half migrated to no')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool), repBalanceInGenesisPool, 'no has all the rep')

		// auction
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		await startTruthAuction(client, noSecurityPool.securityPool)
		assert.strictEqual(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')

		const ethToBuyInYes = await getEthAmountToBuy(client, yesSecurityPool.truthAuction)
		const ethToBuyInNo = await getEthAmountToBuy(client, noSecurityPool.truthAuction)
		assert.strictEqual(ethToBuyInYes, openInterestAmount / 2n, 'Need to buy half of open interest')
		assert.strictEqual(ethToBuyInNo, openInterestAmount / 2n, 'Need to buy half of open interest')

		// participate yes auction by buying quarter of all REP (this is a open interest and rep holder happy case where REP holders win 50%)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repBalanceInGenesisPool / 4n, openInterestAmount / 2n)

		// participate yes auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose happy case where REP holders lose 50%)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, repBalanceInGenesisPool * 3n / 4n, openInterestAmount / 2n)

		await mockWindow.advanceTime(7n * DAY + DAY)

		await finalizeTruthAuction(client, yesSecurityPool.truthAuction)
		await finalizeTruthAuction(client, noSecurityPool.truthAuction)

		assert.strictEqual(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
		assert.strictEqual(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), openInterestAmount, 'yes child contract did not record the amount correctly')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool), openInterestAmount, 'no child contract did not record the amount correctly')

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
		await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)

		// yes status
		const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
		console.log(yesAuctionParticipantVault)
		const yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)
		approximatelyEqual(yesAuctionParticipantRep, repBalanceInGenesisPool / 4n, 1000n, 'yes auction participant did not get ownership of rep they bought')

		const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalYesVault.repDepositShare)
		approximatelyEqual(originalYesVaultRep, repBalanceInGenesisPool * 3n / 4n, 1000n, 'original yes vault holder should hold rest 3/4 of rep')
		assert.strictEqual((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

		// no status
		const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
		const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)
		approximatelyEqual(noAuctionParticipantRep, repBalanceInGenesisPool * 3n / 4n, 1000n, 'no auction participant did not get ownership of rep they bought')

		const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
		const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, originalNoVault.repDepositShare)
		approximatelyEqual(originalNoVaultRep, repBalanceInGenesisPool * 1n / 4n, 1000n, 'original no vault holder should hold rest 1/4 of rep')
		assert.strictEqual((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
	})

	//test('can liquidate', async () => {
		// add liquidation test
	//})

	//test('cannot mint over or withdraw too much rep', async () => {
	// add complete sets minting test where price has changed so we can no longer mint
	//})

	//test('test that fees subtract balances', async () => {
		// add liquidation test
	//})

})
