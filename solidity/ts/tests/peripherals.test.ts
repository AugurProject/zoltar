import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog } from 'viem'
import type { Abi, Address, Hash } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { sortBigIntsAscending } from '../../../shared/js/bigInt.js'
import { createWriteClient, WriteClient } from '../testsuite/simulator/utils/viem'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testsuite/simulator/utils/constants'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance, ensureProxyDeployerDeployed, setupTestAccounts, sortStringArrayByKeccak } from '../testsuite/simulator/utils/utilities'
import { addressString, rpow } from '../testsuite/simulator/utils/bigint'
import { approveAndDepositRep, canLiquidate, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureDeploymentStatusOracleDeployed, ensureInfraDeployed, getDeploymentStatusOracleAddress, getDeploymentStepAddresses, getInfraContractAddresses, getSecurityPoolAddresses, loadDeploymentStatusOracleMask } from '../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../testsuite/simulator/utils/contracts/zoltarQuestionData'

import { balanceOfShares, balanceOfSharesInCash, getEthRaiseCap, getLastPrice, getQuestionEndDate, migrateShares, OperationType, participateAuction, requestPriceIfNeededAndStageOperation } from '../testsuite/simulator/utils/contracts/peripherals'
import { getScalarOutcomeIndex } from '../testsuite/simulator/utils/contracts/scalarOutcome'
import { tickToPrice } from '../testsuite/simulator/utils/tickMath'
import { QuestionOutcome } from '../testsuite/simulator/types/types'
import { SystemState } from '../testsuite/simulator/types/peripheralTypes'
import { approximatelyEqual, ensureDefined, strictEqual18Decimal, strictEqualTypeSafe } from '../testsuite/simulator/utils/testUtils'
import { claimAuctionProceeds, createChildUniverse, finalizeTruthAuction, getMigratedRep, getQuestionOutcome, getSecurityPoolForkerForkData, initiateSecurityPoolFork, migrateFromEscalationGame, migrateRepToZoltar, migrateVault, startTruthAuction } from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameDeposits, getNonDecisionThreshold, getQuestionResolution, getStartBond, getUnsettledDepositIndexesByOutcomeAndDepositor } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, getZoltarForkThreshold } from '../testsuite/simulator/utils/contracts/zoltar'
import { getTotalRepPurchased } from '../testsuite/simulator/utils/contracts/auction'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import {
	createCompleteSet,
	depositRep,
	depositToEscalationGame,
	getCompleteSetCollateralAmount,
	getCurrentRetentionRate,
	getAvailableRepBalance,
	getPoolOwnershipDenominator,
	getRepToken,
	getShareTokenSupply,
	getSecurityPoolsEscalationGame,
	getSecurityVault,
	getSystemState,
	getTotalFeesOwedToVaults,
	getTotalSecurityBondAllowance,
	getVaultCount,
	getVaults,
	poolOwnershipToRep,
	redeemCompleteSet,
	redeemFees,
	redeemRep,
	redeemShares,
	sharesToCash,
	updateVaultFees,
	withdrawFromEscalationGame,
} from '../testsuite/simulator/utils/contracts/securityPool'
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_tokens_ShareToken_ShareToken } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const getMigrationProxyAddressAbi = [
	{
		inputs: [
			{
				internalType: 'contract ISecurityPool',
				name: 'securityPool',
				type: 'address',
			},
		],
		name: 'getMigrationProxyAddress',
		outputs: [
			{
				internalType: 'address',
				name: '',
				type: 'address',
			},
		],
		stateMutability: 'view',
		type: 'function',
	},
] satisfies Abi

describe('Peripherals Contract Test Suite', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 1n * 10n ** 18n
	const PRICE_PRECISION = 1n * 10n ** 18n
	const repDeposit = 1000n * 10n ** 18n
	let securityPoolAddresses: {
		securityPool: Address
		priceOracleManagerAndOperatorQueuer: Address
		shareToken: Address
		truthAuction: Address
		escalationGame: Address
	}
	let questionEndDate: bigint
	let questionData: {
		title: string
		description: string
		startTime: bigint
		endTime: bigint
		numTicks: bigint
		displayValueMin: bigint
		displayValueMax: bigint
		answerUnit: string
	}
	const genesisUniverse = 0n
	const securityMultiplier = 2n
	const reportedRepEthPrice = 10n
	const testInternalSenderBalance = 10n ** 18n
	const MAX_RETENTION_RATE = 999_999_996_848_000_000n // ≈90% yearly
	const EXTRA_INFO = 'test question!'
	const outcomes = ['Yes', 'No']
	let questionId: bigint

	const sendEthAndWait = async (from: Address, to: Address, value: bigint) => {
		const hash = (await mockWindow.request({
			method: 'eth_sendTransaction',
			params: [
				{
					from,
					to,
					value: `0x${value.toString(16)}`,
					gasPrice: '0x0',
				},
			],
		})) as Hash
		await client.waitForTransactionReceipt({ hash })
	}

	const transferRepToAddress = async (sender: WriteClient, recipient: Address, amount: bigint) => {
		const hash = await sender.writeContract({
			abi: [
				{
					type: 'function',
					name: 'transfer',
					stateMutability: 'nonpayable',
					inputs: [
						{ name: 'recipient', type: 'address' },
						{ name: 'amount', type: 'uint256' },
					],
					outputs: [{ name: '', type: 'bool' }],
				},
			],
			address: getRepTokenAddress(genesisUniverse),
			functionName: 'transfer',
			args: [recipient, amount],
		})
		await sender.waitForTransactionReceipt({ hash })
	}

	const getVaultRepClaim = async (vaultAddress: Address) => {
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, vaultAddress)
		return await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
	}

	const finalizeQuestionAsYesWithoutFork = async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'question should finalize as yes')
	}

	const setupFinalizedTruthAuctionWithMixedBids = async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingEth = expectedEthToBuy / 10n
		strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		const winningTick = await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		return {
			yesSecurityPool,
			repAtFork,
			expectedEthToBuy,
			losingBidder,
			winningBidder,
			losingEth,
			losingTick,
			winningTick,
		}
	}

	const initializePeripheralsBaseline = async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		await setupTestAccounts(mockWindow)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)
		const currentTimestamp = await mockWindow.getTime()
		questionEndDate = currentTimestamp + 365n * DAY
		questionData = {
			title: EXTRA_INFO,
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE)
		await approveAndDepositRep(client, repDeposit, questionId)
		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)
	}

	beforeAll(async () => {
		await initializePeripheralsBaseline()
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
	})

	test('can deposit rep and withdraw it', async () => {
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit, reportedRepEthPrice)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), reportedRepEthPrice, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance, 100n, 'Did not get rep back')
	})

	test('share token metadata includes the question id', async () => {
		const name = await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'name',
			address: securityPoolAddresses.shareToken,
			args: [],
		})
		const symbol = await client.readContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'symbol',
			address: securityPoolAddresses.shareToken,
			args: [],
		})

		assert.strictEqual(name, `Shares-${questionId}`, 'share token name should include the question id')
		assert.strictEqual(symbol, `SHARE-${questionId}`, 'share token symbol should include the question id')
	})

	test('security pool factory stores deployments for direct query', async () => {
		const factoryAddress = getInfraContractAddresses().securityPoolFactory
		const deploymentCount = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentCount',
			address: factoryAddress,
			args: [],
		})
		const deployments = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			address: factoryAddress,
			args: [0n, deploymentCount],
		})
		const deployment = ensureDefined(deployments[0], 'origin deployment missing')
		const {
			completeSetCollateralAmount,
			currentRetentionRate: storedCurrentRetentionRate,
			parent,
			priceOracleManagerAndOperatorQueuer: managerAddress,
			questionId: storedQuestionId,
			securityMultiplier: storedSecurityMultiplier,
			securityPool: securityPoolAddress,
			shareToken: shareTokenAddress,
			truthAuction: truthAuctionAddress,
			universeId,
		} = deployment
		const expectedAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(deploymentCount, 1n, 'factory should know about the origin deployment')
		strictEqualTypeSafe(securityPoolAddress, expectedAddresses.securityPool, 'stored security pool address should match')
		strictEqualTypeSafe(truthAuctionAddress, expectedAddresses.truthAuction, 'stored truth auction address should match')
		strictEqualTypeSafe(managerAddress, expectedAddresses.priceOracleManagerAndOperatorQueuer, 'stored manager address should match')
		strictEqualTypeSafe(shareTokenAddress, expectedAddresses.shareToken, 'stored share token address should match')
		strictEqualTypeSafe(parent, addressString(0x0n), 'stored parent should be zero for origin deployment')
		strictEqualTypeSafe(universeId, genesisUniverse, 'stored universe should match')
		strictEqualTypeSafe(storedQuestionId, questionId, 'stored question id should match')
		strictEqualTypeSafe(storedSecurityMultiplier, securityMultiplier, 'stored security multiplier should match')
		strictEqualTypeSafe(storedCurrentRetentionRate, MAX_RETENTION_RATE, 'stored retention rate should match')
		strictEqualTypeSafe(completeSetCollateralAmount, 0n, 'origin deployments should not have complete set collateral')
		strictEqualTypeSafe(await getLastPrice(client, managerAddress), 0n, 'origin manager should start with a zero price')
	})

	test('deployment status oracle returns the deployment bitmask in one read', async () => {
		const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
		const deploymentMask = await loadDeploymentStatusOracleMask(client)

		assert.notStrictEqual(await client.getCode({ address: deploymentStatusOracleAddress }), '0x', 'deployment status oracle should be deployed')
		strictEqualTypeSafe(deploymentMask, (1n << BigInt(getDeploymentStepAddresses().length)) - 1n, 'all deployment steps should be deployed after ensureInfraDeployed')
	})

	test('deployment status oracle reports missing contracts from a partial deployment', async () => {
		const partialWindow = getAnvilWindowEthereum()
		const partialClient = createWriteClient(partialWindow, TEST_ADDRESSES[0], 0)
		await partialWindow.resetToCleanState()
		await setupTestAccounts(partialWindow)
		await ensureProxyDeployerDeployed(partialClient)
		await ensureDeploymentStatusOracleDeployed(partialClient)

		const deploymentMask = await loadDeploymentStatusOracleMask(partialClient)

		strictEqualTypeSafe(deploymentMask, 1n, 'only the proxy deployer should be marked deployed before the rest of infra')
		await initializePeripheralsBaseline()
		await setBaselineSnapshot()
	})

	test('security pool exposes vault paging without duplicate entries', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(thirdClient, repDeposit, questionId)
		await depositRep(client, securityPoolAddresses.securityPool, repDeposit)

		const vaultCount = await getVaultCount(client, securityPoolAddresses.securityPool)
		const firstPage = await getVaults(client, securityPoolAddresses.securityPool, 0n, 2n)
		const secondPage = await getVaults(client, securityPoolAddresses.securityPool, 2n, 2n)
		const emptyPage = await getVaults(client, securityPoolAddresses.securityPool, 3n, 1n)

		strictEqualTypeSafe(vaultCount, 3n, 'vault count should track unique vault addresses')
		assert.deepStrictEqual(firstPage, [client.account.address, attackerClient.account.address], 'first page should include the first two vaults in insertion order')
		assert.deepStrictEqual(secondPage, [thirdClient.account.address], 'second page should include the remaining vault')
		assert.deepStrictEqual(emptyPage, [], 'out of range paging should return an empty array')
	})

	test('withdrawal after question end releases escalation lock without changing ownership in single-sided case', async () => {
		if (process.env.RUN_KNOWN_FAILURE_REPROS !== '1') return
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		assert.ok(poolOwnershipDenominator > 0n, 'poolOwnershipDenominator was zero')
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		const escalationGameAddress = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(escalationGameAddress, securityPoolAddresses.escalationGame, 'escalation game addresses do not match')

		assert.ok((await getNonDecisionThreshold(client, securityPoolAddresses.escalationGame)) > 10n * reportBond, 'fork threshold needs to be big enough')
		await mockWindow.advanceTime(10n * DAY)
		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		strictEqualTypeSafe(yesDeposits.length, 1, 'there should be one deposit')
		const yesDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(yesDeposit.depositIndex, 0n, 'index should be zero')
		strictEqualTypeSafe(yesDeposit.depositor, client.account.address, 'wrong depositor')
		strictEqualTypeSafe(yesDeposit.cumulativeAmount, reportBond, 'cumulative should be report bond')
		strictEqualTypeSafe(yesDeposit.amount, reportBond, 'amount should be report bond')
		strictEqualTypeSafe(await getStartBond(client, securityPoolAddresses.escalationGame), reportBond, 'report bond matches')

		const vaultBeforeWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const ourDeposits = yesDeposits.filter(deposit => BigInt(deposit.depositor) === BigInt(client.account.address))
		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question has resolved')
		await withdrawFromEscalationGame(
			client,
			securityPoolAddresses.securityPool,
			QuestionOutcome.Yes,
			ourDeposits.map(deposit => deposit.depositIndex),
		)

		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const repClaimIncrease = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterWithdrawal.repDepositShare - vaultBeforeWithdrawal.repDepositShare)
		strictEqualTypeSafe(repClaimIncrease, 0n, 'single-sided withdrawal should only unlock the original deposit without changing ownership')
		strictEqualTypeSafe(vaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'escalation lock should be released after withdrawal')
	})

	test('withdrawFromEscalationGame shares the binding-capital reward pool across all reward-eligible winning deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const firstWinningDeposit = 5n * 10n ** 18n
		const secondWinningDeposit = 5n * 10n ** 18n
		const thirdWinningDeposit = 5n * 10n ** 18n
		const fourthWinningDeposit = 2n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n
		const totalWinningPrincipal = firstWinningDeposit + secondWinningDeposit + thirdWinningDeposit + fourthWinningDeposit
		const totalPrincipalLocked = totalWinningPrincipal + losingDeposit
		const expectedBindingCapital = losingDeposit
		const expectedRewardEligibleCap = 15n * 10n ** 18n
		const expectedRewardBonusPool = 6n * 10n ** 18n
		const expectedGrossWinningPayout = 23n * 10n ** 18n
		const expectedWinnerProfit = expectedGrossWinningPayout - totalWinningPrincipal
		const expectedResidualHaircut = totalPrincipalLocked - expectedGrossWinningPayout

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, thirdWinningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, fourthWinningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(50n * DAY)

		const lockedRepBeforeWithdrawal = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).lockedRepInEscalationGame
		const withdrawalHash = await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n, 1n, 2n, 3n])
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const winningClaimAmount = withdrawalReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.filter(log => log?.eventName === 'ClaimDeposit')
			.reduce((sum, log) => sum + (log?.args.amountToWithdraw ?? 0n), 0n)
		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(lockedRepBeforeWithdrawal, totalWinningPrincipal, 'winner should have exactly the winning-side principal locked before withdrawal')
		strictEqualTypeSafe(expectedBindingCapital, losingDeposit, 'single losing side should set the binding capital in this scenario')
		strictEqualTypeSafe(expectedRewardEligibleCap, expectedBindingCapital + expectedBindingCapital / 2n, 'reward-eligible cap should extend 50% beyond binding capital')
		strictEqualTypeSafe(expectedRewardBonusPool, (expectedBindingCapital * 3n) / 5n, 'binding-capital reward pool should equal the unburned 60% share')
		strictEqualTypeSafe(expectedGrossWinningPayout, 7n * 10n ** 18n + 7n * 10n ** 18n + 7n * 10n ** 18n + 2n * 10n ** 18n, 'gross winning payout should match the pooled reward schedule')
		strictEqualTypeSafe(expectedWinnerProfit, expectedGrossWinningPayout - totalWinningPrincipal, 'winner profit should equal payout minus winning principal')
		strictEqualTypeSafe(winningClaimAmount, expectedGrossWinningPayout, 'winning withdrawals should emit the expected gross payout across all reward-eligible deposits')
		strictEqualTypeSafe(totalPrincipalLocked - totalWinningPrincipal, losingDeposit, 'losing side should contribute 10 REP of principal')
		strictEqualTypeSafe(expectedResidualHaircut, 4n * 10n ** 18n, '40% of the 10 REP binding-capital region should remain as slashed residual in the pool')
		strictEqualTypeSafe(vaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'winning withdrawals should unlock all deposited REP')
	})

	test('losing escalation deposits stay locked and reduce the losing vaults available REP claim after winner withdrawal', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const winningDeposit = 20n * 10n ** 18n
		const losingDeposit = 10n * 10n ** 18n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const losingVaultBeforeWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const losingClaimBeforeWithdrawal = await getVaultRepClaim(attackerClient.account.address)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const losingVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const losingClaimAfterWithdrawal = await getVaultRepClaim(attackerClient.account.address)
		const losingAvailableClaimAfterWithdrawal = losingClaimAfterWithdrawal - losingVaultAfterWithdrawal.lockedRepInEscalationGame

		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(losingVaultBeforeWithdrawal.lockedRepInEscalationGame, losingDeposit, 'losing-side REP should start fully locked')
		strictEqualTypeSafe(losingVaultAfterWithdrawal.lockedRepInEscalationGame, losingDeposit, 'losing-side REP should remain locked after the winner withdraws')
		strictEqualTypeSafe(losingClaimAfterWithdrawal, losingClaimBeforeWithdrawal, 'losing total collateral claim should stay unchanged while the losing principal remains locked')
		strictEqualTypeSafe(losingAvailableClaimAfterWithdrawal < losingClaimAfterWithdrawal, true, 'locked losing REP should stay excluded from the vaults immediately available claim')
	})

	test('withdrawRep only uses available REP and cannot drain another vaults locked escalation stake', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const availableRepBeforeWithdrawal = await getAvailableRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepBeforeWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)

		const availableRepAfterWithdrawal = await getAvailableRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const aliceVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		strictEqualTypeSafe(availableRepBeforeWithdrawal, repDeposit * 2n - lockedDeposit, 'available REP should exclude the locked escalation deposit')
		strictEqualTypeSafe(aliceWalletRepAfterWithdrawal - aliceWalletRepBeforeWithdrawal, repDeposit, 'withdrawal should still allow the caller to exit its full unlocked collateral claim')
		strictEqualTypeSafe(availableRepAfterWithdrawal, repDeposit - lockedDeposit, 'remaining available REP should still exclude the locked stake after withdrawal')
		strictEqualTypeSafe(aliceVaultAfterWithdrawal.repDepositShare, 0n, 'full vault withdrawal should remove the callers ownership share')
		strictEqualTypeSafe(attackerVaultAfterWithdrawal.lockedRepInEscalationGame, lockedDeposit, 'the other vaults locked escalation stake should remain intact')
	})

	test('redeemRep requires settled escalation deposits after question finalization', async () => {
		await finalizeQuestionAsYesWithoutFork()

		const walletRepBeforeRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await assert.rejects(redeemRep(client, securityPoolAddresses.securityPool, client.account.address), /settle escalation deposits first/)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const settledRepClaim = await getVaultRepClaim(client.account.address)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)

		const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		strictEqualTypeSafe(vaultAfterRedeem.repDepositShare, 0n, 'redeemRep should empty the vault once escalation is settled')
		strictEqualTypeSafe(vaultAfterRedeem.lockedRepInEscalationGame, 0n, 'settling escalation should clear the lock before redemption')
		strictEqualTypeSafe(walletRepAfterRedeem - walletRepBeforeRedeem, settledRepClaim, 'redeemRep should pay out the fully settled REP claim')
	})

	test('oracle-staged collateral operations are rejected once escalation resolves', async () => {
		await finalizeQuestionAsYesWithoutFork()

		await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, 1n), /question already resolved/)
	})

	test('withdrawFromEscalationGame gives safety-boundary deposits a pro-rata share of the binding-capital reward pool', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(firstWinner, repDeposit, questionId)
		await approveAndDepositRep(secondWinner, repDeposit, questionId)
		await approveAndDepositRep(losingSide, repDeposit, questionId)

		const firstWinningDeposit = 20n * 10n ** 18n
		const secondWinningDeposit = 14n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n
		const expectedFirstWinnerPayout = 28n * 10n ** 18n
		const expectedSecondWinnerPayout = 18n * 10n ** 18n

		await depositToEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(losingSide, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const firstWithdrawalHash = await withdrawFromEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const secondWithdrawalHash = await withdrawFromEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const firstReceipt = await client.waitForTransactionReceipt({ hash: firstWithdrawalHash })
		const secondReceipt = await client.waitForTransactionReceipt({ hash: secondWithdrawalHash })
		const firstClaimLog = firstReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const secondClaimLog = secondReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const firstWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, firstWinner.account.address)
		const secondWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, secondWinner.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdraw, expectedFirstWinnerPayout, 'the first winning deposit should receive the pro-rata reward on its full 20 REP reward-eligible principal')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdraw, expectedSecondWinnerPayout, 'the crossing deposit should receive reward on its 10 REP safety-boundary slice and principal only on its 4 REP excess slice')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('withdrawFromEscalationGame shares the full reward pool across the actual winning principal when total winning principal stays below the reward cap', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinner = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondWinner = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingSide = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(firstWinner, repDeposit, questionId)
		await approveAndDepositRep(secondWinner, repDeposit, questionId)
		await approveAndDepositRep(losingSide, repDeposit, questionId)

		const firstWinningDeposit = 14n * 10n ** 18n
		const secondWinningDeposit = 10n * 10n ** 18n
		const losingDeposit = 20n * 10n ** 18n
		const expectedFirstWinnerPayout = 21n * 10n ** 18n
		const expectedSecondWinnerPayout = 15n * 10n ** 18n

		await depositToEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstWinningDeposit)
		await depositToEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondWinningDeposit)
		await depositToEscalationGame(losingSide, securityPoolAddresses.securityPool, QuestionOutcome.No, losingDeposit)
		await mockWindow.advanceTime(60n * DAY)

		const firstWithdrawalHash = await withdrawFromEscalationGame(firstWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const secondWithdrawalHash = await withdrawFromEscalationGame(secondWinner, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [1n])
		const firstReceipt = await client.waitForTransactionReceipt({ hash: firstWithdrawalHash })
		const secondReceipt = await client.waitForTransactionReceipt({ hash: secondWithdrawalHash })
		const firstClaimLog = firstReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const secondClaimLog = secondReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_EscalationGame_EscalationGame.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.find(log => log?.eventName === 'ClaimDeposit')
		const firstWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, firstWinner.account.address)
		const secondWinnerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, secondWinner.account.address)

		strictEqualTypeSafe(await getQuestionResolution(client, securityPoolAddresses.escalationGame), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(firstClaimLog?.args.amountToWithdraw, expectedFirstWinnerPayout, 'when total winning principal stays below the reward cap, the first winner should receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(secondClaimLog?.args.amountToWithdraw, expectedSecondWinnerPayout, 'when total winning principal stays below the reward cap, the second winner should also receive its pro-rata share of the full reward pool')
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.lockedRepInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('can refund escalation deposits after zoltar forks on another question', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 1n)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		const aliceDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const bobDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const aliceDeposit = ensureDefined(aliceDeposits[0], 'alice escalation deposit missing')
		const bobDeposit = ensureDefined(bobDeposits[0], 'bob escalation deposit missing')

		const aliceVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const slot5 = '0x' + 5n.toString(16).padStart(64, '0')
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[slot5]: repDeposit * 10n,
				},
			},
		})

		const otherQuestionData = {
			...questionData,
			title: 'fork source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)

		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.None, 'external fork should cancel the game outcome')

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [aliceDeposit.depositIndex])
		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [bobDeposit.depositIndex])

		const aliceVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		const aliceOwnershipDelta = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, aliceVaultAfter.repDepositShare - aliceVaultBefore.repDepositShare)
		const bobOwnershipDelta = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, bobVaultAfter.repDepositShare - bobVaultBefore.repDepositShare)

		strictEqualTypeSafe(aliceOwnershipDelta, 0n, 'alice refund should only unlock principal after external fork')
		strictEqualTypeSafe(bobOwnershipDelta, 0n, 'bob refund should only unlock principal after external fork')
		strictEqualTypeSafe(aliceVaultAfter.lockedRepInEscalationGame, 0n, 'alice escalation lock should be released')
		strictEqualTypeSafe(bobVaultAfter.lockedRepInEscalationGame, 0n, 'bob escalation lock should be released')
	})

	test('withdrawFromEscalationGame rejects wrong outcome after normal resolution', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [0n]), /Invalid deposit index/)
	})

	test('winning escalation settlement cannot be processed twice and unsettled deposit discovery updates accordingly', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		const unsettledBefore = await getUnsettledDepositIndexesByOutcomeAndDepositor(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes, client.account.address, 0n, 10n)
		strictEqualTypeSafe(unsettledBefore.length, 1, 'the winning deposit should be discoverable before settlement')
		strictEqualTypeSafe(unsettledBefore[0], 0n, 'the first winning deposit should be returned')

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const unsettledAfter = await getUnsettledDepositIndexesByOutcomeAndDepositor(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes, client.account.address, 0n, 10n)
		strictEqualTypeSafe(unsettledAfter.length, 0, 'settled winning deposits should disappear from discovery results')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /deposit already settled/)
	})

	test('withdrawFromEscalationGame rejects none outcome after external fork cancellation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const slot5 = '0x' + 5n.toString(16).padStart(64, '0')
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[slot5]: repDeposit * 10n,
				},
			},
		})

		const otherQuestionData = {
			...questionData,
			title: 'fork none outcome source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.None, [0n]), /Invalid outcome: None/)
	})

	test('losing escalation deposits can be settled after resolution and stop counting as locked collateral', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + 1n)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, reportBond)

		await mockWindow.advanceTime(10n * DAY)

		const noDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const canceledCandidateDeposit = ensureDefined(noDeposits[0], 'no escalation deposit missing')
		const attackerClaimBeforeSettlement = await getVaultRepClaim(attackerClient.account.address)

		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex])
		const attackerVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		const attackerClaimAfterSettlement = await getVaultRepClaim(attackerClient.account.address)
		strictEqualTypeSafe(attackerVaultAfterSettlement.lockedRepInEscalationGame, 0n, 'losing-side settlement should clear the resolved escalation lock')
		approximatelyEqual(attackerClaimAfterSettlement, attackerClaimBeforeSettlement - reportBond, 1n, 'settling a losing escalation deposit should realize the REP loss')
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex]), /deposit already settled/)
	})

	test('canceled escalation deposits cannot be refunded twice after an external fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'duplicate canceled settlement source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /deposit already settled/)
	})

	test('cannot refund an active escalation deposit before zoltar forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /Question has not finalized!/)
	})

	test('third parties can permissionlessly settle another vaults resolved escalation deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		await mockWindow.advanceTime(10n * DAY)

		const yesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const ourDeposit = ensureDefined(yesDeposits[0], 'yesDeposits[0] is undefined')
		strictEqualTypeSafe(ourDeposit.depositor, client.account.address, 'wrong depositor')

		const clientVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [ourDeposit.depositIndex])
		const clientVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(clientVaultAfterSettlement.lockedRepInEscalationGame, 0n, 'permissionless settlement should clear the owners lock')
		strictEqualTypeSafe(clientVaultAfterSettlement.repDepositShare >= clientVaultBeforeSettlement.repDepositShare, true, 'permissionless settlement should preserve or increase the owners vault claim')
	})

	test('create child universe test', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)

		const factoryAddress = getInfraContractAddresses().securityPoolFactory
		const deploymentCount = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentCount',
			address: factoryAddress,
			args: [],
		})
		const childUniverseId = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const expectedChildAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, childUniverseId, questionId, securityMultiplier)

		const deployments = await client.readContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			address: factoryAddress,
			args: [0n, deploymentCount],
		})
		const matchingChildDeployment = ensureDefined(
			deployments.find(deployment => deployment.parent === securityPoolAddresses.securityPool && deployment.universeId === childUniverseId),
			'child deployment not found',
		)
		const {
			completeSetCollateralAmount: childCompleteSetCollateralAmount,
			currentRetentionRate: childCurrentRetentionRate,
			parent: childParent,
			priceOracleManagerAndOperatorQueuer: childManagerAddress,
			questionId: childStoredQuestionId,
			securityMultiplier: childStoredSecurityMultiplier,
			securityPool: childSecurityPoolAddress,
			shareToken: childShareTokenAddress,
			truthAuction: childTruthAuctionAddress,
			universeId: childStoredUniverseId,
		} = matchingChildDeployment

		strictEqualTypeSafe(deploymentCount > 1n, true, 'factory should track more than one deployment')
		strictEqualTypeSafe(childSecurityPoolAddress, expectedChildAddresses.securityPool, 'child deployment should be queryable')
		strictEqualTypeSafe(childTruthAuctionAddress, expectedChildAddresses.truthAuction, 'child truth auction should be queryable')
		strictEqualTypeSafe(childManagerAddress, expectedChildAddresses.priceOracleManagerAndOperatorQueuer, 'child manager should be queryable')
		strictEqualTypeSafe(childShareTokenAddress, expectedChildAddresses.shareToken, 'child share token should be queryable')
		strictEqualTypeSafe(childParent, securityPoolAddresses.securityPool, 'child parent should match the origin security pool')
		strictEqualTypeSafe(childStoredUniverseId, childUniverseId, 'child universe id should match')
		strictEqualTypeSafe(childStoredQuestionId, questionId, 'child question id should match')
		strictEqualTypeSafe(childStoredSecurityMultiplier, securityMultiplier, 'child multiplier should match')
		strictEqualTypeSafe(childCurrentRetentionRate, MAX_RETENTION_RATE, 'child retention rate should match')
		strictEqualTypeSafe(childCompleteSetCollateralAmount, 0n, 'child complete set collateral should default to zero during fork')
		strictEqualTypeSafe(await getLastPrice(client, childManagerAddress), await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 'child manager should inherit the parent price')
	})

	test('forkZoltarWithOwnEscalationGame auto-initiates the pool fork and ignores stray REP already sitting on the forker', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const strayRep = 7n * 10n ** 18n
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const burnAmount = zoltarForkThreshold / 5n

		await mockWindow.setTime(endTime + 10000n)
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'forkWithOwnEscalationGame should auto-initiate the parent pool fork')
		strictEqualTypeSafe(forkData.repAtFork, repBalance - burnAmount, 'repAtFork should only track the parent pool REP after the own-game fork')
	})

	test('initiateSecurityPoolFork reverts after the own-game fork and ignores stray REP transferred to the forker', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const strayRep = 9n * 10n ** 18n
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const burnAmount = zoltarForkThreshold / 5n

		await mockWindow.setTime(endTime + 10000n)
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
		await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /Security pool fork already initiated/)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 're-initiating after the own-game fork should leave the parent pool in PoolForked')
		strictEqualTypeSafe(forkData.repAtFork, repBalance - burnAmount, 'repAtFork should ignore unrelated REP transferred to the forker after the own-game fork')
	})

	test('Can Liquidate', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const initialPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		assert.ok(initialPrice > 0n, 'Price was not set!')
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
		await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

		await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

		const currentPrice = await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		strictEqualTypeSafe(currentPrice, PRICE_PRECISION * 10n, 'Price did not increase!')

		strictEqualTypeSafe(canLiquidate(currentPrice, securityPoolAllowance, repDeposit, 2n), true, 'Should be able to liquidate now')

		// liquidator should have all the assets now
		const originalVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVault = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
		strictEqualTypeSafe(originalVault.securityBondAllowance, 0n, 'original vault should not have any security bonds')
		strictEqualTypeSafe(originalVault.repDepositShare, 0n, 'original vault should not have any rep')
		strictEqualTypeSafe(liquidatorVault.securityBondAllowance, securityPoolAllowance, "liquidator doesn't have all the security pool allowances")
		strictEqualTypeSafe(liquidatorVault.repDepositShare / PRICE_PRECISION, repDeposit + repDeposit * 10n, 'liquidator should have all the rep in the pool')
	})

	test('liquidation should use snapshot to prevent blocking via additional rep deposit', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		// Set the target's security bond allowance
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		// Create liquidator and deposit rep
		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 10n)

		// Create open interest
		const openInterestAmount = 100n * 10n ** 18n
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		await mockWindow.advanceTime(100000n)

		// Snapshot state before attack (just before queuing liquidation)
		const vaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const snapshotTargetOwnership = vaultBefore.repDepositShare
		const snapshotTargetAllowance = vaultBefore.securityBondAllowance
		const snapshotTotalRep = await getAvailableRepBalance(client, securityPoolAddresses.securityPool)
		const snapshotDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)

		const snapshotExpectedRepDeposit = (snapshotTargetOwnership * snapshotTotalRep) / snapshotDenominator

		// Queue liquidation (liquidator requests price to trigger liquidation)
		const forcedPrice = PRICE_PRECISION * 10n
		await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

		// Record liquidator's ownership before attack
		const liquidatorVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
		const liquidatorBeforeOwnership = liquidatorVaultBefore.repDepositShare

		// Attacker (the target vault owner) deposits additional REP while liquidation is pending
		const extraRepAmount = repDeposit * 5n
		await depositRep(client, securityPoolAddresses.securityPool, extraRepAmount)

		// Capture state after deposit but before liquidation
		const vaultAfterDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const afterDepositOwnership = vaultAfterDeposit.repDepositShare
		const denominatorAfter = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const totalRepAfter = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)

		// Trigger the queued liquidation by reporting the forced price
		await handleOracleReporting(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, forcedPrice)

		// After liquidation, read final states
		const liquidatorVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
		const targetVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		// Target's allowance should be zero after liquidation (since we moved the full allowance)
		strictEqualTypeSafe(targetVaultAfter.securityBondAllowance, 0n, 'target security bond allowance should be zero after liquidation')

		// Compute expected changes based on snapshot
		const debtToMove = securityPoolAllowance
		const effectiveDebtToMove = debtToMove < snapshotTargetAllowance ? debtToMove : snapshotTargetAllowance
		const repToMove = (effectiveDebtToMove * snapshotExpectedRepDeposit) / snapshotTargetAllowance
		const ownershipToMove = (repToMove * denominatorAfter) / totalRepAfter

		// The target's ownership should decrease by approximately ownershipToMove
		const targetOwnershipChange = afterDepositOwnership - targetVaultAfter.repDepositShare
		approximatelyEqual(targetOwnershipChange, ownershipToMove, 1n, 'Target ownership decrease should match ownershipToMove')

		// The liquidator's ownership should increase by the same amount
		const liquidatorOwnershipChange = liquidatorVaultAfter.repDepositShare - liquidatorBeforeOwnership
		approximatelyEqual(liquidatorOwnershipChange, ownershipToMove, 1n, 'Liquidator ownership increase should match ownershipToMove')

		// Verify that the REP amount taken (repToMove) matches the reduction in target's claim
		const claimReduction = (targetOwnershipChange * totalRepAfter) / denominatorAfter
		approximatelyEqual(claimReduction, repToMove, 1n, 'Claim reduction should equal repToMove')
	})

	test('liquidation continues to count a vaults own escalation lock as backing collateral', async () => {
		const securityPoolAllowance = 400n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const liquidatorClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveToken(liquidatorClient, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await depositRep(liquidatorClient, securityPoolAddresses.securityPool, repDeposit * 2n)

		strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolAllowance, repDeposit, 2n), false, 'vault should start safe before locking REP')

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 300n * 10n ** 18n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

		const targetVaultAfterLock = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		strictEqualTypeSafe(targetVaultAfterLock.lockedRepInEscalationGame, lockedDeposit, 'target vault should have the escalation principal marked as locked')
		strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolAllowance, await getVaultRepClaim(client.account.address), 2n), false, 'the vault should remain safe because its own escalation principal still backs its allowance')

		await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

		const targetVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(targetVaultAfterLiquidation.securityBondAllowance, securityPoolAllowance, 'liquidation should fail because the targets locked REP still counts as backing')
	})

	test('locking REP in escalation preserves total collateral claims and only reduces the lockers withdrawable balance', async () => {
		const secondVaultClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(secondVaultClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)

		const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const secondVault = await getSecurityVault(client, securityPoolAddresses.securityPool, secondVaultClient.account.address)
		const firstVaultTotalClaim = await getVaultRepClaim(client.account.address)
		const secondVaultTotalClaim = await getVaultRepClaim(secondVaultClient.account.address)
		const availableRepBalance = await getAvailableRepBalance(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(firstVaultTotalClaim, repDeposit, 'locking REP should not reduce the lockers total collateral claim')
		strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'locking REP should not reduce another vaults total collateral claim')
		strictEqualTypeSafe(firstVault.lockedRepInEscalationGame, lockedDeposit, 'the lockers escalation principal should be tracked as locked')
		strictEqualTypeSafe(firstVaultTotalClaim - firstVault.lockedRepInEscalationGame, repDeposit - lockedDeposit, 'the lockers withdrawable REP should shrink by the locked amount')
		strictEqualTypeSafe(secondVault.lockedRepInEscalationGame, 0n, 'the unrelated vault should have no locked REP')
		strictEqualTypeSafe(secondVaultTotalClaim - secondVault.lockedRepInEscalationGame, repDeposit, 'the unrelated vault should keep its full withdrawable REP')
		strictEqualTypeSafe(availableRepBalance, repDeposit * 2n - lockedDeposit, 'pool available REP should exclude only the escalation-locked principal')
	})

	test('Open Interest Fees (non forking)', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		strictEqualTypeSafe(endTime > (await mockWindow.getTime()), true, 'question has already ended')
		const securityPoolAllowance = repDeposit / 4n
		const aMonthFromNow = (await mockWindow.getTime()) + 2628000n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const openInterestAmount = 100n * 10n ** 18n
		await mockWindow.setTime(aMonthFromNow)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		const retentionRate = await getCurrentRetentionRate(client, securityPoolAddresses.securityPool)

		await mockWindow.setTime(endTime + 10000n)

		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
		const feesAccrued = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		const ethBalanceBefore = await getETHBalance(client, client.account.address)
		const securityVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await redeemFees(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(securityVault.securityBondAllowance, securityPoolAllowance, 'securityPoolAllowance is all ours')
		const ethBalanceAfter = await getETHBalance(client, client.account.address)
		strictEqualTypeSafe(ethBalanceAfter - ethBalanceBefore, securityVault.unpaidEthFees, 'eth gained should be fees accrued')
		strictEqualTypeSafe(feesAccrued / 1000n, securityVault.unpaidEthFees / 1000n, 'eth gained should be fees accrued (minus rounding issues)')
		const completeSetCollateralAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(feesAccrued + completeSetCollateralAmount, openInterestAmount, 'no eth lost')
		const timePassed = endTime - aMonthFromNow
		strictEqualTypeSafe(timePassed / 8640n, 3345n, 'not enough time passed')
		strictEqualTypeSafe(retentionRate, 999999987364000000n, 'retention rate did not match')
		const completeSetCollateralAmountPercentage = Number((completeSetCollateralAmount * 1000n) / openInterestAmount) / 10
		const expected = Number((1000n * rpow(retentionRate, timePassed, PRICE_PRECISION)) / PRICE_PRECISION) / 10
		strictEqualTypeSafe(completeSetCollateralAmountPercentage, expected, 'return amount did not match')
		const contractBalance = await getETHBalance(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(contractBalance + ethBalanceAfter - ethBalanceBefore, openInterestAmount, 'contract balance + fees should equal initial open interest')
	})

	test('can set security bonds allowance, mint complete sets and fork happily', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max')
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		strictEqualTypeSafe(await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool), securityPoolAllowance, 'Security pool allowance was not set correctly')

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, forkThreshold * 2n)

		const openInterestAmount = 100n * 10n ** 18n
		const maxGasFees = openInterestAmount / 4n
		const ethBalance = await getETHBalance(client, client.account.address)
		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		assert.ok((await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)) > 0n, 'contract did not record collateral after minting complete sets')
		const completeSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		strictEqualTypeSafe(completeSetBalances[0], completeSetBalances[1], 'yes no and invalid share counts need to match')
		strictEqualTypeSafe(completeSetBalances[1], completeSetBalances[2], 'yes no and invalid share counts need to match')
		strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, completeSetBalances[0]), openInterestAmount, 'Did not create enough complete sets')
		assert.ok(ethBalance - (await getETHBalance(client, client.account.address)) > maxGasFees, 'Did not lose eth to create complete sets')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), openInterestAmount, 'contract did not record the amount correctly')
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, completeSetBalances[0])
		assert.ok(ethBalance - (await getETHBalance(client, client.account.address)) < maxGasFees, 'Did not get ETH back from complete sets')
		const newCompleteSetBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, client.account.address)
		strictEqualTypeSafe(newCompleteSetBalances[0], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(newCompleteSetBalances[1], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(newCompleteSetBalances[2], 0n, 'Did not lose complete sets')
		strictEqualTypeSafe(await getCurrentRetentionRate(client, securityPoolAddresses.securityPool), MAX_RETENTION_RATE, 'retention rate was not at max after zero complete sets')

		await createCompleteSet(client, securityPoolAddresses.securityPool, openInterestAmount)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

		// forking
		const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const burnAmount = zoltarForkThreshold / 5n
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(forkData.repAtFork, repBalance - burnAmount, 'rep at fork does not match deposit rep')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.outcomeIndex, 0, 'there should be no outcome')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
		const totalFeesOwedToVaultsRightAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), "Parent's original rep is gone")
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		assert.ok(migratedRep > 0n, 'some REP should migrate into the child pool')
		assert.ok(migratedRep < repBalance - burnAmount, 'migrated rep should exclude fork-bonus ownership from escalation settlement')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'yes child should now require a truth auction because migrated rep excludes escalation reward uplift')
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const yesEthRaiseCap = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
		await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repAtFork, yesEthRaiseCap)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should become operational after the truth auction finalizes')

		const totalFees = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))
		const yesCollateral = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		assert.ok(yesCollateral > 0n, 'child pool should retain some collateral after the truth auction')
		assert.ok(yesCollateral <= openInterestAmount - totalFees, 'child collateral should stay bounded by the original complete-set collateral minus fees')

		const totalFeesOwedToVaultsAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(totalFeesOwedToVaultsRightAfterFork, totalFeesOwedToVaultsAfterFork, "parent's fees should be frozen")
	})

	test('redeemShares updates security-pool accounting as winning shares are redeemed', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
		await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

		const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
		const secondHolderShares = await balanceOfShares(secondHolder, securityPoolAddresses.shareToken, genesisUniverse, secondHolder.account.address)
		const firstWinningShares = ensureDefined(firstHolderShares[1], 'first holder winning shares missing')
		const secondWinningShares = ensureDefined(secondHolderShares[1], 'second holder winning shares missing')
		const initialCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const initialShareSupply = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
		const firstWinningCashValue = await sharesToCash(client, securityPoolAddresses.securityPool, firstWinningShares)
		assert.ok(initialCollateral > 0n, 'collateral should be positive before finalization')
		strictEqualTypeSafe(initialShareSupply, firstWinningShares + secondWinningShares, 'share supply should equal the minted winning-share balances')

		await finalizeQuestionAsYesWithoutFork()
		await redeemShares(firstHolder, securityPoolAddresses.securityPool)

		approximatelyEqual(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), initialCollateral - firstWinningCashValue, 10n, 'collateral should shrink after first winning redemption')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), initialShareSupply - firstWinningShares, 'share supply should shrink after first winning redemption')
		approximatelyEqual(await sharesToCash(client, securityPoolAddresses.securityPool, secondWinningShares), initialCollateral - firstWinningCashValue, 10n, 'remaining winning shares should not be double counted')

		await redeemShares(secondHolder, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'collateral should be empty after all winning shares are redeemed')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'share supply should be empty after all winning shares are redeemed')
	})

	test('sharesToCash returns zero for stale non-winning shares after all winning shares are redeemed', async () => {
		const completeSetAmount = 1n * 10n ** 18n
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, completeSetAmount)
		await finalizeQuestionAsYesWithoutFork()
		const shareBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, openInterestHolder.account.address)
		const winningShares = ensureDefined(shareBalances[1], 'winning shares should exist before redemption')
		const winningShareCashValue = await sharesToCash(client, securityPoolAddresses.securityPool, winningShares)

		assert.ok(winningShareCashValue > 0n, 'winning shares should map to a positive cash value before redemption')
		await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining collateral')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should consume the remaining share supply')
		strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, winningShares), 0n, 'once winning supply is exhausted, leftover losing shares should no longer map to any cash value')
	})

	test('redeemShares stays available after an unrelated late fork once the question has finalized', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 5n * 10n ** 18n)
		await finalizeQuestionAsYesWithoutFork()

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const repTotalSupplySlot = '0x' + 5n.toString(16).padStart(64, '0')
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[repTotalSupplySlot]: repDeposit * 10n,
				},
			},
		})

		const lateForkQuestionData = {
			...questionData,
			title: 'late unrelated fork',
			endTime: await mockWindow.getTime(),
		}
		const lateForkQuestionId = getQuestionId(lateForkQuestionData, outcomes)
		await createQuestion(attackerClient, lateForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, lateForkQuestionId)

		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'late unrelated fork should not erase finalized market outcome')
		await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'winning redemption should still complete after the unrelated fork')
	})

	test('two security pools with disagreement', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const openInterestAmount = 10n * 10n ** 18n
		const openInterestArray = [openInterestAmount, openInterestAmount, openInterestAmount]
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n

		const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const burnAmount = zoltarForkThreshold / 5n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		assert.ok(repBalanceInGenesisPool > 0n, 'genesis pool should contain rep before the fork')
		assert.ok((await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)) > 0n, 'security bond allowance should be non-zero')
		strictEqual18Decimal(await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool), repBalanceInGenesisPool * PRICE_PRECISION, 'Pool ownership denominator should equal `pool balance * PRICE_PRECISION` prior fork')

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		assert.deepStrictEqual(await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])), openInterestArray, 'Did not create enough complete sets')
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		// we migrate to yes
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
		strictEqual18Decimal(await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare), yesPoolBalance - repDeposit, "we should account for all the rep in yes pool (except attacker's rep)")
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
		assert.ok(migratedRepInYes > 0n, 'yes pool should track migrated REP')
		assert.ok(migratedRepInYes < yesPoolBalance - repDeposit, 'migrated rep should exclude escalation reward uplift from child ownership')
		strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool), repBalanceInGenesisPool - burnAmount, 'yes has all the rep')

		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
		const feesOwed = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as no')
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
		approximatelyEqual(migratedRepInNo, repDeposit, 10n, 'other side migrated to no')
		strictEqualTypeSafe(await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool), repBalanceInGenesisPool - burnAmount, 'no has all the rep')

		assert.ok((await getETHBalance(client, securityPoolAddresses.securityPool)) >= (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)), 'parent pool should retain at least enough ETH to cover its remaining fee liabilities')

		// invalid, no one migrated here
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid) // no one migrated, we need to create the universe as rep holders did not
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		const getCurrentOpenInterestArray = async (): Promise<[bigint, bigint, bigint]> => {
			const currentFees = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))
			const result = openInterestArray.map(x => x - currentFees) as [bigint, bigint, bigint]
			return result
		}

		// auction yes
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const auctionedEthInYes = completeSetAmount - (completeSetAmount * migratedRepInYes) / repAtFork
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
		// participate yes auction by buying quarter of all REP (this is a open interest and rep holder happy case where REP holders win 50%)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const yesAuctionTick = await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repBalanceInGenesisPool / 4n, auctionedEthInYes)

		// auction no
		const auctionedEthInNo = completeSetAmount - (completeSetAmount * migratedRepInNo) / repAtFork
		await startTruthAuction(client, noSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthRaiseCap(client, noSecurityPool.truthAuction), auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
		// participate no auction by buying 3/4 of all REP (this is a open interest happy case where REP holders lose 50%)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		const noAuctionTick = await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, (repBalanceInGenesisPool * 3n) / 4n, auctionedEthInNo)

		// auction invalid
		await startTruthAuction(client, invalidSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction started')
		approximatelyEqual(await getEthRaiseCap(client, invalidSecurityPool.truthAuction), completeSetAmount, 10n, 'Need to buy all of open interest on invalid')
		const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		// buy half of the open interest for 3/4 of everything
		const invalidAuctionTick = await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, repBalanceInGenesisPool - burnAmount - repBalanceInGenesisPool / 1_000_000n, completeSetAmount)

		await mockWindow.advanceTime(7n * DAY + DAY)

		// yes status: auction fully funds, 1/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		assert.deepStrictEqual(
			await balanceOfSharesInCash(client, securityPoolAddresses.securityPool, securityPoolAddresses.shareToken, genesisUniverse, addressString(TEST_ADDRESSES[2])),
			openInterestArray.map(x => x - feesOwed),
			'Shares exist after fork',
		)
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.No, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Invalid, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])

		const actualShares = await balanceOfSharesInCash(client, yesSecurityPool.securityPool, yesSecurityPool.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(actualShares.length, 3, 'should have 3 outcomes')
		const yesChildCollateral = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		actualShares.forEach((value, idx) => approximatelyEqual(value, yesChildCollateral, 1000000000000000n, `share ${idx} should approximately equal the current yes child collateral`))

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'Yes System should be operational again')
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address, [{ tick: yesAuctionTick, bidIndex: 0n }])

		const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
		const yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)

		// Compute expected REP from bid parameters: REP = ETH * PRICE_PRECISION / price
		const yesClearingPrice = tickToPrice(yesAuctionTick)
		const expectedYesRep = (auctionedEthInYes * 1_000_000_000_000_000_000n) / yesClearingPrice
		approximatelyEqual(yesAuctionParticipantRep, expectedYesRep, 1_000n, 'yes auction participant should get expected REP')

		const originalYesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const originalYesVaultRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalYesVault.repDepositShare)
		assert.ok(originalYesVaultRep > yesAuctionParticipantRep, 'original yes vault holder should retain the majority of REP ownership after the auction')
		strictEqualTypeSafe((await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)).repDepositShare, 0n, 'attacker should have zero as they did not migrate to yes')

		const balancePriorYesRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, yesSecurityPool.securityPool)
		const currentShares = await getCurrentOpenInterestArray()
		const actualSharesAfterRedeem = await balanceOfSharesInCash(client, yesSecurityPool.securityPool, securityPoolAddresses.shareToken, yesUniverse, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(actualSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
		assert.strictEqual(actualSharesAfterRedeem[1], 0n, 'share1 should be zero')
		assert.strictEqual(actualSharesAfterRedeem[2], 0n, 'non-winning no shares should be worthless after the only winning claimant redeems')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorYesRedeemal + yesChildCollateral, 10n ** 15n, 'did not gain eth after redeeming yes shares')

		// no status: auction fully funds, 3/4 of rep balance is sold for eth
		await finalizeTruthAuction(client, noSecurityPool.securityPool)
		const actualNoShares = await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
		const noChildCollateral = await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool)
		approximatelyEqual(actualNoShares[0], noChildCollateral, noChildCollateral, 'no share0 should be approximately expected')
		approximatelyEqual(actualNoShares[1], noChildCollateral, noChildCollateral, 'no share1 should be approximately expected')
		approximatelyEqual(actualNoShares[2], noChildCollateral, noChildCollateral, 'no share2 should be approximately expected')

		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')

		// Read purchasedRep for no auction participant

		await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address, [{ tick: noAuctionTick, bidIndex: 0n }])

		const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
		const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)

		// Compute expected REP from bid parameters
		const noClearingPrice = tickToPrice(noAuctionTick)
		const expectedNoRep = (auctionedEthInNo * 1_000_000_000_000_000_000n) / noClearingPrice
		approximatelyEqual(noAuctionParticipantRep, expectedNoRep, 1_000n, 'no auction participant should get expected REP')

		const originalNoVault = await getSecurityVault(client, noSecurityPool.securityPool, attackerClient.account.address)
		const originalNoVaultRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, originalNoVault.repDepositShare)
		approximatelyEqual(originalNoVaultRep, (repBalanceInGenesisPool * 1n) / 4n - burnAmount, repBalanceInGenesisPool, 'original no vault holder should hold rest 1/4 of rep')
		strictEqualTypeSafe((await getSecurityVault(client, noSecurityPool.securityPool, client.account.address)).repDepositShare, 0n, 'client should have zero as they did not migrate to no')
		const balancePriorNoRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, noSecurityPool.securityPool)
		const actualNoSharesAfterRedeem = await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(actualNoSharesAfterRedeem[0], 0n, 'non-winning invalid shares should be worthless after the only winning claimant redeems')
		assert.strictEqual(actualNoSharesAfterRedeem[1], 0n, 'non-winning yes shares should be worthless after the only winning claimant redeems')
		assert.strictEqual(actualNoSharesAfterRedeem[2], 0n, 'no after redeem share2 should be zero')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorNoRedeemal + noChildCollateral, openInterestAmount, 'did not gain eth after redeeming no shares')

		// invalid status: auction 3/4 funds for all REP (minus 1/100 000). Open interest holders lose 50%
		await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
		const actualInvalidShares = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
		const invalidChildCollateral = await getCompleteSetCollateralAmount(client, invalidSecurityPool.securityPool)
		approximatelyEqual(actualInvalidShares[0], invalidChildCollateral, invalidChildCollateral, 'invalid share0 should match')
		approximatelyEqual(actualInvalidShares[1], invalidChildCollateral, invalidChildCollateral, 'invalid share1 should match')
		approximatelyEqual(actualInvalidShares[2], invalidChildCollateral, invalidChildCollateral, 'invalid share2 should match')
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')

		// Read purchasedRep for invalid auction participant

		await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address, [{ tick: invalidAuctionTick, bidIndex: 0n }])

		const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
		const invalidAuctionParticipantRep = await poolOwnershipToRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.repDepositShare)

		// Compute expected REP from bid parameters
		const invalidClearingPrice = tickToPrice(invalidAuctionTick)
		const expectedInvalidRep = (completeSetAmount * 1_000_000_000_000_000_000n) / invalidClearingPrice
		approximatelyEqual(invalidAuctionParticipantRep, expectedInvalidRep, 1_000n, 'invalid auction participant should get expected REP')

		// try creating new complete sets
		const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, ensureDefined(currentShares[0], 'currentShares[0] is undefined'))

		const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
		const actualInvalidSharesAfterRedeem1 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(actualInvalidSharesAfterRedeem1[0], 0n, 'redeeming invalid shares should consume the winning invalid leg')
		assert.ok(actualInvalidSharesAfterRedeem1[1] > 0n, 'non-winning residual shares should still retain redeemable value after the first invalid redemption')
		assert.ok(actualInvalidSharesAfterRedeem1[2] > 0n, 'non-winning residual shares should still retain redeemable value after the first invalid redemption')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + invalidChildCollateral, openInterestAmount * 1000n, 'did not gain eth after redeeming invalid shares')

		const balancePriorInvalidRedeemal2 = await getETHBalance(client, addressString(TEST_ADDRESSES[4]))
		await redeemShares(openInterestHolder2, invalidSecurityPool.securityPool)
		const actualInvalidSharesAfterRedeem2 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[4]))
		assert.strictEqual(actualInvalidSharesAfterRedeem2[0], 0n, 'redeeming invalid shares should consume the winning invalid leg for the second holder as well')
		assert.ok((await getETHBalance(client, addressString(TEST_ADDRESSES[4]))) > balancePriorInvalidRedeemal2, 'redeeming invalid shares should increase the second holder ETH balance')
	})

	test('can migrate shares into arbitrary scalar child universes after an external scalar fork', async () => {
		const openInterestAmount = 5n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const scalarForkQuestion = {
			title: 'scalar fork',
			description: '',
			startTime: 0n,
			endTime: await mockWindow.getTime(),
			numTicks: 10n,
			displayValueMin: 0n,
			displayValueMax: 10n,
			answerUnit: 'km',
		}
		const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

		await createQuestion(client, scalarForkQuestion, [])
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, openInterestAmount)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, scalarQuestionId)

		const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
		const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
		const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
		const holderAddress = addressString(TEST_ADDRESSES[2])
		const parentBalancesBeforeMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		const parentYesBalance = ensureDefined(parentBalancesBeforeMigration[1], 'parent yes balance is undefined')

		await migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, sortedScalarOutcomes)

		const parentBalancesAfterMigration = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		strictEqualTypeSafe(parentBalancesAfterMigration[1], 0n, 'parent yes shares should be burned after migration')

		const lowScalarUniverse = getChildUniverseId(genesisUniverse, lowScalarOutcome)
		const lowScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, lowScalarUniverse, holderAddress)
		strictEqualTypeSafe(lowScalarBalances[0], 0n, 'invalid shares should stay at zero in the low scalar child universe')
		strictEqualTypeSafe(lowScalarBalances[1], parentYesBalance, 'yes shares should migrate into the low scalar child universe')
		strictEqualTypeSafe(lowScalarBalances[2], 0n, 'no shares should stay at zero in the low scalar child universe')

		const highScalarUniverse = getChildUniverseId(genesisUniverse, highScalarOutcome)
		const highScalarBalances = await balanceOfShares(client, securityPoolAddresses.shareToken, highScalarUniverse, holderAddress)
		strictEqualTypeSafe(highScalarBalances[0], 0n, 'invalid shares should stay at zero in the high scalar child universe')
		strictEqualTypeSafe(highScalarBalances[1], parentYesBalance, 'yes shares should migrate into the high scalar child universe')
		strictEqualTypeSafe(highScalarBalances[2], 0n, 'no shares should stay at zero in the high scalar child universe')
	})

	test('rejects malformed, duplicate, and unsorted share migration target outcomes', async () => {
		const openInterestAmount = 5n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const scalarForkQuestion = {
			title: 'scalar fork',
			description: '',
			startTime: 0n,
			endTime: await mockWindow.getTime(),
			numTicks: 10n,
			displayValueMin: 0n,
			displayValueMax: 10n,
			answerUnit: 'km',
		}
		const scalarQuestionId = getQuestionId(scalarForkQuestion, [])

		await createQuestion(client, scalarForkQuestion, [])
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, openInterestAmount)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, scalarQuestionId)

		const holderAddress = addressString(TEST_ADDRESSES[2])
		const lowScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 3n)
		const validScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 5n)
		const highScalarOutcome = getScalarOutcomeIndex(scalarForkQuestion, 7n)
		const sortedScalarOutcomes = sortBigIntsAscending([lowScalarOutcome, highScalarOutcome])
		const parentBalancesBeforeFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		const parentYesBalance = ensureDefined(parentBalancesBeforeFailedMigrations[1], 'parent yes balance is undefined')

		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [5n]), /Malformed/)
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [validScalarOutcome, validScalarOutcome]), /Target outcomes must be strictly increasing/)
		await assert.rejects(migrateShares(openInterestHolder, securityPoolAddresses.shareToken, genesisUniverse, QuestionOutcome.Yes, [...sortedScalarOutcomes].reverse()), /Target outcomes must be strictly increasing/)

		const parentBalancesAfterFailedMigrations = await balanceOfShares(client, securityPoolAddresses.shareToken, genesisUniverse, holderAddress)
		strictEqualTypeSafe(parentBalancesAfterFailedMigrations[1], parentYesBalance, 'failed migrations should preserve the parent yes share balance')
	})

	test('can fork zero rep pools', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)
		strictEqualTypeSafe(await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer), 1n * PRICE_PRECISION, 'Price was not set!')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool), 0n, 100n, 'Did not empty security pool of rep')
		approximatelyEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), startBalance + repDeposit, 100n, 'Did not get rep back')

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, questionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration needs to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(migratedRep, 0n, 'correct amount rep migrated')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should be operational right away')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), 0n, 'child contract did not record the amount correctly')
	})

	test('redeemRep removes redeemed ownership from the child pool denominator once the child pool is operational', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
		const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)
		const denominatorBeforeRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)

		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)

		const clientVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const denominatorAfterRedeem = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		const attackerClaimAfterRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)

		strictEqualTypeSafe(clientVaultAfterRedeem.repDepositShare, 0n, 'redeeming a vault should zero out its child-pool ownership')
		assert.ok(denominatorAfterRedeem <= denominatorBeforeRedeem, 'redeeming a vault should not increase the child pool denominator')
		approximatelyEqual(attackerClaimAfterRedeem, attackerClaimBeforeRedeem, 10n, 'redeeming another vault should preserve the remaining vault claim up to rounding')
	})

	test('parent pool halts on fork while a migrated child can resume operational flows', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'parent pool should enter PoolForked after the universe fork is activated')
		await assert.rejects(createCompleteSet(client, securityPoolAddresses.securityPool, 1n), /Zoltar has forked/)
		await assert.rejects(depositRep(client, securityPoolAddresses.securityPool, 1n), /Zoltar has forked/)

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational once migration and truth-auction processing finish')

		const childOpenInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const collateralBeforeCreate = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)
		await createCompleteSet(childOpenInterestHolder, yesSecurityPool.securityPool, 1n)
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), collateralBeforeCreate + 1n, 'operational child pool should accept new complete-set collateral')
	})

	test('can migrate escalation deposits before migrateVault', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const parentVaultBeforeEscalationMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const childVaultRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare)
		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		assert.ok(childVaultRepClaim > migratedRep, 'vault ownership should preserve escalation winnings even when escalation migration runs first')
		assert.ok(migratedRep > 0n, 'some REP should be tracked as migrated')
		assert.ok(parentVaultAfterMigration.lockedRepInEscalationGame < parentVaultBeforeEscalationMigration.lockedRepInEscalationGame, 'migrating a winning escalation deposit should reduce the parent escalation lock')
		strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repDepositShare, 0n, 'parent vault should be emptied after migration')
	})

	test('migrateRepToZoltar should fund an already-created child pool instead of stranding child REP on the forker', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const childRepToken = getRepTokenAddress(yesUniverse)
		const forkerBalance = await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker)
		const childPoolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)

		strictEqualTypeSafe(forkerBalance, 0n, 'forker should not retain child REP after migrating to an already-created child pool')
		strictEqualTypeSafe(childPoolBalance, repAtFork, 'child pool should receive the full migrated REP balance even when deployed before migrateRepToZoltar')
	})

	test('migrateVault preserves escalation migration state', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const vaultAfterEscalationMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		assert.ok(vaultAfterEscalationMigration.repDepositShare > 0n, 'escalation migration should create child vault ownership before migrateVault')
		strictEqualTypeSafe(vaultAfterEscalationMigration.securityBondAllowance, 0n, 'escalation-only migration should not set security bond allowance')

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const vaultAfterVaultMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		assert.ok(vaultAfterVaultMigration.repDepositShare > vaultAfterEscalationMigration.repDepositShare, 'migrateVault should add to existing child ownership instead of overwriting it')
		strictEqualTypeSafe(vaultAfterVaultMigration.securityBondAllowance, securityPoolAllowance, 'migrateVault should add the parent bond allowance on top of escalation migration state')
	})

	test('migrateFromEscalationGame rejects unresolved deposits after an unrelated external fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, repDeposit / 10n)

		const forkSourceQuestionData = {
			...questionData,
			title: 'external fork source question for unresolved escalation migration',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(client, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		await assert.rejects(migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /escalation game has not reached non-decision/i)
	})

	test('migrateFromEscalationGame only counts principal toward migrated rep and clears parent escalation locks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = repDeposit / 8n
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const migratedBeforeEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)

		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const migratedAfterEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		strictEqualTypeSafe(migratedAfterEscalation - migratedBeforeEscalation, winningDeposit, 'only escalation principal should count toward migrated rep accounting')
		strictEqualTypeSafe(parentVaultBeforeMigration.lockedRepInEscalationGame - parentVaultAfterMigration.lockedRepInEscalationGame, winningDeposit, 'migration should clear exactly the winning deposit principal from the parent escalation lock')
		assert.ok(childVaultAfterMigration.repDepositShare > 0n, 'child vault should still receive migrated ownership')
	})

	test('startTruthAuction skips auction startup when all REP is already migrated', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

		const forkSourceQuestionData = {
			...questionData,
			title: 'full migration external fork source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(client, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const denominatorBeforeStart = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getMigratedRep(client, yesSecurityPool.securityPool), forkData.repAtFork, 'all parent REP should already be represented by migrated vault ownership in this fast path')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when no auction is needed')
		strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when the auction is skipped')
		strictEqualTypeSafe(await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool), denominatorBeforeStart, 'skipping the auction should preserve the existing child ownership denominator when no REP is sold')
	})

	test('startTruthAuction skips auction startup when no collateral remains to buy', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const clientVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const clientClaimBeforeFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeFinalize.repDepositShare)

		assert.ok(clientClaimBeforeFinalize > 0n, 'the migrated vault should retain a positive child-pool REP claim before immediate finalization')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'the no-collateral fast path requires zero remaining parent collateral')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when there is no collateral left to buy')
		strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when there is no collateral to buy')
		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork - clientClaimBeforeFinalize, 10n, 'immediate finalization without an auction should still leave the migrated vault redeemable')
	})

	test('escalation migration remains redeemable after truth auction finalization', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const originalVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childBalanceBeforeFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		const originalClaimBeforeFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultBeforeFinalize.repDepositShare)
		strictEqualTypeSafe(originalClaimBeforeFinalize, childBalanceBeforeFinalize, 'before finalization the migrated vault should still claim the full child REP balance')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const originalVaultAfterFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childBalanceAfterFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
		const originalClaimAfterFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultAfterFinalize.repDepositShare)
		approximatelyEqual(originalClaimAfterFinalize, childBalanceAfterFinalize - totalRepPurchased, 10n, 'finalization should reserve purchased REP for auction buyers instead of inflating migrated vault claims')

		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), totalRepPurchased, 10n, 'redeeming the migrated vault should leave only the auction-purchased REP behind')

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])
		const auctionVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
		const auctionClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, auctionVault.repDepositShare)
		approximatelyEqual(auctionClaim, totalRepPurchased, 10n, 'claimAuctionProceeds should assign the reserved REP to the winning bidder')

		await redeemRep(auctionParticipant, yesSecurityPool.securityPool, auctionParticipant.account.address)
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), 0n, 'the child pool should stay fully redeemable after both migrated and auction-purchased REP are claimed')
	})

	test('multiple migrated holders remain redeemable after truth auction finalization', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childRepToken = getRepTokenAddress(yesUniverse)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const clientVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
		const clientClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
		const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)
		const childBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
		approximatelyEqual(clientClaimBeforeRedeem + attackerClaimBeforeRedeem, childBalanceBeforeRedeem - totalRepPurchased, 10n, 'migrated holders should jointly claim only the unsold child REP after finalization')

		await redeemRep(attackerClient, yesSecurityPool.securityPool, attackerClient.account.address)
		const clientClaimAfterFirstRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
		approximatelyEqual(clientClaimAfterFirstRedeem, clientClaimBeforeRedeem, 10n, 'redeeming one migrated holder should not brick the remaining migrated holder')

		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), totalRepPurchased, 10n, 'after both migrated holders redeem, only the auction-purchased REP should remain in the child pool')
	})

	test('repro: migrateRepToZoltar shares migration balance across parent pools before child creation', async () => {
		const secondQuestionData = {
			...questionData,
			title: 'second security pool question',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier, MAX_RETENTION_RATE)

		const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
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
		const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
		const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
		const childRepToken = await getRepToken(client, firstYesChildPool)
		const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
		const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.repAtFork, 'the first child pool should receive only the REP migrated from the first parent pool')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.repAtFork, 'the second child pool should receive only the REP migrated from the second parent pool')
	})

	test('migration proxies deploy lazily at their predicted CREATE2 addresses', async () => {
		const secondQuestionData = {
			...questionData,
			title: 'second security pool question for proxy deployment checks',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier, MAX_RETENTION_RATE)

		const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
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
			abi: getMigrationProxyAddressAbi,
			functionName: 'getMigrationProxyAddress',
			address: securityPoolForkerAddress,
			args: [securityPoolAddresses.securityPool],
		})
		const secondProxyAddress = await client.readContract({
			abi: getMigrationProxyAddressAbi,
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
				abi: getMigrationProxyAddressAbi,
				functionName: 'getMigrationProxyAddress',
				address: securityPoolForkerAddress,
				args: [securityPoolAddresses.securityPool],
			}),
			firstProxyAddress,
			'first proxy address should stay stable after deployment',
		)
		strictEqualTypeSafe(
			await client.readContract({
				abi: getMigrationProxyAddressAbi,
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
			abi: getMigrationProxyAddressAbi,
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
		strictEqualTypeSafe(await getMigrationRepBalance(client, genesisUniverse, migrationProxyAddress), forkData.repAtFork, 'proxy migration ledger should equal the parent pool REP tracked at fork time')
		assert.ok(!(await contractExists(client, yesChildRepToken)), 'child REP token should not exist before migration splitting deploys it')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		assert.ok(await contractExists(client, yesChildRepToken), 'migration splitting should deploy the child REP token')
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), forkData.repAtFork, 'proxy should temporarily hold the split child REP before the child pool exists')

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverseId, questionId, securityMultiplier).securityPool
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), 0n, 'proxy should sweep child REP away once the child pool exists')
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, yesSecurityPool), forkData.repAtFork, 'child pool should receive the full split REP after the proxy sweep')
	})

	test('migrateRepToZoltar keeps child-universe REP isolated when both parent pools pre-create the same child outcome', async () => {
		const secondQuestionData = {
			...questionData,
			title: 'second security pool question with precreated child',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier, MAX_RETENTION_RATE)

		const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
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
		const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
		const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
		const childRepToken = await getRepToken(client, firstYesChildPool)
		const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
		const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.repAtFork, 'the first pre-created child pool should receive only the first parent pool REP')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.repAtFork, 'the second pre-created child pool should receive only the second parent pool REP')
		strictEqualTypeSafe(await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker), 0n, 'forker should not retain child REP after both pre-created child pools are funded')
	})

	test('migrateRepToZoltar keeps later parent pools isolated after an earlier parent already migrated and deployed its child pool', async () => {
		const secondQuestionData = {
			...questionData,
			title: 'second security pool question after first migration',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier, MAX_RETENTION_RATE)

		const secondPoolOwner = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(secondPoolOwner, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
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
		const firstYesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesChildUniverseId, questionId, securityMultiplier).securityPool
		const secondYesChildPool = getSecurityPoolAddresses(secondSecurityPoolAddresses.securityPool, yesChildUniverseId, secondQuestionId, securityMultiplier).securityPool
		const childRepToken = await getRepToken(client, firstYesChildPool)
		const firstChildRepBalance = await getERC20Balance(client, childRepToken, firstYesChildPool)
		const secondChildRepBalance = await getERC20Balance(client, childRepToken, secondYesChildPool)

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.repAtFork, 'the first child pool balance should remain unchanged after the second pool migrates later')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.repAtFork, 'the second child pool should still receive only its own migrated REP even after the first pool already migrated')
	})

	test('redeemRep should stay blocked until the own-fork child pool becomes operational', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'child pool should still be in fork migration before the truth-auction window ends')
		strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'own-fork child currently reports a finalized outcome before the pool is operational')
		await assert.rejects(redeemRep(client, yesSecurityPool.securityPool, client.account.address), 'redeemRep should remain blocked until the child pool is operational')
	})

	// - TODO test that users can claim their stuff (shares+rep) even if zoltar forks after question ends

	test('simple truth auction: participant buys rep and can claim proceeds', async () => {
		// Setup: create open interest, trigger fork, migrate
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		// Set security bond allowance and deposit extra REP for capacity
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		// Fork the security pool
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		// Migrate vault to yes
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		// Skip escalation game migration for simpler test
		// await migrateFromEscalationGame(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		// Wait for migration period
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		// Start truth auction
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction should start')

		// Get auction parameters
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		approximatelyEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), expectedEthToBuy, 10n, 'ethToBuy mismatch')

		// Participant bids: buy 1/4 of repAtFork for the full ethToBuy
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const repToBuy = repAtFork / 4n
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repToBuy, expectedEthToBuy)

		// Finalize auction
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		// Verify participant got REP allocation

		// Claim proceeds
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

		// Verify they got ownership shares matching purchasedRep (with tolerance for rounding)
		const vault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
		const repFromOwnership = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vault.repDepositShare)
		assert.ok(repFromOwnership > 0n, 'auction participant should have some rep')
	})

	test('claimAuctionProceeds releases ETH for a finalized losing bid without mutating vault accounting', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingEth = expectedEthToBuy / 10n
		strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
		strictEqualTypeSafe(totalRepPurchased > 0n, true, 'setup should leave a finalized auction with purchased REP')

		const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
		const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
		const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

		const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
		const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
		const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'finalized losing bidder should receive their full ETH refund')
		strictEqualTypeSafe(losingVaultAfterClaim.repDepositShare, losingVaultBeforeClaim.repDepositShare, 'refund-only finalized claim should not mint pool ownership')
		strictEqualTypeSafe(losingVaultAfterClaim.securityBondAllowance, losingVaultBeforeClaim.securityBondAllowance, 'refund-only finalized claim should not assign security bond allowance')
		strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'refund-only finalized claim should not alter fee accounting')
		strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'refund-only finalized claim should not create a new vault')
	})

	test('claimAuctionProceeds handles a zero-REP finalized refund path when totalRepPurchased is zero', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingEth = expectedEthToBuy / 10n
		strictEqualTypeSafe(losingEth > 0n, true, 'zero-REP refund test should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		await mockWindow.addStateOverrides({
			[yesSecurityPool.truthAuction]: {
				stateDiff: {
					[`0x${11n.toString(16)}`]: 0n,
				},
			},
		})

		strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'setup should finalize with zero purchased REP')

		const vaultCountBeforeClaim = await getVaultCount(client, yesSecurityPool.securityPool)
		const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)
		const losingVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

		const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)
		const losingVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, losingBidder.account.address)
		const vaultCountAfterClaim = await getVaultCount(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'zero-REP finalized claim should release the full ETH refund')
		strictEqualTypeSafe(losingVaultAfterClaim.repDepositShare, losingVaultBeforeClaim.repDepositShare, 'zero-REP finalized claim should not mint pool ownership')
		strictEqualTypeSafe(losingVaultAfterClaim.securityBondAllowance, losingVaultBeforeClaim.securityBondAllowance, 'zero-REP finalized claim should not assign security bond allowance')
		strictEqualTypeSafe(losingVaultAfterClaim.feeIndex, losingVaultBeforeClaim.feeIndex, 'zero-REP finalized claim should not alter fee accounting')
		strictEqualTypeSafe(vaultCountAfterClaim, vaultCountBeforeClaim, 'zero-REP finalized claim should not create a new vault')
	})

	test('claimAuctionProceeds preserves winner accounting when a finalized losing refund is settled first', async () => {
		const { yesSecurityPool, expectedEthToBuy, losingBidder, losingTick, winningBidder, winningTick } = await setupFinalizedTruthAuctionWithMixedBids()
		const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, winningBidder.account.address, [{ tick: winningTick, bidIndex: 0n }])

		const winningVault = await getSecurityVault(client, yesSecurityPool.securityPool, winningBidder.account.address)
		const winningRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, winningVault.repDepositShare)
		const expectedWinningRep = (expectedEthToBuy * PRICE_PRECISION) / tickToPrice(winningTick)

		approximatelyEqual(winningRep, expectedWinningRep, 1_000n, 'winning claims should still receive the expected REP after a losing refund settles first')
		strictEqualTypeSafe(winningVault.securityBondAllowance, forkData.auctionedSecurityBondAllowance, 'refund-only claims must not consume any auctioned allowance before the winner claims')
	})

	test('claimAuctionProceeds allows a third party to settle a finalized losing refund for the bidder', async () => {
		const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
		const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		const thirdPartyBalanceBeforeClaim = await getETHBalance(client, thirdParty.account.address)
		const losingBidderBalanceBeforeClaim = await getETHBalance(client, losingBidder.account.address)

		await claimAuctionProceeds(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])

		const thirdPartyBalanceAfterClaim = await getETHBalance(client, thirdParty.account.address)
		const losingBidderBalanceAfterClaim = await getETHBalance(client, losingBidder.account.address)

		strictEqualTypeSafe(losingBidderBalanceAfterClaim - losingBidderBalanceBeforeClaim, losingEth, 'permissionless callers should still refund ETH to the losing bidder')
		strictEqualTypeSafe(thirdPartyBalanceAfterClaim, thirdPartyBalanceBeforeClaim, 'permissionless settlement should not redirect refund ETH to the caller')
	})

	test('claimAuctionProceeds does not emit ClaimAuctionProceeds for refund-only settlements', async () => {
		const { yesSecurityPool, losingBidder, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()
		const claimHash = await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
		const receipt = await client.waitForTransactionReceipt({ hash: claimHash })
		const claimLogs = receipt.logs
			.map(log => {
				try {
					return decodeEventLog({
						abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
						data: log.data,
						topics: log.topics,
					})
				} catch (error) {
					if (!isIgnorableLogDecodeError(error)) throw error
					return undefined
				}
			})
			.filter(log => log?.eventName === 'ClaimAuctionProceeds')

		strictEqualTypeSafe(claimLogs.length, 0, 'refund-only settlements should not emit ClaimAuctionProceeds')
	})

	test('claimAuctionProceeds cannot settle the same finalized losing bid twice', async () => {
		const { yesSecurityPool, losingBidder, losingTick } = await setupFinalizedTruthAuctionWithMixedBids()

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }])
		await assert.rejects(async () => await claimAuctionProceeds(client, yesSecurityPool.securityPool, losingBidder.account.address, [{ tick: losingTick, bidIndex: 0n }]), /already claimed/)
	})

	test('claimAuctionProceeds should add auctioned allowance on top of an existing migrated allowance', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: auctionTick, bidIndex: 0n }])

		const migratedVaultAfterClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const expectedAllowanceAfterClaim = migratedVaultBeforeClaim.securityBondAllowance + (forkData.auctionedSecurityBondAllowance * totalRepPurchased) / totalRepPurchased

		strictEqualTypeSafe(forkData.auctionedSecurityBondAllowance > 0n, true, 'test setup should leave some allowance to be assigned by the truth auction')
		strictEqualTypeSafe(migratedVaultAfterClaim.securityBondAllowance, expectedAllowanceAfterClaim, 'claimAuctionProceeds should preserve migrated allowance and add the auction-acquired allowance on top')
	})

	test('claimAuctionProceeds initializes fee accounting for a newly auction-funded vault at the current pool fee index', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		await mockWindow.advanceTime(DAY)
		await updateVaultFees(client, yesSecurityPool.securityPool, client.account.address)
		const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, auctionParticipant.account.address, [{ tick: auctionTick, bidIndex: 0n }])

		const participantVault = await getSecurityVault(client, yesSecurityPool.securityPool, auctionParticipant.account.address)
		strictEqualTypeSafe(participantVault.feeIndex, migratedVaultBeforeClaim.feeIndex, 'newly auction-funded vaults should inherit the current child-pool fee index')
	})

	test('claimAuctionProceeds allows a vault to claim winning bids across multiple calls', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const firstBidEth = expectedEthToBuy / 2n
		const secondBidEth = expectedEthToBuy - firstBidEth
		const firstAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, firstBidEth)
		const secondAuctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 8n, secondBidEth)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])
		const vaultAfterFirstClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const repAfterFirstClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vaultAfterFirstClaim.repDepositShare)

		await claimAuctionProceeds(client, yesSecurityPool.securityPool, client.account.address, [{ tick: secondAuctionTick, bidIndex: 1n }])
		const vaultAfterSecondClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const repAfterSecondClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, vaultAfterSecondClaim.repDepositShare)

		assert.ok(repAfterFirstClaim > 0n, 'first claim should credit some REP-backed ownership')
		assert.ok(repAfterSecondClaim > repAfterFirstClaim, 'second claim should be able to add the remaining winning bid')
	})

	test('claimAuctionProceeds assigns the full auctioned allowance across split claims without leaving rounding residue', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const firstBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const secondBidder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).repAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const firstAuctionTick = await participateAuction(firstBidder, yesSecurityPool.truthAuction, repAtFork / 3n, expectedEthToBuy / 3n)
		const secondAuctionTick = await participateAuction(secondBidder, yesSecurityPool.truthAuction, repAtFork - repAtFork / 3n, expectedEthToBuy - expectedEthToBuy / 3n)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const forkDataBeforeClaims = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, firstBidder.account.address, [{ tick: firstAuctionTick, bidIndex: 0n }])
		const secondBidIndex = secondAuctionTick === firstAuctionTick ? 1n : 0n
		await claimAuctionProceeds(client, yesSecurityPool.securityPool, secondBidder.account.address, [{ tick: secondAuctionTick, bidIndex: secondBidIndex }])

		const firstVault = await getSecurityVault(client, yesSecurityPool.securityPool, firstBidder.account.address)
		const secondVault = await getSecurityVault(client, yesSecurityPool.securityPool, secondBidder.account.address)
		const claimantAllowanceTotal = firstVault.securityBondAllowance + secondVault.securityBondAllowance

		strictEqualTypeSafe(claimantAllowanceTotal, forkDataBeforeClaims.auctionedSecurityBondAllowance, 'split auction claims should assign the full auctioned allowance without losing rounding residue')
	})

	test('cannot deploy security pool with non-binary question', async () => {
		// Create a question with 3 outcomes (not yes/no binary)
		const multiOutcomeQuestionData = {
			title: 'multi outcome test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const multiOutcomes = sortStringArrayByKeccak(['Apple', 'Banana', 'Cherry']) // sorted, but not Yes/No
		await createQuestion(client, multiOutcomeQuestionData, multiOutcomes)
		const multiOutcomeQuestionId = getQuestionId(multiOutcomeQuestionData, multiOutcomes)

		// Attempt to deploy security pool with non-binary question should fail.
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, multiOutcomeQuestionId, securityMultiplier, MAX_RETENTION_RATE), /Question must have exactly 2 outcomes|First outcome must be "Yes"/)
	})

	test('cannot deploy security pool with scalar question', async () => {
		// Create a scalar question (no outcome labels)
		const scalarQuestionData = {
			title: 'scalar test',
			description: '',
			startTime: 0n,
			endTime: questionEndDate,
			numTicks: 100n,
			displayValueMin: 0n,
			displayValueMax: 100n,
			answerUnit: 'dollars',
		}
		const scalarOutcomes: string[] = []
		await createQuestion(client, scalarQuestionData, scalarOutcomes)
		const scalarQuestionId = getQuestionId(scalarQuestionData, scalarOutcomes)

		// Attempt to deploy security pool with scalar question should fail.
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, scalarQuestionId, securityMultiplier, MAX_RETENTION_RATE), /Question must have exactly 2 outcomes|First outcome must be "Yes"/)
	})

	test('cannot deploy security pool with non-existent question', async () => {
		// Use a questionId that has not been created
		const nonExistentQuestionId = 999999999999n

		// Attempt to deploy security pool with non-existent question should fail
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, nonExistentQuestionId, securityMultiplier, MAX_RETENTION_RATE), /Question does not exist/)
	})

	test('can fork security pool using separate initiate and migrate calls with multiple migrations', async () => {
		// Setup: trigger own fork and prepare
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		const zoltarForkThreshold = await getZoltarForkThreshold(client, genesisUniverse)
		const burnAmount = zoltarForkThreshold / 5n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositRep(attackerClient, securityPoolAddresses.securityPool, forkThreshold)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		// Verify the own-game fork left the parent pool fully initialized for migration
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(forkData.repAtFork, repBalanceInGenesisPool - burnAmount, 'rep at fork does not match')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')

		// Step 2: Call migrateRepToZoltar separately for each outcome
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.No])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid])

		// Additional migration should fail (all rep already allocated)
		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /cannot migrate more than internal balance/i)

		// Create child security pools to verify outcomes
		// Create Yes child
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Yes child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'Yes outcome should be set')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'YES security pool should exist')

		// Create No child using attacker client
		await createChildUniverse(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.ForkMigration, 'No child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'No outcome should be set')
		assert.ok(await contractExists(client, noSecurityPool.securityPool), 'NO security pool should exist')

		// Create Invalid child using a third client
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createChildUniverse(thirdClient, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.ForkMigration, 'Invalid child should be in ForkMigration')
		strictEqualTypeSafe(await getQuestionOutcome(client, invalidSecurityPool.securityPool), QuestionOutcome.Invalid, 'Invalid outcome should be set')
		assert.ok(await contractExists(client, invalidSecurityPool.securityPool), 'INVALID security pool should exist')
	})

	test('SecurityPool receive restricts unauthorized senders', async () => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const poolAddress = securityPoolAddresses.securityPool

		// Ensure forker has ETH to send
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 1. Unauthorized sender should revert
		await assert.rejects(client.sendTransaction({ to: poolAddress, value: 1000n }), /Unauthorized ETH sender/)

		// 2. Authorized sender: securityPoolForker
		await mockWindow.impersonateAccount(forkerAddress)
		await sendEthAndWait(forkerAddress, poolAddress, 1000n)
		const balance = await getETHBalance(client, poolAddress)
		strictEqualTypeSafe(balance, 1000n, 'Pool balance after forker send')

		// 3. Set up child pool scenario to test additional senders
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		// Fork and migrate
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		// Get child addresses
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childPoolAddress = childAddresses.securityPool
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure ETH for testing
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 4. Unauthorized to child pool reverts
		await assert.rejects(client.sendTransaction({ to: childPoolAddress, value: 100n }), /Unauthorized ETH sender/)

		// Record initial child balance
		const initialChildBal = await getETHBalance(client, childPoolAddress)

		// 5. Send from forker to child
		await mockWindow.impersonateAccount(forkerAddress)
		await sendEthAndWait(forkerAddress, childPoolAddress, 2000n)
		const afterForkerBal = await getETHBalance(client, childPoolAddress)
		strictEqualTypeSafe(afterForkerBal - initialChildBal, 2000n, 'Child balance increase from forker')

		// 6. Send from truthAuction to child
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, childPoolAddress, 3000n)
		const afterAuctionBal = await getETHBalance(client, childPoolAddress)
		strictEqualTypeSafe(afterAuctionBal - initialChildBal, 5000n, 'Child balance total increase from both')
	})

	test('SecurityPoolForker receive restricts unauthorized senders', async () => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker

		// Setup to create a child pool so truthAuction is registered
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const childAddresses = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const truthAuctionAddress = childAddresses.truthAuction

		// Ensure auction has ETH to send
		await mockWindow.setBalance(truthAuctionAddress, testInternalSenderBalance)

		// 1. Unauthorized sender to forker should revert
		await assert.rejects(client.sendTransaction({ to: forkerAddress, value: 100n }), /Unauthorized ETH sender/)

		// 2. Authorized sender: truthAuction
		const initialForkerBal = await getETHBalance(client, forkerAddress)
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, forkerAddress, 2000n)
		const newForkerBal = await getETHBalance(client, forkerAddress)
		strictEqualTypeSafe(newForkerBal - initialForkerBal, 2000n, 'Forker balance increase from truthAuction')
	})
})
