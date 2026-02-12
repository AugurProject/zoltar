import test, { describe, beforeEach } from 'node:test'
import assert from 'node:assert'
import { getMockedEthSimulateWindowEthereum, MockWindowEthereum } from '../testsuite/simulator/MockWindowEthereum.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem.js'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants.js'
import { approveToken, contractExists, ensureZoltarDeployed, forkUniverse, getChildUniverseId, getERC20Balance, getETHBalance, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, getZoltarForkTreshold, setupTestAccounts } from '../testsuite/simulator/utils/utilities.js'
import { addressString, bigintToDecimalString, dateToBigintSeconds } from '../testsuite/simulator/utils/bigint.js'
import { getDeployments } from '../testsuite/simulator/utils/deployments.js'
import { createTransactionExplainer } from '../testsuite/simulator/utils/transactionExplainer.js'
import { approveAndDepositRep, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testsuite/simulator/utils/peripheralsTestUtils.js'
import { deployOriginSecurityPool, ensureInfraDeployed, getMarketId, getSecurityPoolAddresses } from '../testsuite/simulator/utils/deployPeripherals.js'
import { balanceOfSharesInCash, createCompleteSet, depositRep, getCompleteSetCollateralAmount, getEthAmountToBuy, getLastPrice, getMarketEndDate, getPoolOwnershipDenominator, getRepToken, getSecurityVault, getSystemState, getTotalFeesOvedToVaults, getTotalSecurityBondAllowance, migrateShares, OperationType, participateAuction, poolOwnershipToRep, redeemShares } from '../testsuite/simulator/utils/peripherals.js'
import { QuestionOutcome } from '../testsuite/simulator/types/types.js'
import { approximatelyEqual, strictEqual18Decimal, strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils.js'
import { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, forkSecurityPool, getMarketOutcome, getMigratedRep, getSecurityPoolForkerForkData, migrateFromEscalationGame, migrateVault, startTruthAuction } from '../testsuite/simulator/utils/securityPoolForker.js'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes.js'

describe('Peripherals Contract Test Suite', () => {
	let mockWindow: MockWindowEthereum

	let client: WriteClient
	let startBalance: bigint
	//const reportBond = 1n * 10n ** 18n
	const PRICE_PRECISION = 1n * 10n ** 18n
	const repDeposit = 1000n * 10n ** 18n
	const currentTimestamp = dateToBigintSeconds(new Date())
	const marketEndDate = currentTimestamp + 365n * DAY
	let securityPoolAddresses: {
		securityPool: `0x${ string }`,
		priceOracleManagerAndOperatorQueuer: `0x${ string }`,
		shareToken: `0x${ string }`,
		truthAuction: `0x${ string }`,
		escalationGame: `0x${ string }`,
	}
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const startingRepEthPrice = 10n
	const MAX_RETENTION_RATE = 999_999_996_848_000_000n // ≈90% yearly
	const EXTRA_INFO = 'test market!'
	const marketId = getMarketId(genesisUniverse, securityMultiplier, EXTRA_INFO, marketEndDate)

	const marketText = 'test market'
	const outcomes = ['Outcome 1', 'Outcome 2', 'Outcome 3', 'Outcome 4'] as const

	beforeEach(async () => {
		mockWindow = getMockedEthSimulateWindowEthereum()
		mockWindow.setAfterTransactionSendCallBack(createTransactionExplainer(getDeployments(genesisUniverse, marketId, securityMultiplier)))
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		//await mockWindow.setStartBLock(mockWindow.getTime)
		await setupTestAccounts(mockWindow)
	 	startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		await deployOriginSecurityPool(client, genesisUniverse, EXTRA_INFO, marketEndDate, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice)

		await approveAndDepositRep(client, repDeposit, marketId)
		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, marketId, securityMultiplier)
	})
/*
	test('can deposit rep and withdraw it', async () => {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance, 100n, 'Did not get rep back')
	})

	test('can deposit rep and redeem it back after market has ended', async () => {
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		assert.ok(poolOwnershipDenominator > 0n, 'poolOwnershipDenominator was zero')
		const endTime = await getMarketEndDate(client, marketId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const escalationGameAddress = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(escalationGameAddress, securityPoolAddresses.escalationGame, 'escalation game addresses do not match')

		assert.ok(await getForkTreshold(client, securityPoolAddresses.escalationGame) > 10n * reportBond, 'fork treshold need to be big enough')
		await mockWindow.advanceTime(10n * DAY)
		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		strictEqualTypeSafe(yesDeposits.length, 1, 'the should have been one deposit')
		strictEqualTypeSafe(yesDeposits[0].depositIndex, 0n, 'index should be zero')
		strictEqualTypeSafe(yesDeposits[0].depositor, client.account.address, 'wrong depositor')
		strictEqualTypeSafe(yesDeposits[0].cumulativeAmount, reportBond, 'cumulator should be report bond')
		strictEqualTypeSafe(yesDeposits[0].amount, reportBond, 'amount should be report bond')
		strictEqualTypeSafe(await getStartBond(client, securityPoolAddresses.escalationGame), reportBond, 'report bond matches')

		const ourDeposits = yesDeposits.filter((deposit) => BigInt(deposit.depositor) === BigInt(client.account.address))
		strictEqualTypeSafe(await getMarketResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'market has resolved')
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, ourDeposits.map((deposit) => deposit.depositIndex))

		const repBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)
		const repAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		strictEqualTypeSafe(repAfter-repBefore, repDeposit, 'did not get rep back')
		strictEqualTypeSafe(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 'Did not empty security pool of rep')
	})

	test('Can Liquidate', async () => {
		const endTime = await getMarketEndDate(client, marketId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max');
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const initialPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		strictEqualTypeSafe(initialPrice, 1n * PRICE_PRECISION, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)
		const openInterestAmount = 100n * 10n ** 18n
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		await mockWindow.advanceTime(100000n)

		strictEqualTypeSafe(canLiquidate(initialPrice, securityPoolAllowance, repDeposit, 2n), false, 'Should not be able to liquidate yet')
		// REP/ETH increases to 10x, 10 REP = 1 ETH (rep drops in value)
		const forcedPrice = PRICE_PRECISION * 10n
		await requestPriceIfNeededAndQueueOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

		// TODO: this should reject as we should not allow user to block liquidation like this
		//assert.rejects(depositRep(client, securityPoolAddresses.securityPool, repDeposit * 10n), 'operation pending')

		await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

		const currentPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		strictEqualTypeSafe(currentPrice, PRICE_PRECISION * 10n, 'Price did not increase!')

		strictEqualTypeSafe(canLiquidate(currentPrice, securityPoolAllowance, repDeposit, 2n), true, 'Should be able to liquidate now')

		// liquidator should have all the assets now
		const originalVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
		strictEqualTypeSafe(originalVault.securityBondAllowance, 0n, 'original vault should not have any security bonds')
		strictEqualTypeSafe(originalVault.repDepositShare, 0n, 'original vault should not have any rep')
		strictEqualTypeSafe(liquidatorVault.securityBondAllowance, securityPoolAllowance, 'liquidator doesnt have all the security pool allowances')
		strictEqualTypeSafe(liquidatorVault.repDepositShare / PRICE_PRECISION, repDeposit+(repDeposit * 10n), 'liquidator should have all the rep in the pool')
	})

	test('Open Interest Fees (non forking)', async () => {
		const endTime = await getMarketEndDate(client, marketId)
		strictEqualTypeSafe(endTime > dateToBigintSeconds(new Date), true, 'market has already ended')
		const securityPoolAllowance = repDeposit / 4n
		const aMonthFromNow = currentTimestamp + 2628000n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const openInterestAmount = 100n * 10n ** 18n
		await mockWindow.setTime(aMonthFromNow)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)

		await mockWindow.setTime(endTime + 10000n)

		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
		const feesAccrued = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool)
		const ethBalanceBefore = await getETHBalance(client, client.account.address)
		const securityVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(securityVault.securityBondAllowance, securityPoolAllowance, 'securityPoolAllowance is all ours')
		const ethBalanceAfter = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(ethBalanceAfter - ethBalanceBefore, securityVault.unpaidEthFees, 'eth gained should be fees accrued')
		strictEqualTypeSafe(feesAccrued / 1000n, securityVault.unpaidEthFees / 1000n, 'eth gained should be fees accrued (minus rounding issues')
		const completeSetCollateralAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(feesAccrued + completeSetCollateralAmount, openInterestAmount, 'no eth lost')
		const timePassed = endTime - aMonthFromNow
		strictEqualTypeSafe(timePassed / 8640n, 3345n, 'not enough time passed')
		strictEqualTypeSafe(retentionRate, 999999987364000000n, 'retention rate did not match')
		const completeSetCollateralAmountPercentage = Number(completeSetCollateralAmount * 1000n / openInterestAmount) / 10
		const expected = Number(1000n * rpow(retentionRate, timePassed, PRICE_PRECISION) / PRICE_PRECISION) / 10
		strictEqualTypeSafe(completeSetCollateralAmountPercentage, expected, 'return amount did not match')
		const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(contractBalance + ethBalanceAfter - ethBalanceBefore, openInterestAmount, 'contract balance+ fees should equal initial open interest')
	})*/

	/*test('can set security bonds allowance, mint complete sets and fork happily' , async () => {
		const endTime = await getMarketEndDate(client, marketId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max');
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const forkTreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, forkTreshold * 2n)

		const openInterestAmount = 100n * 10n ** 18n
		const maxGasFees = openInterestAmount / 4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		assert.ok(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool) < MAX_RETENTION_RATE, 'retention rate did not decrease after minting complete sets');
		const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		strictEqualTypeSafe(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
		strictEqualTypeSafe(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
		strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, completeSetBalances[0]), openInterestAmount, 'Did not create enough complete sets')
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) > maxGasFees, 'Did not lose eth to create complete sets')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
		assert.ok(ethBalance - await getETHBalance(client, client.account.address) < maxGasFees, 'Did not get ETH back from complete sets')
		const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		strictEqualTypeSafe(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets');

		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

		// forking
		const zoltarForkTreshold = await getZoltarForkTreshold(client, genesisUniverse)
		const burnAmount = zoltarForkTreshold / 5n
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const forkerRepBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), getInfraContractAddresses().securityPoolForker)
		const zoltarForkData = await getUniverseForkData(client, genesisUniverse)
		strictEqualTypeSafe(zoltarForkData.forkerRepDeposit + forkerRepBalance + burnAmount, repBalance, 'forkerRepDeposit + forkerRepBalance+burnAmount should equal deposit')

		await forkSecurityPool(client, securityPoolAddresses.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(forkData.repAtFork, repBalance - burnAmount, 'rep at fork does not match deposit rep')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.outcomeIndex, 0, 'there should be no outcome')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
		const totalFeesOvedToVaultsRightAfterFork = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), 'Parents original rep is gone')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, marketId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		approximatelyEqual(migratedRep, repBalance - burnAmount, 10n, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')

		const totalFees = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool) + await getTotalFeesOvedToVaults(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), openInterestAmount - totalFees, 'child contract did not record the amount correctly')

		const totalFeesOvedToVaultsAfterFork = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(totalFeesOvedToVaultsRightAfterFork, totalFeesOvedToVaultsAfterFork, 'parents fees should be frozen')
	})*/

	test('two security pools with disagreement', async () => {
		const endTime = await getMarketEndDate(client, marketId)
		await mockWindow.setTime(endTime + 10000n)
		const openInterestAmount = 10n * 10n ** 18n
		const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, marketId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkTreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n

		const zoltarForkTreshold = await getZoltarForkTreshold(client, genesisUniverse)
		const burnAmount = zoltarForkTreshold / 5n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkTreshold)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		strictEqual18Decimal(repBalanceInGenesisPool, 2n * repDeposit + 2n * forkTreshold, 'After two deposits, the system should have 2 x repDeposit worth of REP + 2x fork')
		strictEqual18Decimal(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), 2n * securityPoolAllowance, 'Security bond allowance should be 2x')
		strictEqual18Decimal(await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'Pool ownership denominator should equal `pool balance * PRICE_PRECISION` prior fork')

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')
		console.log(`genesis yes client ${repBalanceInGenesisPool}`)
		console.log(`security pool rep: ${ await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool) }`)
		console.log(`zoltarForkTreshold: ${ zoltarForkTreshold }`)
		console.log(`burnAmount: ${ burnAmount }`)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await forkSecurityPool(client, securityPoolAddresses.securityPool)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, marketId, securityMultiplier)

		// we migrate to yes
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		console.log(yesVault)
		console.log('migration')
		//console.log(`migratedRepInYes: ${ bigintToDecimalString(migratedRepInYes, 18n) }`)
		console.log(`own: ${ bigintToDecimalString(repDeposit + 2n * forkTreshold, 18n) }`)
		console.log(`attacker: ${ bigintToDecimalString(repDeposit, 18n) }`)
		repDeposit + 2n * forkTreshold
		console.log(`burnAmount: ${ bigintToDecimalString(burnAmount, 18n) }`)
		console.log(`forkTreshold: ${ bigintToDecimalString(forkTreshold, 18n) }`)
		console.log(`genesis: ${ bigintToDecimalString(repBalanceInGenesisPool, 18n) }`)
		console.log(`parentDivier: ${ bigintToDecimalString(await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool), 18n) }`)
		console.log(`yesDivier: ${ bigintToDecimalString(await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool), 18n) }`)
		const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
		console.log(`yesPoolBalance: ${ bigintToDecimalString(yesPoolBalance, 18n) }`)
		strictEqual18Decimal(await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare), yesPoolBalance-repDeposit, 'we should account for all the rep in yes pool (except attackers rep)')
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
		strictEqual18Decimal(yesPoolBalance-repDeposit, migratedRepInYes, 'yes pool has the same rep as migrated rep')
		strictEqualTypeSafe(await getMarketOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool), repBalanceInGenesisPool - burnAmount, 'yes has all the rep')

		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
		const feesOved = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool) + await getTotalFeesOvedToVaults(client, yesSecurityPool.securityPool)

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, marketId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		strictEqualTypeSafe(await getMarketOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as yes')
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
		approximatelyEqual(migratedRepInNo, repDeposit, 10n, 'other side migrated to no')
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool), repBalanceInGenesisPool - burnAmount, 'no has all the rep')

		// invalid, no one migrated here
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, marketId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		const getCurrentOpenInterestArray = async () => {
			const currentFees = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool) + await getTotalFeesOvedToVaults(client, yesSecurityPool.securityPool)
			return openInterestArray.map((x) => x - currentFees)
		}

		// auction yes
		// parentCollateral - parentCollateral * forkData[securityPool].migratedRep / forkData[parent].repAtFork;
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		console.log(`getCurrentOpenInterestArray: ${ (await getCurrentOpenInterestArray())[0] }`)
		console.log(`openInterestArray: ${ openInterestArray[0] }`)
		console.log(`parent.completeSetCollateralAmount: ${ completeSetAmount }`)
		console.log(`parent.completeSetCollateralAmountshare: ${ completeSetAmount * repDeposit / repBalanceInGenesisPool }`)
		console.log(`parent.completeSetCollateralAmountA: ${ completeSetAmount-completeSetAmount * migratedRepInYes / repAtFork }`)
		//const yesOpenInterestShareToBuy = (await getCurrentOpenInterestArray())[0] * repDeposit / repBalanceInGenesisPool
		const auctionedEthInYes = completeSetAmount-completeSetAmount * migratedRepInYes / repAtFork
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, yesSecurityPool.truthAuction), auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
		// participate yes auction by buying quarter of all REP (this is a open interest and rep holder happy case where REP holders win 50%)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repBalanceInGenesisPool / 4n, auctionedEthInYes)

		// auction no
		//const noOpenInterestShareToBuy = (await getCurrentOpenInterestArray())[0] * (repBalanceInGenesisPool-repDeposit) / (repBalanceInGenesisPool)
		const auctionedEthInNo = completeSetAmount-completeSetAmount * migratedRepInNo / repAtFork
		await startTruthAuction(client, noSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, noSecurityPool.truthAuction), auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
		// participate no auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose 50%)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, repBalanceInGenesisPool * 3n / 4n, auctionedEthInNo)

		// auction invalid
		await startTruthAuction(client, invalidSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthAmountToBuy(client, invalidSecurityPool.truthAuction), completeSetAmount, 10n, 'Need to buy all of open interest on invalid')
		// participate no auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose 50%)
		const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		// buy half of the open interest for 3/4 of everything
		await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, repBalanceInGenesisPool-burnAmount - repBalanceInGenesisPool / 1_000_000n, openInterestAmount / 2n)

		await mockWindow.advanceTime(7n * DAY + DAY)

		// yes status: auction fully funds, 1/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray.map((x) => x - feesOved), 'Shares exist after fork')
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [0n, 1n, 2n])
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [0n, 1n, 2n])
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [0n, 1n, 2n])

		assert.deepStrictEqual(await balanceOfSharesInCash(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2])), [completeSetAmount, completeSetAmount, completeSetAmount], 'Not enough shares in yes')

		approximatelyEqual(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), (await getCurrentOpenInterestArray())[0], 10n, 'yes child contract did not record the amount correctly')
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)

		const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
		const yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)
		approximatelyEqual(yesAuctionParticipantRep, repBalanceInGenesisPool / 4n, 10000n, 'yes auction participant did not get ownership of rep they bought')

		const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalYesVault.repDepositShare)
		approximatelyEqual(originalYesVaultRep, repBalanceInGenesisPool * 3n / 4n, 10000n, 'original yes vault holder should hold rest 3/4 of rep')
		strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

		const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2])), [openInterestAmount, 0n, openInterestAmount], 'Not enough shares')
		const fees = await getTotalFeesOvedToVaults(client, securityPoolAddresses.securityPool) + await getTotalFeesOvedToVaults(client, yesSecurityPool.securityPool)
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + openInterestAmount - fees, 10n ** 15n, 'did not gain eth after redeeming yes shares')

		// no status: auction fully funds, 3/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, noSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2])), await getCurrentOpenInterestArray(), 'Not enough shares in no')

		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool), openInterestAmount, 'no child contract did not record the amount correctly')
		await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)

		const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
		const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)
		approximatelyEqual(noAuctionParticipantRep, repBalanceInGenesisPool * 3n / 4n, 10000n, 'no auction participant did not get ownership of rep they bought')

		const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
		const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, originalNoVault.repDepositShare)
		approximatelyEqual(originalNoVaultRep, repBalanceInGenesisPool * 1n / 4n, 10000n, 'original no vault holder should hold rest 1/4 of rep')
		strictEqualTypeSafe((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
		const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, noSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, noSecurityPool.securityPool, securityPoolAddresses.shareToken, noUniverse, addressString(TEST_ADDRESSES[2])), [openInterestAmount, openInterestAmount, 0n], 'Not enough shares')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + openInterestAmount-fees, 10n ** 15n, 'did not gain eth after redeeming no shares')

		// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
		await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, securityPoolAddresses.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray.map((x) => x / 2n), 'Not enough shares in invalid')
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, invalidSecurityPool.securityPool), openInterestAmount / 2n, 'Invalid child contract did not record the amount correctly')
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

	test('can fork zero rep pools', async () => {
		const endTime = await getMarketEndDate(client, marketId)
		await mockWindow.setTime(endTime + 10000n)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance, 100n, 'Did not get rep back')

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, marketText, outcomes)
		await forkSecurityPool(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, marketId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(migratedRep, 0n, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), 0n, 'child contract did not record the amount correctly')
	})

	// - todo test that users can claim their stuff (shares+rep) even if zoltar forks after market ends
})

