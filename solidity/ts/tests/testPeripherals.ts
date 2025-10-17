import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testsuite/simulator/utils/constants.js'
import { approveToken, contractExists, createQuestion, dispute, ensureZoltarDeployed, getChildUniverseId, getERC20Balance, getETHBalance, getQuestionData, getReportBond, getRepTokenAddress, getUniverseData, getZoltarAddress, isZoltarDeployed, reportOutcome, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { createCompleteSet, deploySecurityPool, depositRep, ensureOpenOracleDeployed, ensureSecurityPoolFactoryDeployed, forkSecurityPool, getCompleteSetAddress, getCompleteSetCollateralAmount, getLastPrice, getOpenOracleAddress, getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, getPriceOracleManagerAndOperatorQueuer, getSecurityBondAllowance, isOpenOracleDeployed, isSecurityPoolFactoryDeployed, openOracleSettle, openOracleSubmitInitialReport, OperationType, redeemCompleteSet, requestPriceIfNeededAndQueueOperation, wrapWeth, migrateVault, getSecurityPoolAddress, getMigratedRep, getSystemState, startTruthAuction, getCurrentRetentionRate } from '../testsuite/simulator/utils/peripherals.js'
import assert from 'node:assert'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { QuestionOutcome } from '../testsuite/simulator/types/types.js'

const genesisUniverse = 0n
const questionId = 1n
const securityMultiplier = 2n;
const startingRepEthPrice = 1n;
const completeSetCollateralAmount = 0n;
const PRICE_PRECISION = 10n ** 18n;
const MAX_RETENTION_RATE = 999_999_996_848_000_000n; // ≈90% yearly
//const MIN_RETENTION_RATE = 999_999_977_880_000_000n; // ≈50% yearly
//const RETENTION_RATE_DIP = 80n; // 80% utilization

const deployZoltarAndCreateMarket = async (client: WriteClient, curentTimestamp: bigint) => {
	await ensureZoltarDeployed(client)
	const zoltar = getZoltarAddress()
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
	const endTime = curentTimestamp + DAY / 2n
	await createQuestion(client, genesisUniverse, endTime, 'test')
	return await getQuestionData(client, questionId)
}

const deployPeripheralsAndGetDeployedSecurityPool = async (client: WriteClient) => {
	// deploy open Oracle
	await ensureOpenOracleDeployed(client);
	assert.ok(await isOpenOracleDeployed(client), 'Open Oracle Not Deployed!')
	const openOracle = getOpenOracleAddress()
	await ensureSecurityPoolFactoryDeployed(client);
	assert.ok(await isSecurityPoolFactoryDeployed(client), 'Security Pool Factory Not Deployed!')
	await deploySecurityPool(client, openOracle, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice, completeSetCollateralAmount)
	return getSecurityPoolAddress(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
}

const initAndDepositRep = async (client: WriteClient, curentTimestamp: bigint, repDeposit: bigint) => {
	await deployZoltarAndCreateMarket(client, curentTimestamp)
	const isDeployed = await isZoltarDeployed(client)
	assert.ok(isDeployed, `Zoltar Not Deployed!`)

	const securityPoolAddress = await deployPeripheralsAndGetDeployedSecurityPool(client)
	assert.ok(BigInt(securityPoolAddress) !== 0n, `Security Pool Not Deployed!`)
	assert.ok(await isOpenOracleDeployed(client), 'Open Oracle is not deployed')
	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRep(client, securityPoolAddress, repDeposit);

	const newBalace = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
	assert.strictEqual(startBalance, newBalace + repDeposit, 'Did not deposit rep')
	return securityPoolAddress
}

const triggerFork = async(mockWindow: MockWindowEthereum, questionId: bigint) => {
	const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	await ensureZoltarDeployed(client)
	await mockWindow.advanceTime(DAY)
	const initialOutcome = QuestionOutcome.Yes
	await reportOutcome(client, genesisUniverse, questionId, initialOutcome)
	const disputeOutcome = QuestionOutcome.No
	await dispute(client, genesisUniverse, questionId, disputeOutcome)
	const invalidUniverseId = 1n
	const yesUniverseId = 2n
	const noUniverseId = 3n
	return {
		invalidUniverseData: await getUniverseData(client, invalidUniverseId),
		yesUniverseData: await getUniverseData(client, yesUniverseId),
		noUniverseData: await getUniverseData(client, noUniverseId)
	}
}

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum
	let curentTimestamp: bigint
	let securityPoolAddress: `0x${ string }`
	let client: WriteClient
	let startBalance: bigint
	let reportBond: bigint
	const repDeposit = 10n * 10n ** 18n
	let priceOracleManagerAndOperatorQueuer: `0x${ string }`

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, questionId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
		curentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
	 	startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		securityPoolAddress = await initAndDepositRep(client, curentTimestamp, repDeposit)
		reportBond = await getReportBond(client)
		priceOracleManagerAndOperatorQueuer = await getPriceOracleManagerAndOperatorQueuer(client, securityPoolAddress)
	})

	test('can deposit rep and withdraw it', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)

		const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
		assert.ok(pendingReportId > 0, 'Operation is not queued')

		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)

		// initial report
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getOpenOracleAddress())
		await approveToken(client, WETH_ADDRESS, getOpenOracleAddress())
		await wrapWeth(client, amount2)
		const wethBalance = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		assert.strictEqual(wethBalance, amount2, 'Did not wrap weth')

		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)

		await mockWindow.advanceTime(DAY)
		// settle and execute the operation (withdraw rep)
		await openOracleSettle(client, pendingReportId)
		assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress), 0n, 'Did not empty security pool of rep')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance - reportBond, 'Did not get rep back')
	})

	test('can set security bonds allowance, mint complete sets and fork happily' , async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const securityPoolAllowance = repDeposit / 4n
		await requestPriceIfNeededAndQueueOperation(client, priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
		assert.ok(pendingReportId > 0, 'Operation is not queued')

		const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)

		// initial report
		const amount1 = reportMeta.exactToken1Report
		const amount2 = amount1

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getOpenOracleAddress())
		await approveToken(client, WETH_ADDRESS, getOpenOracleAddress())
		await wrapWeth(client, amount2)
		const wethBalance = await getERC20Balance(client, WETH_ADDRESS, client.account.address)
		assert.strictEqual(wethBalance, amount2, 'Did not wrap weth')

		const stateHash = (await getOpenOracleExtraData(client, pendingReportId)).stateHash
		await openOracleSubmitInitialReport(client, pendingReportId, amount1, amount2, stateHash)

		await mockWindow.advanceTime(DAY)

		// settle and execute the operation (set allowance)
		await openOracleSettle(client, pendingReportId)
		assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getSecurityBondAllowance(client, securityPoolAddress), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const amountToCreate = 1n * 10n ** 18n
		const maxGasFees = amountToCreate /4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddress, amountToCreate)
		const completeSetAddress = getCompleteSetAddress(securityPoolAddress)
		const completeSetBalance = await getERC20Balance(client, completeSetAddress, client.account.address)
		assert.strictEqual(amountToCreate, completeSetBalance, 'Did not create enough complete sets')
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) > maxGasFees, 'Did not lose eth to create complete sets')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, securityPoolAddress), amountToCreate, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddress, amountToCreate)
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) < maxGasFees, 'Did not get ETH back from complete sets')
		assert.strictEqual(await getERC20Balance(client, completeSetAddress, client.account.address), 0n, 'Did not lose complete sets')

		// forking
		await createCompleteSet(client, securityPoolAddress, amountToCreate)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress)
		await triggerFork(mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddress)
		assert.strictEqual(await getSystemState(client, securityPoolAddress), SystemState.PoolForked, 'Parent is forked')
		assert.strictEqual(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress), 'Parents original rep is gone')
		await migrateVault(client, securityPoolAddress, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddress(securityPoolAddress, yesUniverse, questionId, securityMultiplier)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool)
		assert.strictEqual(repBalance, migratedRep, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.Operational, 'System should be operational again')
		assert.strictEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool), amountToCreate, 'child contract did not record the amount correctly')
	})

	//test('can liquidate', async () => {
		// add liquidation test
	//})

	//test('cannot mint over or withdraw too much rep', async () => {
	// add complete sets minting test where price has changed so we can no longer mint
	//})

	/*
	//todo, need two pools for this
	test('can fork the system path with auction', async () => {
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress)
		await triggerFork(mockWindow, questionId)
		await forkSecurityPool(client, securityPoolAddress)
		assert.strictEqual(await getSystemState(client, securityPoolAddress), SystemState.PoolForked, 'Parent is forked')
		assert.strictEqual(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddress), 'Parents original rep is gone')
		await migrateVault(client, securityPoolAddress, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddress(securityPoolAddress, yesUniverse, questionId, securityMultiplier)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool)
		assert.strictEqual(repBalance, migratedRep, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool)
		assert.strictEqual(await getSystemState(client, yesSecurityPool), SystemState.Operational, 'System should be operational again')
		const yesSecurityPoolTruthAuction = getTruthAuction(yesSecurityPool)
		const repToBuy = 1n * 10n ** 18n
		const ethToInvest = await getEthAmountToBuy(client, yesSecurityPoolTruthAuction)
		await participateAuction(client, yesSecurityPoolTruthAuction, repToBuy, ethToInvest)

		//await mockWindow.advanceTime(7n * DAY + DAY)
		//await finalizeTruthAuction(client, yesSecurityPool)
		//assert.strictEqual(ethToInvest, client.getBalance({ address: yesSecurityPool, blockTag: 'latest' }), 'did not get Eth from auction')

		assert.strictEqual(await getSystemState(client, securityPoolAddress), SystemState.PoolForked, 'Parent should be still forked')
	})*/

	test('fees', async () => {
		assert.strictEqual(await getCurrentRetentionRate(client, securityPoolAddress), MAX_RETENTION_RATE, 'retention rate was not at max');
	})

})
