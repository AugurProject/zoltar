import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approximatelyEqual, contractExists, getChildUniverseId, getERC20Balance, getETHBalance, getReportBond, getRepTokenAddress, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { createCompleteSet, forkSecurityPool, getCompleteSetAddress, getCompleteSetCollateralAmount, getLastPrice, getPriceOracleManagerAndOperatorQueuer, getSecurityBondAllowance, OperationType, redeemCompleteSet, migrateVault, getSecurityPoolAddress, getMigratedRep, getSystemState, startTruthAuction, getCurrentRetentionRate, getTruthAuction, getEthAmountToBuy, participateAuction, finalizeTruthAuction, claimAuctionProceeds, getSecurityVault, getPoolOwnershipDenominator, poolOwnershipToRep } from '../testsuite/simulator/utils/peripherals.js'
import assert from 'node:assert'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { approveAndDepositRep, deployPeripherals, deployZoltarAndCreateMarket, genesisUniverse, MAX_RETENTION_RATE, PRICE_PRECISION, questionId, requestPrice, securityMultiplier, triggerFork } from '../testsuite/simulator/utils/peripheralsTestUtils.js'

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum
	let securityPoolAddress: `0x${ string }`
	let client: WriteClient
	let startBalance: bigint
	let reportBond: bigint
	const repDeposit = 100n * 10n ** 18n
	let priceOracleManagerAndOperatorQueuer: `0x${ string }`

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
		securityPoolAddress = getSecurityPoolAddress(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
		reportBond = await getReportBond(client)
		priceOracleManagerAndOperatorQueuer = await getPriceOracleManagerAndOperatorQueuer(client, securityPoolAddress)
	})

	test('can deposit rep and withdraw it', async () => {
		await requestPrice(client, mockWindow, priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
		assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress), 0n, 'Did not empty security pool of rep')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance - reportBond, 'Did not get rep back')
	})

	test('can set security bonds allowance, mint complete sets and fork happily' , async () => {
		const securityPoolAllowance = repDeposit / 4n
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddress), MAX_RETENTION_RATE, 'retention rate was not at max');
		await requestPrice(client, mockWindow, priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddress), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const openInterestAmount = 1n * 10n ** 18n
		const maxGasFees = openInterestAmount /4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddress, openInterestAmount)
		assert.ok(await getCurrentRetentionRate(client, securityPoolAddress) < MAX_RETENTION_RATE, 'retention rate did not decrease after minting complete sets');
		const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
		const completeSetBalance = await getERC20Balance(client, completeSetAddress, client.account.address)
		assert.strictEqual(openInterestAmount, completeSetBalance, 'Did not create enough complete sets')
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) > maxGasFees, 'Did not lose eth to create complete sets')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, securityPoolAddress), openInterestAmount, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddress, openInterestAmount)
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) < maxGasFees, 'Did not get ETH back from complete sets')
		assert.strictEqual(await getERC20Balance(client, completeSetAddress, client.account.address), 0n, 'Did not lose complete sets')
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddress), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets');

		// forking
		await createCompleteSet(client, securityPoolAddress, openInterestAmount)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress)
		await triggerFork(client, mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddress)
		assert.strictEqual(await getSystemState(client, securityPoolAddress), SystemState.PoolForked, 'Parent is forked')
		assert.strictEqual(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress), 'Parents original rep is gone')
		await migrateVault(client, securityPoolAddress, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddress(securityPoolAddress, yesUniverse, questionId, securityMultiplier)
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddress), await getCurrentRetentionRate(client, yesSecurityPool), 'Parent and childs retention rate should be equal')

		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool)
		assert.strictEqual(migratedRep, repBalance, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.Operational, 'System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool), openInterestAmount, 'child contract did not record the amount correctly')
	})
	test('two security pools with disagreement', async () => {
		const openInterestAmount = 1n * 10n ** 18n
		const securityPoolAllowance = repDeposit / 4n
		await requestPrice(client, mockWindow, priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit)
		await requestPrice(attackerClient, mockWindow, priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress)
		assert.strictEqual(repBalanceInGenesisPool, 2n * repDeposit, 'After two deposits, the system should have 2 x repDeposit worth of REP')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddress), 2n * securityPoolAllowance, 'Security bond allowance should be 2x')
		assert.strictEqual(await getPoolOwnershipDenominator(client, securityPoolAddress), repBalanceInGenesisPool * PRICE_PRECISION, 'Pool ownership denominator should equal `pool balance * PRICE_PRECISION` prior fork')

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddress, openInterestAmount)
		const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
		const completeSetBalance = await getERC20Balance(client, completeSetAddress, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(openInterestAmount, completeSetBalance, 'Did not create enough complete sets')

		await triggerFork(client, mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddress)

		// we migrate to yes
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddress(securityPoolAddress, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddress, QuestionOutcome.Yes)
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool)
		assert.strictEqual(repBalanceInGenesisPool / 2n, migratedRepInYes, 'half migrated to yes')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool), repBalanceInGenesisPool, 'yes has all the rep')

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddress(securityPoolAddress, noUniverse, questionId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddress, QuestionOutcome.No)
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool)
		assert.strictEqual(repBalanceInGenesisPool / 2n, migratedRepInNo, 'half migrated to no')
		assert.strictEqual(await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool), repBalanceInGenesisPool, 'no has all the rep')

		// auction
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.ForkTruthAuction, 'Auction started')
		await startTruthAuction(client, noSecurityPool)
		assert.strictEqual(await getSystemState(client, noSecurityPool), SystemState.ForkTruthAuction, 'Auction started')
		const yesAuction = getTruthAuction(yesSecurityPool)
		const noAuction = getTruthAuction(noSecurityPool)

		const ethToBuyInYes = await getEthAmountToBuy(client, yesAuction)
		const ethToBuyInNo = await getEthAmountToBuy(client, noAuction)
		assert.strictEqual(ethToBuyInYes, openInterestAmount / 2n, 'Need to buy half of open interest')
		assert.strictEqual(ethToBuyInNo, openInterestAmount / 2n, 'Need to buy half of open interest')

		// participate yes auction by buying quarter of all REP (this is a open interest and rep holder happy case where REP holders win 50%)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await participateAuction(yesAuctionParticipant, yesAuction, repBalanceInGenesisPool / 4n, openInterestAmount / 2n)

		// participate yes auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose happy case where REP holders lose 50%)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await participateAuction(noAuctionParticipant, noAuction, repBalanceInGenesisPool * 3n / 4n, openInterestAmount / 2n)

		await mockWindow.advanceTime(7n * DAY + DAY)

		await finalizeTruthAuction(client, yesSecurityPool)
		await finalizeTruthAuction(client, noSecurityPool)

		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.Operational, 'Yes System should be operational again')
		assert.strictEqual(await getSystemState(client, noSecurityPool), SystemState.Operational, 'No System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool), openInterestAmount, 'yes child contract did not record the amount correctly')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, noSecurityPool), openInterestAmount, 'no child contract did not record the amount correctly')

		await claimAuctionProceeds(client, yesSecurityPool, yesAuctionParticipant.account.address)
		await claimAuctionProceeds(client, noSecurityPool, noAuctionParticipant.account.address)

		// yes status
		const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool, yesAuctionParticipant.account.address)
		console.log(yesAuctionParticipantVault)
		const yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool, yesAuctionParticipantVault.repDepositShare)
		approximatelyEqual(yesAuctionParticipantRep, repBalanceInGenesisPool / 4n, 1000n, 'yes auction participant did not get ownership of rep they bought')

		const originalYesVault = await getSecurityVault(client, yesSecurityPool, client.account.address)
		const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool, originalYesVault.repDepositShare)
		approximatelyEqual(originalYesVaultRep, repBalanceInGenesisPool * 3n / 4n, 1000n, 'original yes vault holder should hold rest 3/4 of rep')
		assert.strictEqual((await getSecurityVault(client, yesSecurityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

		// no status
		const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool, noAuctionParticipant.account.address)
		const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool, noAuctionParticipantVault.repDepositShare)
		approximatelyEqual(noAuctionParticipantRep, repBalanceInGenesisPool * 3n / 4n, 1000n, 'no auction participant did not get ownership of rep they bought')

		const originalNoVault = await getSecurityVault(client, noSecurityPool, attackerClient.account.address)
		const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool, originalNoVault.repDepositShare)
		approximatelyEqual(originalNoVaultRep, repBalanceInGenesisPool * 1n / 4n, 1000n, 'original no vault holder should hold rest 1/4 of rep')
		assert.strictEqual((await getSecurityVault(client, noSecurityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
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
