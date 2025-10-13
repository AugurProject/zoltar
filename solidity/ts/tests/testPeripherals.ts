import { describe, beforeEach, test } from 'node:test'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, ReadClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testsuite/simulator/utils/constants.js'
import { approveToken, createQuestion, ensureZoltarDeployed, getERC20Balance, getETHBalance, getQuestionData, getReportBond, getZoltarAddress, isZoltarDeployed, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString } from '../testsuite/simulator/utils/bigint.js'
import { createCompleteSet, deploySecurityPool, depositRep, ensureOpenOracleDeployed, ensureSecurityPoolFactoryDeployed, getCompleteSetAddress, getDeployedSecurityPool, getEthAmountForCompleteSets, getLastPrice, getOpenOracleAddress, getOpenOracleExtraData, getOpenOracleReportMeta, getPendingReportId, getPriceOracleManagerAndOperatorQueuer, getSecurityBondAllowance, getSecurityPoolFactoryAddress, isOpenOracleDeployed, isSecurityPoolFactoryDeployed, openOracleSettle, openOracleSubmitInitialReport, OperationType, redeemCompleteSet, requestPriceIfNeededAndQueueOperation, wrapWeth } from '../testsuite/simulator/utils/peripherals.js'
import assert from 'node:assert'
import { Deployment, printLogs } from '../testsuite/simulator/utils/peripheralLogs.js'

const genesisUniverse = 0n
const marketId = 1n
const securityMultiplier = 2n;
const startingPerSecondFee = 1n;
const startingRepEthPrice = 1n;
const ethAmountForCompleteSets = 0n;
const PRICE_PRECISION = 10n ** 18n;

const printContractLogs = async (client: ReadClient, securityPoolAddress: `0x${ string }`, priceOracleManagerAndOperatorQueuerAddress: `0x${ string }`, completeSetAddress: `0x${ string }` ) => {
	const deployments: Deployment[] = [{
		definitionFilename: 'contracts/ReputationToken.sol',
		deploymentName: 'RepV2',
		contractName: 'ReputationToken',
		address: addressString(GENESIS_REPUTATION_TOKEN)
	}, {
		definitionFilename: 'contracts/Zoltar.sol',
		deploymentName: 'Colored Core',
		contractName: 'Zoltar',
		address: getZoltarAddress(),
	}, {
		definitionFilename: 'contracts/peripherals/SecurityPool.sol',
		deploymentName: 'PriceOracleManagerAndOperatorQueuer',
		contractName: 'PriceOracleManagerAndOperatorQueuer',
		address: priceOracleManagerAndOperatorQueuerAddress
	}, {
		definitionFilename: 'contracts/peripherals/SecurityPool.sol',
		deploymentName: 'ETH SecurityPool',
		contractName: 'SecurityPool',
		address: securityPoolAddress
	}, {
		definitionFilename: 'contracts/peripherals/SecurityPool.sol',
		deploymentName: 'SecurityPoolFactory',
		contractName: 'SecurityPoolFactory',
		address: getSecurityPoolFactoryAddress()
	}, {
		definitionFilename: 'contracts/peripherals/openOracle/OpenOracle.sol',
		deploymentName: 'OpenOracle',
		contractName: 'OpenOracle',
		address: getOpenOracleAddress()
	}, {
		definitionFilename: 'contracts/IWeth9.sol',
		contractName: 'IWeth9',
		deploymentName: 'WETH',
		address: WETH_ADDRESS
	}, {
		definitionFilename: 'contracts/peripherals/CompleteSet.sol',
		contractName: 'CompleteSet',
		deploymentName: 'CompleteSet',
		address: completeSetAddress
	}]
	return printLogs(client, deployments)
}

const deployZoltarAndCreateMarket = async (client: WriteClient, curentTimestamp: bigint) => {
	await ensureZoltarDeployed(client)
	const zoltar = getZoltarAddress()
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), zoltar)
	const endTime = curentTimestamp + DAY
	await createQuestion(client, genesisUniverse, endTime, 'test')
	return await getQuestionData(client, marketId)
}

const deployPeripheralsAndGetDeployedSecurityPool = async (client: WriteClient) => {
	// deploy open Oracle
	await ensureOpenOracleDeployed(client);
	assert.ok(await isOpenOracleDeployed(client), 'Open Oracle Not Deployed!')
	const openOracle = getOpenOracleAddress()
	await ensureSecurityPoolFactoryDeployed(client);
	assert.ok(await isSecurityPoolFactoryDeployed(client), 'Security Pool Factory Not Deployed!')
	await deploySecurityPool(client, openOracle, genesisUniverse, marketId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, ethAmountForCompleteSets)
	return await getDeployedSecurityPool(client, 1n)
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

describe('Peripherals Contract Test Suite', () => {

	let mockWindow: MockWindowEthereum
	let curentTimestamp: bigint
	let securityPoolAddress: `0x${ string }`
	let client: WriteClient
	let startBalance: bigint
	let reportBond: bigint
	const repDeposit = 10n * 10n ** 18n

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
		curentTimestamp = BigInt(Math.floor((await mockWindow.getTime()).getTime() / 1000))
	 	startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		securityPoolAddress = await initAndDepositRep(client, curentTimestamp, repDeposit)
		reportBond = await getReportBond(client);
	})

	test('can deposit rep and withdraw it', async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const priceOracleManagerAndOperatorQueuer = await getPriceOracleManagerAndOperatorQueuer(client, securityPoolAddress)
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
		console.log('balance before settling:', await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address))
		// settle and execute the operation (withdraw rep)
		await openOracleSettle(client, pendingReportId)
		await printContractLogs(client, securityPoolAddress, priceOracleManagerAndOperatorQueuer, await getCompleteSetAddress(client, securityPoolAddress))
		assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress), 0n, 'Did not empty security pool of rep')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance - reportBond, 'Did not get rep back')
	})

	test('can set security bonds allowance' , async () => {
		const client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		const securityPoolAllowance = repDeposit / 4n
		const priceOracleManagerAndOperatorQueuer = await getPriceOracleManagerAndOperatorQueuer(client, securityPoolAddress)
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
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddress, amountToCreate)
		const completeSetAddress = await getCompleteSetAddress(client, securityPoolAddress)
		const completeSetBalance = await getERC20Balance(client, completeSetAddress, client.account.address)
		assert.strictEqual(amountToCreate, completeSetBalance, 'Did not create enough')
		assert.strictEqual(ethBalance, await getETHBalance(client, client.account.address) + amountToCreate, 'Did not lose eth to create complete sets')
		assert.strictEqual(await getEthAmountForCompleteSets(client, securityPoolAddress), amountToCreate, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddress, amountToCreate)
		assert.strictEqual(ethBalance, await getETHBalance(client, client.account.address), 'Did not get ETH back from complete sets')
		assert.strictEqual(await getERC20Balance(client, completeSetAddress, client.account.address), 0, 'Did not lose complete sets')
	})


	test('can liquidate', async () => {
		// add liquidation test
	})

	test('cannot mint over or withdraw too much rep', async () => {
	// add complete sets minting test where price has changed so we can no longer mint
	})


	test('can fork the system', async () => {

	})

})
