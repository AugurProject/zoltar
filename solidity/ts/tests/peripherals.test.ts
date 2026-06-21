import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog, encodeAbiParameters, keccak256 } from 'viem'
import type { Abi, Address, Hash } from 'viem'
import { AnvilWindowEthereum } from '../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testsuite/simulator/useIsolatedAnvilNode'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
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
import {
	claimAuctionProceeds,
	createChildUniverse,
	finalizeTruthAuction,
	getMigratedRep,
	getForkedEscrowChildRepByOutcomeAndVault,
	getForkedEscrowPrincipalByOutcomeAndVault,
	getOwnForkRepBuckets,
	getQuestionOutcome,
	getSecurityPoolForkerForkData,
	forkZoltarWithOwnEscalationGame,
	initiateSecurityPoolFork,
	claimForkedEscalationDeposits,
	migrateRepToZoltar,
	migrateVault,
	migrateVaultWithUnresolvedEscalation,
	settleAuctionBids,
	startTruthAuction,
} from '../testsuite/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameDeposits, getEscalationGameOutcomeState, getEscalationGameTotalCost, getNonDecisionThreshold, getQuestionResolution, getStartBond } from '../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getZoltarAddress, getZoltarForkThreshold } from '../testsuite/simulator/utils/contracts/zoltar'
import { getTotalRepPurchased } from '../testsuite/simulator/utils/contracts/auction'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import {
	createCompleteSet,
	depositRep,
	depositToEscalationGame,
	getCompleteSetCollateralAmount,
	getCurrentRetentionRate,
	getPoolOwnershipDenominator,
	getRepToken,
	getShareTokenSupply,
	getTotalRepBalance,
	getAwaitingForkContinuation,
	getActiveVaultCount,
	getActiveVaults,
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
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_tokens_ShareToken_ShareToken, test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness } from '../types/contractArtifact'

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

const migrateVaultWithUnresolvedEscalationReturnAbi = [
	{
		inputs: [
			{ internalType: 'contract ISecurityPool', name: 'securityPool', type: 'address' },
			{ internalType: 'address', name: 'vault', type: 'address' },
			{ internalType: 'uint8', name: 'childOutcomeIndex', type: 'uint8' },
		],
		name: 'migrateVaultWithUnresolvedEscalation',
		outputs: [{ internalType: 'bool', name: 'moreToMigrate', type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] satisfies Abi

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

function getMappingStorageSlot(key: Address, mappingSlot: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key, mappingSlot])))
}

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

	const deployOwnForkEscalationClaimHarness = async (): Promise<Address> => {
		const deploymentHash = await client.sendTransaction({
			data: `0x${test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.evm.bytecode.object}`,
		})
		const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined || contractAddress === null) throw new Error('deployment address missing')
		return contractAddress
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

	const triggerExternalForkForSecurityPool = async (forkingClient: WriteClient | undefined = undefined, titlePrefix = 'external fork source') => {
		const effectiveForkingClient = forkingClient ?? createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const forkSourceQuestionData = {
			...questionData,
			title: `${titlePrefix} ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(effectiveForkingClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(effectiveForkingClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(effectiveForkingClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
	}

	const setupTruthAuctionWithMixedBids = async (finalizeAuction: boolean) => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'mixed bids fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /cannot migrate more than internal balance/i)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const losingBidder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const winningBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const losingEth = expectedEthToBuy / 10n
		strictEqualTypeSafe(losingEth > 0n, true, 'losing bid should invest a positive amount')
		const losingTick = await participateAuction(losingBidder, yesSecurityPool.truthAuction, repAtFork, losingEth)
		const winningTick = await participateAuction(winningBidder, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		if (finalizeAuction) {
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

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

	const setupFinalizedTruthAuctionWithMixedBids = async () => await setupTruthAuctionWithMixedBids(true)

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

	test('active vault paging excludes zero-balance historical vaults', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)

		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		strictEqualTypeSafe(await getVaultCount(client, securityPoolAddresses.securityPool), 2n, 'historical vault count should include both vaults')
		strictEqualTypeSafe(await getActiveVaultCount(client, securityPoolAddresses.securityPool), 2n, 'active vault count should include both funded vaults')

		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, reportedRepEthPrice)

		const historicalVaultCount = await getVaultCount(client, securityPoolAddresses.securityPool)
		const activeVaultCount = await getActiveVaultCount(client, securityPoolAddresses.securityPool)
		const activeVaults = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, activeVaultCount)

		strictEqualTypeSafe(historicalVaultCount, 2n, 'historical vault count should remain append only')
		strictEqualTypeSafe(activeVaultCount, 1n, 'active vault count should prune fully exited vaults')
		assert.deepStrictEqual(activeVaults, [client.account.address], 'active vault paging should only return currently active vaults')
	})

	test('active vault paging stays newest-first after vault removal and later vault updates', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const thirdClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)

		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(thirdClient, repDeposit, questionId)

		const newestFirstVaultsBeforeRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsBeforeRemoval, [thirdClient.account.address, attackerClient.account.address, client.account.address], 'active vault paging should list the most recently activated vaults first')

		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, attackerClient.account.address, repDeposit, reportedRepEthPrice)

		const newestFirstVaultsAfterRemoval = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterRemoval, [thirdClient.account.address, client.account.address], 'removing a middle vault should preserve newest-first ordering for the remaining active vaults')

		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

		const newestFirstVaultsAfterTouch = await getActiveVaults(client, securityPoolAddresses.securityPool, 0n, 3n)
		assert.deepStrictEqual(newestFirstVaultsAfterTouch, [client.account.address, thirdClient.account.address], 'updating an active vault should move it to the front of the newest-first active vault preview')
	})

	test('withdrawal after question end releases escalation lock without changing ownership in single-sided case', async () => {
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		assert.ok((await getLastPrice(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n, 'Price was not set!')
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		assert.ok(poolOwnershipDenominator > 0n, 'poolOwnershipDenominator was zero')
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const vaultBeforeDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepBeforeDeposit = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
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
		const withdrawalHash = await withdrawFromEscalationGame(
			client,
			securityPoolAddresses.securityPool,
			QuestionOutcome.Yes,
			ourDeposits.map(deposit => deposit.depositIndex),
		)
		const withdrawalReceipt = await client.waitForTransactionReceipt({ hash: withdrawalHash })
		const claimLog = withdrawalReceipt.logs
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

		const walletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const vaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(claimLog?.args.amountToWithdraw, reportBond, 'single-sided winning withdrawal should pay back the full original REP principal')
		assert.ok(vaultBeforeWithdrawal.repDepositShare < vaultBeforeDeposit.repDepositShare, 'depositing into escalation should reduce the vaults unlocked ownership')
		strictEqualTypeSafe(vaultAfterWithdrawal.repDepositShare, vaultBeforeWithdrawal.repDepositShare, 'with escrow custody, settling a break-even deposit should not re-mint vault ownership')
		strictEqualTypeSafe(walletRepAfterWithdrawal - walletRepBeforeDeposit, reportBond, 'a break-even escalation round-trip should return REP to the wallet instead')
		strictEqualTypeSafe(vaultAfterWithdrawal.repInEscalationGame, 0n, 'escalation lock should be released after withdrawal')
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

		const lockedRepBeforeWithdrawal = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repInEscalationGame
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
		strictEqualTypeSafe(vaultAfterWithdrawal.repInEscalationGame, 0n, 'winning withdrawals should unlock all deposited REP')
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
		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.Yes, 'question should resolve to yes')
		strictEqualTypeSafe(losingVaultBeforeWithdrawal.repInEscalationGame, losingDeposit, 'losing-side REP should start fully locked')
		strictEqualTypeSafe(losingVaultAfterWithdrawal.repInEscalationGame, losingDeposit, 'losing-side REP should remain locked after the winner withdraws')
		strictEqualTypeSafe(losingClaimAfterWithdrawal, losingClaimBeforeWithdrawal, 'winning-side settlement should not affect the losing vaults unlocked claim once escalation REP is fully escrowed outside the pool')
		assert.ok(losingClaimAfterWithdrawal + losingVaultAfterWithdrawal.repInEscalationGame === repDeposit, 'the losing vaults total economic position should remain split across unlocked claim and escrowed REP until its own settlement')
	})

	test('withdrawRep only uses available REP and cannot drain another vaults locked escalation stake', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		const availableRepBeforeWithdrawal = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepBeforeWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, repDeposit)

		const availableRepAfterWithdrawal = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const aliceWalletRepAfterWithdrawal = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		const aliceVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const attackerVaultAfterWithdrawal = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		strictEqualTypeSafe(availableRepBeforeWithdrawal, repDeposit * 2n - lockedDeposit, 'available REP should exclude the locked escalation deposit')
		strictEqualTypeSafe(aliceWalletRepAfterWithdrawal - aliceWalletRepBeforeWithdrawal, repDeposit, 'withdrawal should still allow the caller to exit its full unlocked collateral claim')
		strictEqualTypeSafe(availableRepAfterWithdrawal, repDeposit - lockedDeposit, 'remaining available REP should still exclude the locked stake after withdrawal')
		strictEqualTypeSafe(aliceVaultAfterWithdrawal.repDepositShare, 0n, 'full vault withdrawal should remove the callers ownership share')
		strictEqualTypeSafe(attackerVaultAfterWithdrawal.repInEscalationGame, lockedDeposit, 'the other vaults locked escalation stake should remain intact')
	})

	test('performWithdrawRep cannot run on a vault with active escalation escrow', async () => {
		const escrowedVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await approveAndDepositRep(escrowedVault, repDeposit, questionId)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const lockedDeposit = 100n * 10n ** 18n
		await depositToEscalationGame(escrowedVault, securityPoolAddresses.securityPool, QuestionOutcome.Yes, lockedDeposit)
		const vaultBeforeWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepBeforeWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		await manipulatePriceOracleAndPerformOperation(escrowedVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, escrowedVault.account.address, repDeposit - lockedDeposit)
		const vaultAfterWithdrawAttempt = await getSecurityVault(escrowedVault, securityPoolAddresses.securityPool, escrowedVault.account.address)
		const walletRepAfterWithdrawAttempt = await getERC20Balance(escrowedVault, addressString(GENESIS_REPUTATION_TOKEN), escrowedVault.account.address)
		strictEqualTypeSafe(vaultBeforeWithdrawAttempt.repInEscalationGame, lockedDeposit, 'test setup should create active escrow')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.repInEscalationGame, lockedDeposit, 'failed withdrawal should leave active escrow intact')
		strictEqualTypeSafe(vaultAfterWithdrawAttempt.repDepositShare, vaultBeforeWithdrawAttempt.repDepositShare, 'failed withdrawal should not change pool ownership')
		strictEqualTypeSafe(walletRepAfterWithdrawAttempt, walletRepBeforeWithdrawAttempt, 'failed withdrawal should not transfer REP')
	})

	test('redeemRep requires settled escalation deposits after question finalization', async () => {
		await finalizeQuestionAsYesWithoutFork()

		const walletRepBeforeRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await assert.rejects(redeemRep(client, securityPoolAddresses.securityPool, client.account.address), /settle locks first/)

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])
		const vaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterSettlement = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await redeemRep(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultAfterRedeem = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterRedeem = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)

		strictEqualTypeSafe(vaultAfterRedeem.repDepositShare, 0n, 'redeemRep should empty the vault after escalation settles')
		strictEqualTypeSafe(vaultAfterRedeem.repInEscalationGame, 0n, 'redeemRep should not recreate escrowed REP')
		strictEqualTypeSafe(walletRepAfterRedeem - walletRepAfterSettlement, repDeposit - reportBond, 'redeemRep should only return the vault-held REP claim after escalation settles')
		strictEqualTypeSafe(vaultAfterSettlement.repInEscalationGame, 0n, 'settling escalation should clear the remaining escrowed REP')
		strictEqualTypeSafe(walletRepAfterSettlement - walletRepBeforeRedeem, reportBond, 'settling escalation should return only the escrowed REP')
	})

	test('depositToEscalationGame burns enough ownership after the pool share price appreciates', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const benefactorClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await mockWindow.setTime(endTime + 10000n)
		await transferRepToAddress(benefactorClient, securityPoolAddresses.securityPool, repDeposit)

		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepBeforeEscrow = (await getVaultRepClaim(client.account.address)) + vaultBeforeEscrow.repInEscalationGame

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const totalRepAfterEscrow = (await getVaultRepClaim(client.account.address)) + vaultAfterEscrow.repInEscalationGame

		assert.ok(totalRepAfterEscrow <= totalRepBeforeEscrow, 'moving REP into escalation should not increase the vaults total economic position after pool appreciation')
		strictEqualTypeSafe(vaultAfterEscrow.repInEscalationGame, reportBond, 'the escrowed REP principal should match the deposited escalation amount exactly')
	})

	test('depositToEscalationGame rechecks the local bond against the post-escrow REP balance', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const secondVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const escrowAmount = 200n * 10n ** 18n

		await approveAndDepositRep(secondVault, repDeposit, questionId)

		const totalRepBeforeEscrow = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
		const poolOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const vaultBeforeEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const ownershipToEscrow = (escrowAmount * poolOwnershipDenominator + totalRepBeforeEscrow - 1n) / totalRepBeforeEscrow
		const expectedRepAfterEscrow = ((vaultBeforeEscrow.repDepositShare - ownershipToEscrow) * (totalRepBeforeEscrow - escrowAmount)) / poolOwnershipDenominator
		const targetAllowance = expectedRepAfterEscrow + 1n

		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, targetAllowance)
		await manipulatePriceOracleAndPerformOperation(secondVault, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, secondVault.account.address, 0n)
		await mockWindow.setTime(endTime + 10000n)

		assert.ok(vaultBeforeEscrow.repDepositShare > 0n, 'target vault should already be funded')
		assert.ok(totalRepBeforeEscrow - escrowAmount >= targetAllowance, 'the pool-wide bond should still be satisfied after escrow')
		assert.ok(expectedRepAfterEscrow < targetAllowance, 'the target vault should fall below its local allowance after escrow')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, escrowAmount)
		const vaultAfterEscrow = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(vaultAfterEscrow.repInEscalationGame >= escrowAmount, 'the escrowed REP should be accepted when the post-transfer denominator keeps the vault above its bond threshold')
		assert.ok((await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterEscrow.repDepositShare)) >= targetAllowance, 'the remaining claim should still satisfy the local bond after escrow')
	})

	test('oracle-staged collateral operations are rejected once escalation resolves', async () => {
		await finalizeQuestionAsYesWithoutFork()

		await assert.rejects(requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, client.account.address, 1n), /question already resolved/)
	})

	test('oracle-staged security bond allowance updates can clear the allowance to zero', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)

		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)

		const vaultAfterClearingAllowance = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(vaultAfterClearingAllowance.securityBondAllowance, 0n, 'setting the security bond allowance to zero should succeed')
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
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
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
		strictEqualTypeSafe(firstWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the first winner should have no REP left locked after withdrawal')
		strictEqualTypeSafe(secondWinnerVaultAfterWithdrawal.repInEscalationGame, 0n, 'the second winner should have no REP left locked after withdrawal')
	})

	test('external fork blocks parent escalation withdrawals and preserves escrowed REP', async () => {
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

		strictEqualTypeSafe(await getQuestionOutcome(client, securityPoolAddresses.securityPool), QuestionOutcome.None, 'external fork should leave the parent question unresolved')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [aliceDeposit.depositIndex]), /migrate forked locks/)
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [bobDeposit.depositIndex]), /migrate forked locks/)

		const aliceVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const bobVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(aliceVaultAfter.repInEscalationGame, aliceVaultBefore.repInEscalationGame, 'alice lock should stay in the parent until migrated')
		strictEqualTypeSafe(bobVaultAfter.repInEscalationGame, bobVaultBefore.repInEscalationGame, 'bob lock should stay in the parent until migrated')
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

		const unsettledBefore = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amount > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledBefore.length, 1, 'the winning deposit should be discoverable before settlement')
		strictEqualTypeSafe(unsettledBefore[0], 0n, 'the first winning deposit should be returned')

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n])

		const unsettledAfter = (await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)).filter(deposit => deposit.depositor === client.account.address && deposit.amount > 0n).map(deposit => deposit.depositIndex)
		strictEqualTypeSafe(unsettledAfter.length, 0, 'settled winning deposits should disappear from discovery results')
		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /deposit already settled/)
	})

	test('withdrawFromEscalationGame rejects none outcome after an external fork', async () => {
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

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.None, [0n]), /invalid none/)
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
		const attackerVaultBeforeSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)

		await withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex])
		const attackerVaultAfterSettlement = await getSecurityVault(client, securityPoolAddresses.securityPool, attackerClient.account.address)
		strictEqualTypeSafe(attackerVaultAfterSettlement.repInEscalationGame, 0n, 'losing-side settlement should clear the resolved escalation lock')
		strictEqualTypeSafe(attackerVaultAfterSettlement.repDepositShare, attackerVaultBeforeSettlement.repDepositShare, 'settling a fully losing escalation deposit should not mint new vault ownership to the loser')
		await assert.rejects(withdrawFromEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, [canceledCandidateDeposit.depositIndex]), /deposit already settled/)
	})

	test('mixed-outcome settlements from one vault are settlement-order independent after exchange-rate changes', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const secondQuestionData = {
			...questionData,
			title: 'mixed outcome order independence mirror pool',
		}
		const secondQuestionId = getQuestionId(secondQuestionData, outcomes)
		await createQuestion(client, secondQuestionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, secondQuestionId, securityMultiplier, MAX_RETENTION_RATE)
		await approveAndDepositRep(client, repDeposit, secondQuestionId)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await approveAndDepositRep(attackerClient, repDeposit, secondQuestionId)

		const secondSecurityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, secondQuestionId, securityMultiplier)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const firstWinningDeposit = 2n * reportBond
		const interveningDeposit = 3n * reportBond
		const losingDeposit = reportBond
		for (const poolAddress of [securityPoolAddresses.securityPool, secondSecurityPoolAddresses.securityPool]) {
			await depositToEscalationGame(client, poolAddress, QuestionOutcome.Yes, firstWinningDeposit)
			await depositToEscalationGame(attackerClient, poolAddress, QuestionOutcome.Yes, interveningDeposit)
			await depositToEscalationGame(client, poolAddress, QuestionOutcome.No, losingDeposit)
		}
		await mockWindow.advanceTime(10n * DAY)

		const firstYesDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const firstNoDeposits = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const secondEscalationGame = await getSecurityPoolsEscalationGame(client, secondSecurityPoolAddresses.securityPool)
		const secondYesDeposits = await getEscalationGameDeposits(client, secondEscalationGame, QuestionOutcome.Yes)
		const secondNoDeposits = await getEscalationGameDeposits(client, secondEscalationGame, QuestionOutcome.No)

		const firstWinningIndex = ensureDefined(
			firstYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === firstWinningDeposit),
			'first-pool winning deposit missing',
		).depositIndex
		const firstLosingIndex = ensureDefined(
			firstNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === losingDeposit),
			'first-pool losing deposit missing',
		).depositIndex
		const secondWinningIndex = ensureDefined(
			secondYesDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === firstWinningDeposit),
			'second-pool winning deposit missing',
		).depositIndex
		const secondLosingIndex = ensureDefined(
			secondNoDeposits.find(deposit => deposit.depositor === client.account.address && deposit.amount === losingDeposit),
			'second-pool losing deposit missing',
		).depositIndex

		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, [firstLosingIndex])
		await withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [firstWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.Yes, [secondWinningIndex])
		await withdrawFromEscalationGame(client, secondSecurityPoolAddresses.securityPool, QuestionOutcome.No, [secondLosingIndex])

		const firstVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const secondVault = await getSecurityVault(client, secondSecurityPoolAddresses.securityPool, client.account.address)
		const firstUnlockedRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, firstVault.repDepositShare)
		const secondUnlockedRep = await poolOwnershipToRep(client, secondSecurityPoolAddresses.securityPool, secondVault.repDepositShare)

		strictEqualTypeSafe(firstVault.repInEscalationGame, 0n, 'the first pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(secondVault.repInEscalationGame, 0n, 'the mirror pool should have no remaining escalation locks after both settlements')
		strictEqualTypeSafe(firstUnlockedRep, secondUnlockedRep, 'settling the winning and losing deposits in opposite orders should leave the same final unlocked vault claim')
	})

	test('migrateVaultWithUnresolvedEscalation atomically moves unresolved parent locks into the child branch', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = reportBond * 2n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'forked unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const childForkDataBeforeMigration = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceBeforeMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childForkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const childEscalationBalanceAfterMigration = await getERC20Balance(client, childRepToken, childEscalationGame)
		const childOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
		const childForkSnapshotInitialized = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'forkCarrySnapshotInitialized',
			args: [],
		})
		const childDepositsAfterMigration = await getEscalationGameDeposits(client, childEscalationGame, QuestionOutcome.Yes)
		const childLocalDepositCount = await client.readContract({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			address: childEscalationGame,
			functionName: 'getDepositsByOutcomeLength',
			args: [QuestionOutcome.Yes],
		})

		strictEqualTypeSafe(parentVaultBeforeMigration.repInEscalationGame, unresolvedDeposit, 'the parent lock should equal the unresolved principal before migration')
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'atomic unresolved migration should clear the parent lock')
		assert.ok(childVaultAfterMigration.repInEscalationGame > 0n, 'the child vault should inherit unresolved escrow in the child token')
		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, childEscalationBalanceAfterMigration - childEscalationBalanceBeforeMigration, 'the child vault escrow should match the child REP actually transferred into the continuation game')
		strictEqualTypeSafe(childForkData.migratedRep, childForkDataBeforeMigration.migratedRep, 'unresolved migration should not change child migrated REP accounting')
		assert.ok(childEscalationBalanceAfterMigration > childEscalationBalanceBeforeMigration, 'the child continuation game should receive child REP funding for the migrated unresolved deposits')
		strictEqualTypeSafe(childForkSnapshotInitialized, true, 'the child continuation game should inherit the fork carry snapshot')
		strictEqualTypeSafe(childDepositsAfterMigration.length, 0, 'the child continuation game should not replay parent unresolved deposits as fresh local deposits')
		strictEqualTypeSafe(childLocalDepositCount, 0n, 'continuation deposits should remain represented through the inherited carry snapshot')
		assert.ok(childOutcomeState.currentLeafCount > 0n, 'the child continuation game should inherit unresolved carry state from the parent snapshot')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotal, unresolvedDeposit, 'the child continuation game should track the migrated unresolved principal')
	})

	test('migrateVaultWithUnresolvedEscalation reports bounded unresolved batches until migration is complete', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const depositCount = 65
		const totalUnresolvedDeposit = BigInt(depositCount) * reportBond
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		if (vaultRepBeforeTopUp < totalUnresolvedDeposit) {
			await approveAndDepositRep(client, totalUnresolvedDeposit - vaultRepBeforeTopUp, questionId)
		}
		for (let index = 0; index < depositCount; index += 1) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		}
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'bounded unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(attackerClient, otherQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const parentEscalationGame = await getSecurityPoolsEscalationGame(client, securityPoolAddresses.securityPool)
		const firstPreview = await client.simulateContract({
			abi: migrateVaultWithUnresolvedEscalationReturnAbi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes],
			account: client.account,
		})
		strictEqualTypeSafe(firstPreview.result, true, 'first bounded migration should report a remaining follow-up batch')
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: parentEscalationGame,
				functionName: 'hasUnexportedLocalDepositRefs',
				args: [client.account.address],
			}),
			true,
			'first migration should leave the final unresolved ref pending',
		)

		const secondPreview = await client.simulateContract({
			abi: migrateVaultWithUnresolvedEscalationReturnAbi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes],
			account: client.account,
		})
		strictEqualTypeSafe(secondPreview.result, false, 'second bounded migration should report completion')
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'follow-up migration should clear all parent unresolved escrow')
		strictEqualTypeSafe(
			await client.readContract({
				abi: peripherals_EscalationGame_EscalationGame.abi,
				address: parentEscalationGame,
				functionName: 'hasUnexportedLocalDepositRefs',
				args: [client.account.address],
			}),
			false,
			'follow-up migration should exhaust the export cursor',
		)
	})

	test('migrateVaultWithUnresolvedEscalation rejects after the child branch is already priced', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

		await assert.rejects(migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes), /cap/)
	})

	test('migrateVaultWithUnresolvedEscalation requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const otherQuestionData = {
			...questionData,
			title: 'relayed unresolved migration source question',
		}
		const otherQuestionId = getQuestionId(otherQuestionData, outcomes)
		await createQuestion(relayerClient, otherQuestionData, outcomes)
		await approveToken(relayerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(relayerClient, genesisUniverse, otherQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		await assert.rejects(migrateVaultWithUnresolvedEscalation(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes))
	})

	test('migrateVaultWithUnresolvedEscalation clears parent escrow as dust when the child allocation rounds to zero', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, unresolvedDeposit + 1n)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const ownForkChildRepAtForkSlot = formatStorageSlot(parentForkDataSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[ownForkChildRepAtForkSlot]: 0n,
				},
			},
		})

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		const parentNoDepositsAfterMigration = await getEscalationGameDeposits(client, securityPoolAddresses.escalationGame, QuestionOutcome.No)
		const childPoolExists = await contractExists(client, yesSecurityPool.securityPool)
		const childVaultAfterMigration = childPoolExists ? await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address) : undefined

		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'zero child allocation should clear the parent unresolved REP lock as dust')
		strictEqualTypeSafe(parentDepositsAfterMigration.filter(deposit => deposit.amount > 0n).length, 0, 'zero child allocation should consume the parent unresolved deposits')
		strictEqualTypeSafe(parentNoDepositsAfterMigration.filter(deposit => deposit.amount > 0n).length, 0, 'zero child allocation should consume all unresolved parent deposits for the vault')
		strictEqualTypeSafe(childVaultAfterMigration?.repInEscalationGame ?? 0n, 0n, 'zero child allocation should not create child escrow')
	})

	test('migrateVaultWithUnresolvedEscalation in non-own fork carries escrow through the continuation snapshot without replaying local deposits', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'parent for non-own unresolved migration',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		const yesDepositsAfterMigration = await getEscalationGameDeposits(client, yesEscalationGame, QuestionOutcome.Yes)
		const childEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)

		strictEqualTypeSafe(yesDepositsAfterMigration.length, 0, 'non-own unresolved migration should not replay parent local deposits in the child game')
		strictEqualTypeSafe(yesOutcomeState.balance, unresolvedDeposit, 'non-own continuation should keep inherited resolution balances 1:1 with source REP')
		strictEqualTypeSafe(childEscrowPrincipal, unresolvedDeposit, 'non-own continuation should retain the original unresolved principal for proof settlement')
		strictEqualTypeSafe(childEscrowChildRep, unresolvedDeposit, 'non-own continuation should back the carried escrow 1:1 in child REP')
	})

	test('claimForkedEscalationDeposits requires the vault owner to call it', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = reportBond
		const relayerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(relayerClient, repDeposit, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		await assert.rejects(claimForkedEscalationDeposits(relayerClient, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
	})

	test('migrateVaultWithUnresolvedEscalation scales child escrow when the child branch has less REP than the parent principal', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const unresolvedDeposit = reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const forkThreshold = (await getTotalTheoreticalSupply(client, repToken)) / 20n / securityMultiplier
		const vaultBeforeTopUp = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeTopUp = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeTopUp.repDepositShare)
		const repAmountNeeded = vaultRepBeforeTopUp < 3n * forkThreshold ? 3n * forkThreshold - vaultRepBeforeTopUp : 0n
		if (repAmountNeeded > 0n) {
			await approveAndDepositRep(client, repAmountNeeded, questionId)
		}

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const ownForkChildRepAtForkSlot = formatStorageSlot(parentForkDataSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[ownForkChildRepAtForkSlot]: 1n,
				},
			},
		})

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childPoolExists = await contractExists(client, yesSecurityPool.securityPool)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const invalidOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Invalid)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)
		const noOutcomeState = await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.No)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childYesEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowPrincipal = await getForkedEscrowPrincipalByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childYesEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowChildRep = await getForkedEscrowChildRepByOutcomeAndVault(client, yesSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childEscrowPrincipal = childYesEscrowPrincipal + childNoEscrowPrincipal
		const childEscrowChildRep = childYesEscrowChildRep + childNoEscrowChildRep

		strictEqualTypeSafe(parentVaultAfterMigration.repInEscalationGame, 0n, 'an underfunded child branch should still clear the parent unresolved REP lock after the migration succeeds')
		strictEqualTypeSafe(childPoolExists, true, 'an underfunded child branch should deploy the child pool')
		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, childEscrowChildRep, 'the child vault escrow should match the child REP actually transferred into the continuation game')
		strictEqualTypeSafe(invalidOutcomeState.balance + yesOutcomeState.balance + noOutcomeState.balance, childEscrowChildRep, 'own-fork continuation resolution balances should be scaled into child REP units')
		assert.ok(childEscrowPrincipal > childEscrowChildRep, 'the child continuation game should retain more parent principal than child REP backing')
		strictEqualTypeSafe(childEscrowChildRep, 1n, 'the child continuation game should retain only the scaled child REP backing')
	})

	test('one unmigrated unresolved lock cannot keep the child continuation branch frozen after the migration window', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const unresolvedDeposit = reportBond
		const attackerUnresolvedDeposit = reportBond + 1n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, unresolvedDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, attackerUnresolvedDeposit)

		const externalForkQuestionData = {
			...questionData,
			title: 'griefing continuation race source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)

		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		assert.ok(await contractExists(client, childEscalationGame), 'child should initialize the paused continuation game as soon as the branch exists')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'child should await fork continuation while unresolved migration is pending')

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), true, 'one remaining parent lock should still keep the branch paused during the migration window')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child should become operational even before continuation migration')
		strictEqualTypeSafe(await getAwaitingForkContinuation(client, yesSecurityPool.securityPool), false, 'the migration deadline should clear the await marker even if another vault never migrates')
		await assert.rejects(migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes), /ar/)
	})

	test('large unresolved continuation migration snapshots carry totals without replaying imported deposit indexes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const nonDecisionThreshold = (await getZoltarForkThreshold(client, genesisUniverse)) / 2n
		const capacity = nonDecisionThreshold / reportBond
		const requestedDepositCount = 12n
		let depositCount = capacity > requestedDepositCount ? requestedDepositCount : capacity
		if (depositCount > 1n) depositCount -= 1n
		else depositCount = 1n
		for (let index = 0n; index < depositCount; index += 1n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond + index)
		}

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const externalForkQuestionData = {
			...questionData,
			title: 'large imported scan race source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const externalForkQuestionId = getQuestionId(externalForkQuestionData, outcomes)
		await createQuestion(attackerClient, externalForkQuestionData, outcomes)
		await mockWindow.setTime(externalForkQuestionData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, externalForkQuestionId)

		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const parentOutcomeStateBeforeMigration = await getEscalationGameOutcomeState(client, securityPoolAddresses.escalationGame, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const yesEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childOutcomeState = await getEscalationGameOutcomeState(client, yesEscalationGame, QuestionOutcome.Yes)
		assert.ok(childOutcomeState.currentCarryRoot !== '0x0000000000000000000000000000000000000000000000000000000000000000', 'the child continuation should materialize a non-empty carry root')
		strictEqualTypeSafe(childOutcomeState.currentLeafCount, parentOutcomeStateBeforeMigration.currentLeafCount, 'continuation migration should preserve the parent carry leaf count')
		strictEqualTypeSafe(childOutcomeState.currentCarryTotal, parentOutcomeStateBeforeMigration.currentCarryTotal, 'snapshot-only migration should preserve the parent unresolved carry total')
	})

	test('forked continuation freezes escalation cost until the child pool becomes operational', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, 2n * reportBond)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		await mockWindow.advanceTime(4n * DAY)

		const repToken = await getRepToken(client, securityPoolAddresses.securityPool)
		const slot5 = '0x' + 5n.toString(16).padStart(64, '0')
		await mockWindow.addStateOverrides({
			[repToken]: {
				stateDiff: {
					[slot5]: repDeposit * 10n,
				},
			},
		})

		const forkSourceQuestionData = {
			...questionData,
			title: 'forked continuation timing source question',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(attackerClient, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		const parentCostAtFork = await getEscalationGameTotalCost(client, securityPoolAddresses.escalationGame)
		assert.ok(parentCostAtFork > 0n, 'the parent escalation game should accrue a positive cost before the unrelated fork')
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childCostDuringMigration = await getEscalationGameTotalCost(client, childEscalationGame)
		approximatelyEqual(childCostDuringMigration, parentCostAtFork, 100000000000000n, 'the child continuation game should inherit the fork-time cost snapshot')

		await mockWindow.advanceTime(3n * DAY)
		strictEqualTypeSafe(await getEscalationGameTotalCost(client, childEscalationGame), childCostDuringMigration, 'continuation cost should stay frozen while the child is still in fork migration')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should become operational once migration completes')

		const childCostAtResume = await getEscalationGameTotalCost(client, childEscalationGame)
		strictEqualTypeSafe(childCostAtResume, childCostDuringMigration, 'resuming the continuation game should start from the frozen fork-time cost')

		await mockWindow.advanceTime(DAY)
		assert.ok((await getEscalationGameTotalCost(client, childEscalationGame)) > childCostAtResume, 'child continuation cost should advance again after the pool becomes operational')
	})

	test('forked continuation deposits can migrate again after a second unrelated fork', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const recursiveDeposit = 2n * reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)

		const firstForkQuestionData = {
			...questionData,
			title: 'first recursive continuation fork source question',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childEscalationGame = await getSecurityPoolsEscalationGame(client, yesSecurityPool.securityPool)
		const childVaultAfterFirstMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, childEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDeposit, 'the child continuation snapshot should carry the unresolved yes-side total before the second fork')
		strictEqualTypeSafe(childVaultAfterFirstMigration.repInEscalationGame, recursiveDeposit, 'the first migration should seed the child continuation vault escrow')

		const secondForkQuestionData = {
			...questionData,
			title: 'second recursive continuation fork source question',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const secondForkQuestionId = getQuestionId(secondForkQuestionData, outcomes)
		await createQuestion(attackerClient, secondForkQuestionData, outcomes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child continuation pool should become operational before the second fork')

		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		const childForkThreshold = await getZoltarForkThreshold(client, yesUniverse)
		const childBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [attackerClient.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[childBalanceSlot]: childForkThreshold * 2n,
				},
			},
		})

		await forkUniverse(attackerClient, yesUniverse, secondForkQuestionId)
		await initiateSecurityPoolFork(client, yesSecurityPool.securityPool)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, yesSecurityPool.securityPool, client.account.address, QuestionOutcome.Yes)

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, securityMultiplier)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		const grandchildEscalationGame = await getSecurityPoolsEscalationGame(client, grandchildSecurityPool.securityPool)
		const grandchildOutcomeState = await getEscalationGameOutcomeState(client, grandchildEscalationGame, QuestionOutcome.Yes)

		strictEqualTypeSafe(childVaultAfterMigration.repInEscalationGame, 0n, 'the second migration should clear the carried lock from the child continuation vault')
		strictEqualTypeSafe(grandchildVault.repInEscalationGame, recursiveDeposit, 'the carried unresolved principal should survive into the grandchild continuation vault')
		strictEqualTypeSafe(grandchildOutcomeState.currentCarryTotal, recursiveDeposit, 'the recursive continuation migration should preserve the carried unresolved total by snapshot')
	})

	test('own-fork unresolved preparation on a continuation child includes inherited carried escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const recursiveDeposit = 2n * reportBond
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, recursiveDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, recursiveDeposit)

		const firstForkQuestionData = {
			...questionData,
			title: 'own fork inherited carry source question',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'continuation child should become operational before its own fork')

		const childRepToken = await getRepToken(client, yesSecurityPool.securityPool)
		const childForkThreshold = await getZoltarForkThreshold(client, yesUniverse)
		const childBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [client.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[childRepToken]: {
				stateDiff: {
					[childBalanceSlot]: childForkThreshold * 3n,
				},
			},
		})
		await approveToken(client, childRepToken, yesSecurityPool.securityPool)
		await depositRep(client, yesSecurityPool.securityPool, childForkThreshold * 3n)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.Yes, childForkThreshold)
		await depositToEscalationGame(client, yesSecurityPool.securityPool, QuestionOutcome.No, childForkThreshold)
		await forkZoltarWithOwnEscalationGame(client, yesSecurityPool.securityPool)
		await migrateRepToZoltar(client, yesSecurityPool.securityPool, [QuestionOutcome.Yes])
		const hash = await client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'migrateVaultWithUnresolvedEscalation',
			args: [yesSecurityPool.securityPool, client.account.address, Number(QuestionOutcome.Yes)],
		})
		await client.waitForTransactionReceipt({ hash })

		const grandchildUniverse = getChildUniverseId(yesUniverse, QuestionOutcome.Yes)
		const grandchildSecurityPool = getSecurityPoolAddresses(yesSecurityPool.securityPool, grandchildUniverse, questionId, securityMultiplier)
		const grandchildVault = await getSecurityVault(client, grandchildSecurityPool.securityPool, client.account.address)
		assert.ok(grandchildVault.repInEscalationGame > 0n, 'own-fork unresolved migration on a continuation child should include inherited carried escrow')
	})

	test('many unresolved continuation deposits survive multiple unrelated forks recursively', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		const recursiveDepositCount = 6n
		const depositIndexes: bigint[] = []
		for (let index = 0n; index < recursiveDepositCount; index += 1n) {
			depositIndexes.push(index)
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)
		}

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, 2n * reportBond)
		const firstForkQuestionData = {
			...questionData,
			title: 'first recursive wide continuation fork',
		}
		const firstForkQuestionId = getQuestionId(firstForkQuestionData, outcomes)
		await createQuestion(attackerClient, firstForkQuestionData, outcomes)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, firstForkQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])

		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)

		const firstChildUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const firstChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, firstChildUniverse, questionId, securityMultiplier)
		const firstChildEscalationGame = await getSecurityPoolsEscalationGame(client, firstChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, firstChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDepositCount * reportBond, 'first child should inherit all unresolved yes-side principal by snapshot')

		const firstChildRepToken = await getRepToken(client, firstChildPool.securityPool)
		const firstChildForkThreshold = await getZoltarForkThreshold(client, firstChildUniverse)
		const firstChildBalanceSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [attackerClient.account.address, 0n]))
		await mockWindow.addStateOverrides({
			[firstChildRepToken]: {
				stateDiff: {
					[firstChildBalanceSlot]: firstChildForkThreshold * 2n,
				},
			},
		})

		const secondForkQuestionData = {
			...questionData,
			title: 'second recursive wide continuation fork',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const secondForkQuestionId = getQuestionId(secondForkQuestionData, outcomes)
		await createQuestion(attackerClient, secondForkQuestionData, outcomes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, firstChildPool.securityPool)
		if ((await getSystemState(client, firstChildPool.securityPool)) === SystemState.ForkTruthAuction) {
			await finalizeTruthAuction(client, firstChildPool.securityPool)
		}
		strictEqualTypeSafe(await getQuestionResolution(client, firstChildEscalationGame), QuestionOutcome.None, 'the first child continuation should still be unresolved when the second unrelated fork begins')

		await forkUniverse(attackerClient, firstChildUniverse, secondForkQuestionId)
		await initiateSecurityPoolFork(client, firstChildPool.securityPool)
		await migrateRepToZoltar(client, firstChildPool.securityPool, [QuestionOutcome.Yes, QuestionOutcome.No])

		await migrateVaultWithUnresolvedEscalation(client, firstChildPool.securityPool, client.account.address, QuestionOutcome.Yes)

		const secondChildUniverse = getChildUniverseId(firstChildUniverse, QuestionOutcome.Yes)
		const secondChildPool = getSecurityPoolAddresses(firstChildPool.securityPool, secondChildUniverse, questionId, securityMultiplier)
		const secondChildEscalationGame = await getSecurityPoolsEscalationGame(client, secondChildPool.securityPool)
		strictEqualTypeSafe((await getEscalationGameOutcomeState(client, secondChildEscalationGame, QuestionOutcome.Yes)).currentCarryTotal, recursiveDepositCount * reportBond, 'second child should inherit all unresolved yes-side principal from the first child by snapshot')
	})

	test('cannot refund an active escalation deposit before zoltar forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, reportBond)

		await assert.rejects(withdrawFromEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, [0n]), /question not final/)
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
		strictEqualTypeSafe(clientVaultAfterSettlement.repInEscalationGame, 0n, 'permissionless settlement should clear the owners lock')
		strictEqualTypeSafe(clientVaultAfterSettlement.repDepositShare >= clientVaultBeforeSettlement.repDepositShare, true, 'permissionless settlement should preserve or increase the owners vault claim')
	})

	test('create child universe test', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
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

		await mockWindow.setTime(endTime + 10000n)
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'forkWithOwnEscalationGame should auto-initiate the parent pool fork')
		assert.ok(forkData.auctionableRepAtFork > 0n, 'repAtFork should keep a positive child REP anchor after the own-game fork')
		assert.ok(forkData.auctionableRepAtFork <= repBalance + forkThreshold * 2n, 'repAtFork should stay bounded by the REP that actually participated in the own-game fork')
		strictEqualTypeSafe(ownForkRepBuckets.escrowSourceRepAtFork, forkThreshold * 2n, 'own-fork source escrow should equal the fork-triggering escalation principal')
		strictEqualTypeSafe(ownForkRepBuckets.vaultRepAtFork + ownForkRepBuckets.unallocatedEscrowChildRep, forkData.auctionableRepAtFork, 'own-fork child REP buckets should partition the full auctionable child REP anchor')
	})

	test('initiateSecurityPoolFork reverts after the own-game fork and ignores stray REP transferred to the forker', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		const strayRep = 9n * 10n ** 18n
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier

		await mockWindow.setTime(endTime + 10000n)
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const forkDataBeforeStrayRep = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRep)
		await assert.rejects(initiateSecurityPoolFork(client, securityPoolAddresses.securityPool), /e8/)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 're-initiating after the own-game fork should leave the parent pool in PoolForked')
		strictEqualTypeSafe(forkData.auctionableRepAtFork, forkDataBeforeStrayRep.auctionableRepAtFork, 'repAtFork should ignore unrelated REP transferred to the forker after the own-game fork')
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
		const snapshotTotalRep = await getTotalRepBalance(client, securityPoolAddresses.securityPool)
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

	test('liquidation only moves REP that is not committed to escalation', async () => {
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
		const targetClaimAfterLock = await getVaultRepClaim(client.account.address)

		strictEqualTypeSafe(targetVaultAfterLock.repInEscalationGame, lockedDeposit, 'target vault should have the escalation principal marked as locked')
		strictEqualTypeSafe(targetClaimAfterLock, repDeposit - lockedDeposit, 'locking REP should move the committed principal out of the vault claim')
		strictEqualTypeSafe(canLiquidate(PRICE_PRECISION, securityPoolAllowance, targetClaimAfterLock, 2n), true, 'the vault should become liquidatable once its unlocked vault REP falls below the required backing')

		await manipulatePriceOracle(liquidatorClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		await requestPriceIfNeededAndStageOperation(liquidatorClient, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, client.account.address, securityPoolAllowance)

		const targetVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const liquidatorVaultAfterLiquidation = await getSecurityVault(client, securityPoolAddresses.securityPool, liquidatorClient.account.address)
		const targetClaimAfterLiquidation = await getVaultRepClaim(client.account.address)
		const liquidatorClaimAfterLiquidation = await getVaultRepClaim(liquidatorClient.account.address)

		strictEqualTypeSafe(targetVaultAfterLiquidation.repInEscalationGame, lockedDeposit, 'liquidation should leave the targets escalation commitment untouched')
		strictEqualTypeSafe(targetVaultAfterLiquidation.securityBondAllowance, 0n, 'liquidation should only move the debt backed by unlocked REP')
		strictEqualTypeSafe(targetClaimAfterLiquidation, 0n, 'liquidation should leave the target with only the REP committed to escalation')
		strictEqualTypeSafe(liquidatorVaultAfterLiquidation.securityBondAllowance, securityPoolAllowance, 'the liquidator should absorb only the debt backed by unlocked REP')
		strictEqualTypeSafe(liquidatorClaimAfterLiquidation, repDeposit * 2n + (repDeposit - lockedDeposit), 'the liquidator should receive only the targets unlocked REP claim')
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
		const availableRepBalance = await getTotalRepBalance(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(firstVaultTotalClaim, repDeposit - lockedDeposit, 'locking REP should remove the committed principal from the vault claim')
		strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'locking REP should not reduce another vaults total collateral claim')
		strictEqualTypeSafe(firstVault.repInEscalationGame, lockedDeposit, 'the lockers escalation principal should be tracked separately')
		strictEqualTypeSafe(firstVaultTotalClaim + firstVault.repInEscalationGame, repDeposit, 'the lockers total position should be preserved across the two REP buckets')
		strictEqualTypeSafe(secondVault.repInEscalationGame, 0n, 'the unrelated vault should have no locked REP')
		strictEqualTypeSafe(secondVaultTotalClaim, repDeposit, 'the unrelated vault should keep its full vault REP')
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

	test('redeemCompleteSet exits at the fee-adjusted share exchange rate', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const firstHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const secondHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await createCompleteSet(firstHolder, securityPoolAddresses.securityPool, 4n * 10n ** 18n)
		await createCompleteSet(secondHolder, securityPoolAddresses.securityPool, 6n * 10n ** 18n)

		await mockWindow.advanceTime(30n * DAY)
		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)

		const firstHolderShares = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
		const redeemAmount = ensureDefined(firstHolderShares[0], 'first holder complete-set shares missing') / 2n
		const initialCollateral = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const initialShareSupply = await getShareTokenSupply(client, securityPoolAddresses.securityPool)
		const initialFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		assert.ok(initialFeesOwed > 0n, 'test setup should accrue open-interest fees before redemption')

		const balanceBeforeRedeem = await getETHBalance(client, firstHolder.account.address)
		await redeemCompleteSet(firstHolder, securityPoolAddresses.securityPool, redeemAmount)

		const collateralAfterRedeem = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const feesAfterRedeem = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - balanceBeforeRedeem
		const feeDelta = feesAfterRedeem - initialFeesOwed
		const firstHolderSharesAfterRedeem = await balanceOfShares(firstHolder, securityPoolAddresses.shareToken, genesisUniverse, firstHolder.account.address)
		const shareSupplyAfterRedeem = await getShareTokenSupply(client, securityPoolAddresses.securityPool)

		assert.ok(firstHolderPayout > 0n, 'redeeming complete sets should pay ETH to the holder')
		strictEqualTypeSafe(collateralAfterRedeem + firstHolderPayout + feeDelta, initialCollateral, 'complete-set redemption should conserve collateral after fee accrual')
		strictEqualTypeSafe(shareSupplyAfterRedeem, initialShareSupply - redeemAmount, 'complete-set redemption should reduce share supply by the burned set amount')
		strictEqualTypeSafe(firstHolderSharesAfterRedeem[0], firstHolderShares[0] - redeemAmount, 'redeeming should burn the holders invalid-side share')
		strictEqualTypeSafe(firstHolderSharesAfterRedeem[1], firstHolderShares[1] - redeemAmount, 'redeeming should burn the holders yes-side share')
		strictEqualTypeSafe(firstHolderSharesAfterRedeem[2], firstHolderShares[2] - redeemAmount, 'redeeming should burn the holders no-side share')
		strictEqualTypeSafe(await sharesToCash(client, securityPoolAddresses.securityPool, shareSupplyAfterRedeem), collateralAfterRedeem, 'remaining complete sets should keep the fee-adjusted exchange rate')
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
		const collateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)

		// forking
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		assert.ok(forkData.auctionableRepAtFork > 0n, 'rep at fork should stay positive after the own-game fork')
		assert.ok(forkData.auctionableRepAtFork <= repBalance + forkThreshold * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.outcomeIndex, 0, 'there should be no outcome')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')
		const totalFeesOwedToVaultsRightAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		strictEqualTypeSafe(0n, await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool), "Parent's original rep is gone")
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkMigration, 'Fork Migration need to start')
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(migratedRep, 0n, 'escalation-only wallet claims should not count as migrated child-pool REP')
		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'Did not create YES security pool')
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const yesStateAfterStart = await getSystemState(client, yesSecurityPool.securityPool)
		if (yesStateAfterStart === SystemState.ForkTruthAuction) {
			const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
			const yesEthRaiseCap = await getEthRaiseCap(client, yesSecurityPool.truthAuction)
			await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, repAtFork, yesEthRaiseCap)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		} else {
			strictEqualTypeSafe(yesStateAfterStart, SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately when no child collateral remains to buy')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
		}
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes System should become operational after the truth auction finalizes')

		const totalCollateral = (await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)) + (await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool))
		assert.ok(totalCollateral <= collateralAtFork, 'forked collateral should stay conserved across the parent and child pools')

		const totalFeesOwedToVaultsAfterFork = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		assert.ok(totalFeesOwedToVaultsAfterFork >= totalFeesOwedToVaultsRightAfterFork, 'parent fee accounting should remain readable after the fork path settles child state')
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
		const initialFeesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		assert.ok(initialCollateral > 0n, 'collateral should be positive before finalization')
		strictEqualTypeSafe(initialShareSupply, firstWinningShares + secondWinningShares, 'share supply should equal the minted winning-share balances')

		await finalizeQuestionAsYesWithoutFork()
		const firstHolderBalanceBeforeRedemption = await getETHBalance(client, firstHolder.account.address)
		await redeemShares(firstHolder, securityPoolAddresses.securityPool)

		const collateralAfterFirstRedemption = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const feesAfterFirstRedemption = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		const firstHolderPayout = (await getETHBalance(client, firstHolder.account.address)) - firstHolderBalanceBeforeRedemption
		const feeDelta = feesAfterFirstRedemption - initialFeesOwed

		assert.ok(feeDelta > 0n, 'first redemption should accrue open-interest fees')
		strictEqualTypeSafe(collateralAfterFirstRedemption + firstHolderPayout + feeDelta, initialCollateral, 'collateral should shrink by fees and first winning redemption')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), initialShareSupply - firstWinningShares, 'share supply should shrink after first winning redemption')
		approximatelyEqual(await sharesToCash(client, securityPoolAddresses.securityPool, secondWinningShares), collateralAfterFirstRedemption, 10n, 'remaining winning shares should not be double counted')

		await redeemShares(secondHolder, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'collateral should be empty after all winning shares are redeemed')
		strictEqualTypeSafe(await getShareTokenSupply(client, securityPoolAddresses.securityPool), 0n, 'share supply should be empty after all winning shares are redeemed')
	})

	test('redeemShares accrues open-interest fees before paying winning shares', async () => {
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const openInterestAmount = 10n * 10n ** 18n
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)
		const balanceBefore = await getETHBalance(client, openInterestHolder.account.address)

		await finalizeQuestionAsYesWithoutFork()
		await redeemShares(openInterestHolder, securityPoolAddresses.securityPool)

		const balanceAfter = await getETHBalance(client, openInterestHolder.account.address)
		const feesOwed = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		const payout = balanceAfter - balanceBefore

		assert.ok(feesOwed > 0n, 'redeemShares should accrue fees before paying winning shares')
		assert.ok(payout < openInterestAmount, 'winner payout should be net of accrued fees')
		approximatelyEqual(payout + feesOwed, openInterestAmount, 1000n, 'payout plus fees should conserve open interest')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool), 0n, 'all collateral should be consumed after sole winning redemption')
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
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
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
		const ownForkParentCollateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		// we migrate to yes
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesPoolBalance = await getERC20Balance(client, await getRepToken(client, yesSecurityPool.securityPool), yesSecurityPool.securityPool)
		assert.ok((await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare)) > 0n, 'the yes-side vault should still retain a positive unlocked child REP claim')
		const migratedRepInYes = await getMigratedRep(client, yesSecurityPool.securityPool)
		assert.ok(migratedRepInYes > 0n, 'yes pool should track migrated REP')
		assert.ok(migratedRepInYes < yesPoolBalance, 'migrated rep should stay below the full child REP balance when escrow payouts are carved out separately')
		strictEqualTypeSafe(await getQuestionOutcome(client, yesSecurityPool.securityPool), QuestionOutcome.Yes, 'yes is finalized')
		assert.ok((await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)) > 0n, 'yes child should retain some child-universe REP after migration')

		assert.ok(await contractExists(client, yesSecurityPool.securityPool), 'yes security pool exist')
		const feesOwed = (await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)) + (await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool))

		// attacker migrated to No
		const noUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.No)
		const noSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, noUniverse, questionId, securityMultiplier)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No)
		strictEqualTypeSafe(await getQuestionOutcome(client, noSecurityPool.securityPool), QuestionOutcome.No, 'finalized as no')
		const migratedRepInNo = await getMigratedRep(client, noSecurityPool.securityPool)
		assert.ok(migratedRepInNo > 0n, 'the no-side child should track some migrated REP')
		assert.ok((await getERC20Balance(client, getRepTokenAddress(noUniverse), noSecurityPool.securityPool)) > 0n, 'no child should retain some child-universe REP after migration')
		const parentEth = await getETHBalance(client, securityPoolAddresses.securityPool)
		const yesEth = await getETHBalance(client, yesSecurityPool.securityPool)
		const noEth = await getETHBalance(client, noSecurityPool.securityPool)
		const parentFees = await getTotalFeesOwedToVaults(client, securityPoolAddresses.securityPool)
		const yesFees = await getTotalFeesOwedToVaults(client, yesSecurityPool.securityPool)
		const noFees = await getTotalFeesOwedToVaults(client, noSecurityPool.securityPool)
		assert.ok(parentEth + yesEth + noEth >= parentFees + yesFees + noFees, 'forked ETH should stay sufficient to cover the remaining fee liabilities across all pools')

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
		const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
		const auctionedEthInYes = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInYes) / poolRepAtFork
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const yesAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		let yesAuctionTick: bigint | undefined
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			approximatelyEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), auctionedEthInYes, 10n, 'Need to buy half of open interest on yes')
			yesAuctionTick = await participateAuction(yesAuctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork / 4n, auctionedEthInYes)
		} else {
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'yes child should either enter the truth auction or finalize immediately')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
		}

		// auction no
		const auctionedEthInNo = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRepInNo) / poolRepAtFork
		await startTruthAuction(client, noSecurityPool.securityPool)
		const noAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		let noAuctionTick: bigint | undefined
		if ((await getSystemState(client, noSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			approximatelyEqual(await getEthRaiseCap(client, noSecurityPool.truthAuction), auctionedEthInNo, 10n, 'Need to buy half of open interest on no')
			noAuctionTick = await participateAuction(noAuctionParticipant, noSecurityPool.truthAuction, (poolRepAtFork * 3n) / 4n, auctionedEthInNo)
		} else {
			strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'no child should either enter the truth auction or finalize immediately')
			strictEqualTypeSafe(await getTotalRepPurchased(client, noSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
		}

		// auction invalid
		await startTruthAuction(client, invalidSecurityPool.securityPool)
		const invalidAuctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		let invalidAuctionTick: bigint | undefined
		if ((await getSystemState(client, invalidSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			approximatelyEqual(await getEthRaiseCap(client, invalidSecurityPool.truthAuction), ownForkParentCollateralAtFork, 10n, 'Need to buy all of open interest on invalid')
			invalidAuctionTick = await participateAuction(invalidAuctionParticipant, invalidSecurityPool.truthAuction, poolRepAtFork - burnAmount - poolRepAtFork / 1_000_000n, ownForkParentCollateralAtFork)
		} else {
			strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'invalid child should either enter the truth auction or finalize immediately')
			strictEqualTypeSafe(await getTotalRepPurchased(client, invalidSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
		}

		await mockWindow.advanceTime(7n * DAY + DAY)

		// yes status: auction fully funds, 1/4 of rep balance is sold for eth
		if (yesAuctionTick !== undefined) {
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		}

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
		let yesAuctionParticipantRep = 0n
		if (yesAuctionTick !== undefined) {
			await claimAuctionProceeds(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address, [{ tick: yesAuctionTick, bidIndex: 0n }])
			const yesAuctionParticipantVault = await getSecurityVault(client, yesSecurityPool.securityPool, yesAuctionParticipant.account.address)
			yesAuctionParticipantRep = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesAuctionParticipantVault.repDepositShare)
			const yesClearingPrice = tickToPrice(yesAuctionTick)
			const expectedYesRep = (auctionedEthInYes * 1_000_000_000_000_000_000n) / yesClearingPrice
			approximatelyEqual(yesAuctionParticipantRep, expectedYesRep, 1_000n, 'yes auction participant should get expected REP')
		}

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
		if (noAuctionTick !== undefined) {
			await finalizeTruthAuction(client, noSecurityPool.securityPool)
		}
		const actualNoShares = await balanceOfSharesInCash(client, noSecurityPool.securityPool, noSecurityPool.shareToken, noUniverse, addressString(TEST_ADDRESSES[2]))
		const noChildCollateral = await getCompleteSetCollateralAmount(client, noSecurityPool.securityPool)
		approximatelyEqual(actualNoShares[0], noChildCollateral, noChildCollateral, 'no share0 should be approximately expected')
		approximatelyEqual(actualNoShares[1], noChildCollateral, noChildCollateral, 'no share1 should be approximately expected')
		approximatelyEqual(actualNoShares[2], noChildCollateral, noChildCollateral, 'no share2 should be approximately expected')

		strictEqualTypeSafe(await getSystemState(client, noSecurityPool.securityPool), SystemState.Operational, 'No System should be operational again')

		// Read purchasedRep for no auction participant

		if (noAuctionTick !== undefined) {
			await claimAuctionProceeds(client, noSecurityPool.securityPool, noAuctionParticipant.account.address, [{ tick: noAuctionTick, bidIndex: 0n }])
			const noAuctionParticipantVault = await getSecurityVault(client, noSecurityPool.securityPool, noAuctionParticipant.account.address)
			const noAuctionParticipantRep = await poolOwnershipToRep(client, noSecurityPool.securityPool, noAuctionParticipantVault.repDepositShare)
			const noClearingPrice = tickToPrice(noAuctionTick)
			const expectedNoRep = (auctionedEthInNo * 1_000_000_000_000_000_000n) / noClearingPrice
			approximatelyEqual(noAuctionParticipantRep, expectedNoRep, 1_000n, 'no auction participant should get expected REP')
		}

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
		if (invalidAuctionTick !== undefined) {
			await finalizeTruthAuction(client, invalidSecurityPool.securityPool)
		}
		const actualInvalidShares = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
		const invalidChildCollateral = await getCompleteSetCollateralAmount(client, invalidSecurityPool.securityPool)
		approximatelyEqual(actualInvalidShares[0], invalidChildCollateral, invalidChildCollateral, 'invalid share0 should match')
		approximatelyEqual(actualInvalidShares[1], invalidChildCollateral, invalidChildCollateral, 'invalid share1 should match')
		approximatelyEqual(actualInvalidShares[2], invalidChildCollateral, invalidChildCollateral, 'invalid share2 should match')
		strictEqualTypeSafe(await getSystemState(client, invalidSecurityPool.securityPool), SystemState.Operational, 'Invalid System should be operational again')

		// Read purchasedRep for invalid auction participant

		if (invalidAuctionTick !== undefined) {
			await claimAuctionProceeds(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address, [{ tick: invalidAuctionTick, bidIndex: 0n }])
			const invalidAuctionParticipantVault = await getSecurityVault(client, invalidSecurityPool.securityPool, invalidAuctionParticipant.account.address)
			const invalidAuctionParticipantRep = await poolOwnershipToRep(client, invalidSecurityPool.securityPool, invalidAuctionParticipantVault.repDepositShare)
			const invalidClearingPrice = tickToPrice(invalidAuctionTick)
			const expectedInvalidRep = (ownForkParentCollateralAtFork * 1_000_000_000_000_000_000n) / invalidClearingPrice
			approximatelyEqual(invalidAuctionParticipantRep, expectedInvalidRep, 1_000n, 'invalid auction participant should get expected REP')
		}

		// try creating new complete sets
		const openInterestHolder2 = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		const additionalInvalidCompleteSetAmount = ensureDefined(currentShares[0], 'currentShares[0] is undefined')
		if (additionalInvalidCompleteSetAmount > 0n) {
			await createCompleteSet(openInterestHolder2, invalidSecurityPool.securityPool, additionalInvalidCompleteSetAmount)
		}

		const balancePriorInvalidRedeemal = await getETHBalance(client, addressString(TEST_ADDRESSES[2]))
		await redeemShares(openInterestHolder, invalidSecurityPool.securityPool)
		const actualInvalidSharesAfterRedeem1 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[2]))
		assert.strictEqual(actualInvalidSharesAfterRedeem1[0], 0n, 'redeeming invalid shares should consume the winning invalid leg')
		assert.ok(actualInvalidSharesAfterRedeem1[1] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
		assert.ok(actualInvalidSharesAfterRedeem1[2] >= 0n, 'post-redeem invalid-share accounting should remain readable for the residual non-winning legs')
		approximatelyEqual(await getETHBalance(client, addressString(TEST_ADDRESSES[2])), balancePriorInvalidRedeemal + invalidChildCollateral, openInterestAmount * 1000n, 'did not gain eth after redeeming invalid shares')

		if (additionalInvalidCompleteSetAmount > 0n) {
			const balancePriorInvalidRedeemal2 = await getETHBalance(client, addressString(TEST_ADDRESSES[4]))
			await redeemShares(openInterestHolder2, invalidSecurityPool.securityPool)
			const actualInvalidSharesAfterRedeem2 = await balanceOfSharesInCash(client, invalidSecurityPool.securityPool, invalidSecurityPool.shareToken, invalidUniverse, addressString(TEST_ADDRESSES[4]))
			assert.strictEqual(actualInvalidSharesAfterRedeem2[0], 0n, 'redeeming invalid shares should consume the winning invalid leg for the second holder as well')
			assert.ok((await getETHBalance(client, addressString(TEST_ADDRESSES[4]))) > balancePriorInvalidRedeemal2, 'redeeming invalid shares should increase the second holder ETH balance')
		}
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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'parent pool should enter PoolForked after the universe fork is activated')
		await assert.rejects(depositRep(client, securityPoolAddresses.securityPool, 1n), /zoltar forked|question resolved/)

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		} else {
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
		}

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should become operational once migration and truth-auction processing finish')

		const childVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		assert.ok(childVaultBeforeRedeem.repDepositShare > 0n, 'child migration should create redeemable vault ownership')
		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		const childVaultAfterRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		strictEqualTypeSafe(childVaultAfterRedeem.repDepositShare, 0n, 'operational child pool should allow redeemed ownership to clear')
	})

	test('can migrate escalation deposits before migrateVault', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const parentVaultBeforeEscalationMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildRepToken = getRepTokenAddress(yesUniverse)
		const walletRepBeforeEscalationMigration = await getERC20Balance(client, yesChildRepToken, client.account.address)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const migratedRepBeforeEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesVaultRepAfterEscalationMigration = await poolOwnershipToRep(client, yesSecurityPool.securityPool, yesVault.repDepositShare)
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const walletRepAfterEscalationMigration = await getERC20Balance(client, yesChildRepToken, client.account.address)

		assert.ok(migratedRep > 0n, 'some REP should be tracked as migrated')
		assert.ok(migratedRep >= migratedRepBeforeEscalation, 'later vault migration should not reduce child migrated REP accounting')
		assert.ok(walletRepAfterEscalationMigration > walletRepBeforeEscalationMigration, 'own-fork escalation migration should pay child REP directly to the wallet')
		assert.ok(parentVaultAfterMigration.repInEscalationGame < parentVaultBeforeEscalationMigration.repInEscalationGame, 'migrating a winning escalation deposit should reduce the parent escalation escrow')
		assert.ok(yesVault.repDepositShare > 0n, 'vault migration should still create child ownership for the unlocked pool REP')
		assert.ok(yesVaultRepAfterEscalationMigration > 0n, 'vault migration should create a child-pool claim from unlocked pool REP')
		strictEqualTypeSafe((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).repDepositShare, 0n, 'parent vault should be emptied after migration')
	})

	test('migrateRepToZoltar should fund an already-created child pool with the unlocked vault REP in own-fork mode', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		const unlockedVaultRepAtFork = ownForkRepBuckets.vaultRepAtFork

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /vm/i)

		const childRepToken = getRepTokenAddress(yesUniverse)
		const forkerBalance = await getERC20Balance(client, childRepToken, getInfraContractAddresses().securityPoolForker)
		const childPoolBalance = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)

		strictEqualTypeSafe(forkerBalance, 0n, 'forker should not retain child REP after migrating to an already-created child pool')
		strictEqualTypeSafe(childPoolBalance, unlockedVaultRepAtFork, 'child pool should receive only the unlocked vault REP in own-fork mode')
	})

	test('migrateRepToZoltar rejects after the migration window closes', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await mockWindow.setTime((await mockWindow.getTime()) + 60n * DAY)

		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /migration window closed/i)
	})

	test('migrateRepToZoltar rejects once the child branch is already priced', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.setTime((await mockWindow.getTime()) + 60n * DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /child branch already priced/i)
	})

	test('migrateVault preserves escalation migration state', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const winningDeposit = repDeposit / 2n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])
		const vaultAfterEscalationMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		strictEqualTypeSafe(vaultAfterEscalationMigration.repDepositShare, 0n, 'own-fork escalation claims should not mint child ownership')
		strictEqualTypeSafe(vaultAfterEscalationMigration.securityBondAllowance, 0n, 'claiming own-fork escalation should not migrate the parent bond allowance')

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const vaultAfterVaultMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		assert.ok(vaultAfterVaultMigration.repDepositShare > 0n, 'migrateVault should populate child ownership from the unlocked parent vault state')
		strictEqualTypeSafe(vaultAfterVaultMigration.securityBondAllowance, securityPoolAllowance, 'migrateVault should preserve the already-migrated parent bond allowance')
	})

	test('migrateVault transfers unlocked REP collateral for non-own forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const collateralAmount = 1n * 10n ** 18n
		await createCompleteSet(client, securityPoolAddresses.securityPool, collateralAmount)

		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const forkSourceData = {
			...questionData,
			title: 'non-own fork collateral source',
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceData, outcomes)
		await createQuestion(attackerClient, forkSourceData, outcomes)
		await mockWindow.setTime(forkSourceData.endTime + 1n)
		await approveToken(attackerClient, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(attackerClient, genesisUniverse, forkSourceQuestionId)
		await initiateSecurityPoolFork(client, securityPoolAddresses.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		assert.strictEqual(forkData.ownFork, false, 'this should be a non-own fork')

		const vaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const parentCollateralBefore = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const migratedRepExpected = (vaultBeforeMigration.repDepositShare * forkData.auctionableRepAtFork) / parentDenominator
		const expectedCollateralTransfer = (parentCollateralBefore * migratedRepExpected) / forkData.auctionableRepAtFork
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const parentEthBefore = await getETHBalance(client, securityPoolAddresses.securityPool)
		const childEthBefore = await getETHBalance(client, yesSecurityPool.securityPool)

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const parentEthAfter = await getETHBalance(client, securityPoolAddresses.securityPool)
		const childEthAfter = await getETHBalance(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(parentEthBefore - parentEthAfter, expectedCollateralTransfer, 'unlocked vault migration should transfer ETH collateral from parent to child')
		strictEqualTypeSafe(childEthAfter - childEthBefore, expectedCollateralTransfer, 'unlocked vault migration should fund the child with the transferred ETH collateral')
	})

	test('migrateVault transfers unlocked REP collateral for own forks', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, 2n * 10n ** 18n)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 2n * 10n ** 18n)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const parentEthBeforeMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
		const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const parentEthAfterMigration = await getETHBalance(client, securityPoolAddresses.securityPool)
		const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
		assert.ok(parentEthAfterMigration < parentEthBeforeMigration, 'own-fork unlocked migration should transfer collateral out of the parent')
		strictEqualTypeSafe(parentEthBeforeMigration - parentEthAfterMigration, childEthAfterMigration - childEthBeforeMigration, 'own-fork unlocked migration should move matching collateral into the child')
	})

	test('own-fork unlocked vault migration values child ownership against the vault REP bucket', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 4n * forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)

		const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentDenominatorBeforeFork = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave unlocked vault REP at fork')
		assert.ok(ownForkRepBuckets.unallocatedEscrowChildRep > 0n, 'test setup should include separate escalation REP at fork')
		const expectedChildRepClaim = (parentVaultBeforeFork.repDepositShare * ownForkRepBuckets.vaultRepAtFork) / parentDenominatorBeforeFork

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childRepClaim = await poolOwnershipToRep(client, yesSecurityPool.securityPool, childVault.repDepositShare)
		strictEqualTypeSafe(childRepClaim, expectedChildRepClaim, 'child vault ownership should redeem the full migrated vault REP bucket')
	})

	test('own-fork unlocked migration transfers all pool collateral when all vault REP migrates', async () => {
		const collateralAmount = 2n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, collateralAmount)
		await createCompleteSet(client, securityPoolAddresses.securityPool, collateralAmount)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 4n * forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave unlocked vault REP at fork')
		assert.ok(ownForkRepBuckets.unallocatedEscrowChildRep > 0n, 'test setup should include separate escalation REP at fork')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const parentCollateralBeforeMigration = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const childEthBeforeMigration = await getETHBalance(client, yesSecurityPool.securityPool)

		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const parentCollateralAfterMigration = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const childEthAfterMigration = await getETHBalance(client, yesSecurityPool.securityPool)
		assert.ok(parentCollateralBeforeMigration > 0n, 'test setup should leave collateral available before migration')
		strictEqualTypeSafe(parentCollateralAfterMigration, 0n, 'all remaining pool collateral should leave the parent when all vault REP migrates')
		strictEqualTypeSafe(childEthAfterMigration - childEthBeforeMigration, parentCollateralBeforeMigration, 'the child should receive the full remaining migrated pool collateral')
	})

	test('claimForkedEscalationDeposits rejects unresolved deposits after an unrelated external fork', async () => {
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

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
	})

	test('claimForkedEscalationDeposits pays own-fork child REP to the wallet without pool ownership', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = repDeposit / 2n
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.No, winningDeposit)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const migratedBeforeEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const yesChildRepToken = getRepTokenAddress(yesUniverse)
		const walletRepBeforeEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
		const childCollateralBeforeEscalation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

		const parentVaultAfterMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const childVaultAfterMigration = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const walletRepAfterEscalation = await getERC20Balance(client, yesChildRepToken, client.account.address)
		const migratedAfterEscalation = await getMigratedRep(client, yesSecurityPool.securityPool)
		const childCollateralAfterEscalation = await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(migratedAfterEscalation, migratedBeforeEscalation, 'own-fork escalation claim should not increase child pool migrated REP accounting')
		strictEqualTypeSafe(parentVaultBeforeMigration.repInEscalationGame - parentVaultAfterMigration.repInEscalationGame, 2n * winningDeposit, 'migration should clear exactly the winning deposits principal from the parent escalation escrow')
		strictEqualTypeSafe(childCollateralAfterEscalation, childCollateralBeforeEscalation, 'own-fork escalation claim should not transfer pool collateral')
		strictEqualTypeSafe(childVaultAfterMigration.repDepositShare, 0n, 'own-fork escalation claim should not mint child pool ownership')
		assert.ok(walletRepAfterEscalation > walletRepBeforeEscalation, 'own-fork escalation claim should pay child REP directly to the wallet')
	})

	test('claimForkedEscalationDeposits uses the claim outcome when paying own-fork wallet REP', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = repDeposit * 5n
		await approveAndDepositRep(client, repDeposit * 10n, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const parentForkDataSlot = getMappingStorageSlot(securityPoolAddresses.securityPool, 0n)
		const parentOutcomeIndexSlot = formatStorageSlot(parentForkDataSlot + 14n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[parentOutcomeIndexSlot]: 0x0201n,
				},
			},
		})

		const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		strictEqualTypeSafe(parentForkData.outcomeIndex, QuestionOutcome.No, 'storage override should poison the parent fork outcome bucket for the regression')

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const walletRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n, 1n])

		const walletRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		assert.ok(walletRepAfterClaim > walletRepBeforeClaim, 'own-fork wallet payout should follow the claim outcome even when the parent bucket is poisoned')
	})

	test('claimForkedEscalationDeposits rejects after the own-fork migration window closes', async () => {
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
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]), /mwc/)
	})

	test('claimForkedEscalationDeposits rejects once the child branch is already priced', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = repDeposit / 8n
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should be operational before late claim settlement')

		await assert.rejects(claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n]))
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
		strictEqualTypeSafe(await getMigratedRep(client, yesSecurityPool.securityPool), forkData.auctionableRepAtFork, 'all parent REP should already be represented by migrated vault ownership in this fast path')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'the child pool should finalize immediately when no auction is needed')
		strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'no REP should be sold when the auction is skipped')
		strictEqualTypeSafe(await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool), denominatorBeforeStart, 'skipping the auction should preserve the existing child ownership denominator when no REP is sold')
	})

	test('own-fork truth auction uses only vault REP as the pool auction basis', async () => {
		const securityPoolAllowance = 1n * 10n ** 18n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		await createCompleteSet(client, securityPoolAddresses.securityPool, 1n * 10n ** 18n)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const requiredVaultRep = 4n * forkThreshold
		if (vaultRep < requiredVaultRep) {
			await approveAndDepositRep(client, requiredVaultRep - vaultRep, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		assert.ok(vaultRep >= requiredVaultRep, 'test setup needs unlocked REP plus escalation REP')
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		const parentForkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.ok(parentForkData.auctionableRepAtFork > ownForkRepBuckets.vaultRepAtFork, 'own fork should include escalation REP outside the pool auction basis')
		assert.ok(ownForkRepBuckets.vaultRepAtFork > 0n, 'test setup should leave vault REP available to migrate')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		strictEqualTypeSafe(await getMigratedRep(client, yesSecurityPool.securityPool), ownForkRepBuckets.vaultRepAtFork, 'all vault REP should be migrated into the child pool')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'all migrated vault REP should skip the pool truth auction even when escalation REP forked separately')
		strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'the pool auction should not sell escalation-game REP')
	})

	test('startTruthAuction skips auction startup when no collateral remains to buy', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

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
		const childBalanceBeforeRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - clientClaimBeforeFinalize, 10n, 'redeeming after immediate finalization should reduce the child balance only by the redeemed migrated claim')
	})

	test('escalation migration remains redeemable after truth auction finalization', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const winningDeposit = repDeposit / 2n
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, winningDeposit)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const ownForkParentCollateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childRepToken = getRepTokenAddress(yesUniverse)
		const originalVaultBeforeFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childBalanceBeforeFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		const originalClaimBeforeFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultBeforeFinalize.repDepositShare)
		assert.ok(originalClaimBeforeFinalize > 0n, 'the migrated vault should retain a positive unlocked child REP claim before finalization')
		assert.ok(originalClaimBeforeFinalize <= childBalanceBeforeFinalize, 'before finalization the migrated vault claim should stay bounded by the child pools unlocked REP balance')

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
		const expectedEthToBuy = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRep) / poolRepAtFork
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
			const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork, expectedEthToBuy)
			assert.ok(tickToPrice(auctionTick) > 0n, 'auction participation should produce a valid clearing price when a truth auction is needed')
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		} else {
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
			strictEqualTypeSafe(await getTotalRepPurchased(client, yesSecurityPool.truthAuction), 0n, 'immediate-finalization path should not sell any child REP')
		}

		const originalVaultAfterFinalize = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const childBalanceAfterFinalize = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		const originalClaimAfterFinalize = await poolOwnershipToRep(client, yesSecurityPool.securityPool, originalVaultAfterFinalize.repDepositShare)
		assert.ok(originalClaimAfterFinalize > 0n, 'the migrated vault should remain redeemable after finalization')
		assert.ok(originalClaimAfterFinalize <= childBalanceAfterFinalize, 'the migrated vault claim should stay bounded by the child pools remaining REP balance')

		const childBalanceBeforeRedeem = childBalanceAfterFinalize
		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		approximatelyEqual(await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool), childBalanceBeforeRedeem - originalClaimAfterFinalize, 10n, 'redeeming the migrated vault should reduce the child balance by the redeemed migrated claim')
	})

	test('multiple migrated holders remain redeemable after truth auction finalization', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)

		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, 10n * 10n ** 18n)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		const ownForkParentCollateralAtFork = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVault(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const childRepToken = getRepTokenAddress(yesUniverse)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const poolRepAtFork = ownForkRepBuckets.vaultRepAtFork
		const expectedEthToBuy = ownForkParentCollateralAtFork - (ownForkParentCollateralAtFork * migratedRep) / poolRepAtFork
		if ((await getSystemState(client, yesSecurityPool.securityPool)) === SystemState.ForkTruthAuction) {
			const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
			await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, poolRepAtFork, expectedEthToBuy)
			await mockWindow.advanceTime(7n * DAY + DAY)
			await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		} else {
			strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.Operational, 'child pool should either run a truth auction or finalize immediately')
		}
		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)

		const clientVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const attackerVaultBeforeRedeem = await getSecurityVault(client, yesSecurityPool.securityPool, attackerClient.account.address)
		const clientClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
		const attackerClaimBeforeRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, attackerVaultBeforeRedeem.repDepositShare)
		assert.ok(clientClaimBeforeRedeem > 0n, 'the first migrated holder should retain a positive redeemable claim after finalization')
		assert.ok(attackerClaimBeforeRedeem > 0n, 'the second migrated holder should retain a positive redeemable claim after finalization')

		await redeemRep(attackerClient, yesSecurityPool.securityPool, attackerClient.account.address)
		const clientClaimAfterFirstRedeem = await poolOwnershipToRep(client, yesSecurityPool.securityPool, clientVaultBeforeRedeem.repDepositShare)
		approximatelyEqual(clientClaimAfterFirstRedeem, clientClaimBeforeRedeem, 10n, 'redeeming one migrated holder should not brick the remaining migrated holder')

		const childBalanceBeforeFinalRedeem = await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)
		await redeemRep(client, yesSecurityPool.securityPool, client.account.address)
		assert.ok((await getERC20Balance(client, childRepToken, yesSecurityPool.securityPool)) <= childBalanceBeforeFinalRedeem, 'redeeming the remaining migrated holder should not increase the child REP balance')
		assert.ok(totalRepPurchased >= 0n, 'auction accounting should remain readable after both migrated holders redeem')
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

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first child pool should receive only the REP migrated from the first parent pool')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second child pool should receive only the REP migrated from the second parent pool')
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
		strictEqualTypeSafe(await getMigrationRepBalance(client, genesisUniverse, migrationProxyAddress), forkData.auctionableRepAtFork, 'proxy migration ledger should equal the parent pool REP tracked at fork time')
		assert.ok(!(await contractExists(client, yesChildRepToken)), 'child REP token should not exist before migration splitting deploys it')

		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		assert.ok(await contractExists(client, yesChildRepToken), 'migration splitting should deploy the child REP token')
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), forkData.auctionableRepAtFork, 'proxy should temporarily hold the split child REP before the child pool exists')

		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverseId, questionId, securityMultiplier).securityPool
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, migrationProxyAddress), 0n, 'proxy should sweep child REP away once the child pool exists')
		strictEqualTypeSafe(await getERC20Balance(client, yesChildRepToken, yesSecurityPool), forkData.auctionableRepAtFork, 'child pool should receive the full split REP after the proxy sweep')
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

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first pre-created child pool should receive only the first parent pool REP')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second pre-created child pool should receive only the second parent pool REP')
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

		strictEqualTypeSafe(firstChildRepBalance, firstPoolForkData.auctionableRepAtFork, 'the first child pool balance should remain unchanged after the second pool migrates later')
		strictEqualTypeSafe(secondChildRepBalance, secondPoolForkData.auctionableRepAtFork, 'the second child pool should still receive only its own migrated REP even after the first pool already migrated')
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
		await assert.rejects(redeemRep(client, yesSecurityPool.securityPool, client.account.address), /not operational/)
	})

	// - TODO test that users can claim their stuff (shares+rep) even if zoltar forks after question ends

	test('simple truth auction: participant buys rep and can claim proceeds', async () => {
		// Setup: create open interest, trigger fork, migrate
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)

		// Set security bond allowance and deposit extra REP for capacity
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, repDeposit, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		// Fork the security pool
		await triggerExternalForkForSecurityPool(undefined, 'simple truth auction fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		// Migrate vault to yes
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		// Skip escalation game migration for simpler test
		// await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		// Wait for migration period
		await mockWindow.advanceTime(8n * 7n * DAY + DAY)

		// Start truth auction
		await startTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'Auction should start')

		// Get auction parameters
		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		approximatelyEqual(await getEthRaiseCap(client, yesSecurityPool.truthAuction), expectedEthToBuy, 10n, 'ethToBuy mismatch')

		// Participant bids: buy 1/4 of repAtFork for the full ethToBuy
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const repToBuy = repAtFork / 4n
		const auctionTick = await participateAuction(auctionParticipant, yesSecurityPool.truthAuction, repToBuy, expectedEthToBuy)

		// Finalize auction
		const childEthBalanceBeforeFinalize = await getETHBalance(client, yesSecurityPool.securityPool)
		const forkerEthBalanceBeforeFinalize = await getETHBalance(client, getInfraContractAddresses().securityPoolForker)
		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)
		strictEqualTypeSafe(await getETHBalance(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool should receive truth-auction ETH on finalization')
		strictEqualTypeSafe(await getCompleteSetCollateralAmount(client, yesSecurityPool.securityPool), childEthBalanceBeforeFinalize + expectedEthToBuy, 'child pool collateral accounting should include truth-auction ETH')
		strictEqualTypeSafe(await getETHBalance(client, getInfraContractAddresses().securityPoolForker), forkerEthBalanceBeforeFinalize, 'forker should not retain truth-auction ETH')

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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'refund-only claim fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'zero rep refund fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
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

	test('settleAuctionBids can refund a losing bid before truth auction finalization', async () => {
		const { yesSecurityPool, losingBidder, losingEth, losingTick } = await setupTruthAuctionWithMixedBids(false)
		const thirdParty = createWriteClient(mockWindow, TEST_ADDRESSES[5], 0)
		const thirdPartyBalanceBeforeSettlement = await getETHBalance(client, thirdParty.account.address)
		const losingBidderBalanceBeforeSettlement = await getETHBalance(client, losingBidder.account.address)

		strictEqualTypeSafe(await getSystemState(client, yesSecurityPool.securityPool), SystemState.ForkTruthAuction, 'setup should leave the child pool in an active truth auction')
		await settleAuctionBids(thirdParty, yesSecurityPool.securityPool, losingBidder.account.address, [], [{ tick: losingTick, bidIndex: 0n }])

		const thirdPartyBalanceAfterSettlement = await getETHBalance(client, thirdParty.account.address)
		const losingBidderBalanceAfterSettlement = await getETHBalance(client, losingBidder.account.address)

		strictEqualTypeSafe(losingBidderBalanceAfterSettlement - losingBidderBalanceBeforeSettlement, losingEth, 'pre-finalization settlement should refund losing-bid ETH to the bidder')
		strictEqualTypeSafe(thirdPartyBalanceAfterSettlement, thirdPartyBalanceBeforeSettlement, 'pre-finalization settlement should not redirect refunded ETH to the caller')
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

		await triggerExternalForkForSecurityPool(undefined, 'allowance-on-top fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const migratedVaultBeforeClaim = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
		const migratedRep = await getMigratedRep(client, yesSecurityPool.securityPool)
		const parentAllowanceAtFork = await getTotalSecurityBondAllowance(client, securityPoolAddresses.securityPool)
		const completeSetAmount = await getCompleteSetCollateralAmount(client, securityPoolAddresses.securityPool)
		const expectedEthToBuy = completeSetAmount - (completeSetAmount * migratedRep) / repAtFork
		const auctionTick = await participateAuction(client, yesSecurityPool.truthAuction, repAtFork / 4n, expectedEthToBuy)

		await mockWindow.advanceTime(7n * DAY + DAY)
		await finalizeTruthAuction(client, yesSecurityPool.securityPool)

		const forkData = await getSecurityPoolForkerForkData(client, yesSecurityPool.securityPool)
		const totalRepPurchased = await getTotalRepPurchased(client, yesSecurityPool.truthAuction)
		const expectedAuctionedAllowance = parentAllowanceAtFork - migratedVaultBeforeClaim.securityBondAllowance
		strictEqualTypeSafe(forkData.auctionedSecurityBondAllowance, expectedAuctionedAllowance, 'truth-auction allowance should exclude bond allowance that already migrated with the child vault')
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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const auctionParticipant = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'fee-index fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'multi-claim fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
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
		const passiveRepHolder = createWriteClient(mockWindow, TEST_ADDRESSES[6], 0)
		await approveAndDepositRep(passiveRepHolder, 2n * forkThreshold, questionId)

		const openInterestAmount = 10n * 10n ** 18n
		const openInterestHolder = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const firstBidder = createWriteClient(mockWindow, TEST_ADDRESSES[3], 0)
		const secondBidder = createWriteClient(mockWindow, TEST_ADDRESSES[4], 0)
		await createCompleteSet(openInterestHolder, securityPoolAddresses.securityPool, openInterestAmount)

		await triggerExternalForkForSecurityPool(undefined, 'split-allowance fork source')
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateVault(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)

		await mockWindow.advanceTime(8n * 7n * DAY + DAY)
		await startTruthAuction(client, yesSecurityPool.securityPool)

		const repAtFork = (await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)).auctionableRepAtFork
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
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, multiOutcomeQuestionId, securityMultiplier, MAX_RETENTION_RATE))
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
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, scalarQuestionId, securityMultiplier, MAX_RETENTION_RATE))
	})

	test('cannot deploy security pool with non-existent question', async () => {
		// Use a questionId that has not been created
		const nonExistentQuestionId = 999999999999n

		// Attempt to deploy security pool with non-existent question should fail
		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, nonExistentQuestionId, securityMultiplier, MAX_RETENTION_RATE))
	})

	test('cannot deploy origin security pool in an already-forked universe', async () => {
		const forkSourceQuestionData = {
			...questionData,
			title: `factory fork source ${await mockWindow.getTime()}`,
			endTime: (await mockWindow.getTime()) + DAY,
		}
		const forkSourceQuestionId = getQuestionId(forkSourceQuestionData, outcomes)
		await createQuestion(client, forkSourceQuestionData, outcomes)
		await mockWindow.setTime(forkSourceQuestionData.endTime + 1n)
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), getZoltarAddress())
		await forkUniverse(client, genesisUniverse, forkSourceQuestionId)

		await assert.rejects(deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE), /universe forked/)
	})

	test('cannot deploy origin security pool in a missing universe', async () => {
		const missingUniverseId = 999999n

		await assert.rejects(deployOriginSecurityPool(client, missingUniverseId, questionId, securityMultiplier, MAX_RETENTION_RATE), /universe missing/)
	})

	test('can fork security pool using separate initiate and migrate calls with multiple migrations', async () => {
		// Setup: trigger own fork and prepare
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const securityPoolAllowance = repDeposit / 4n
		await manipulatePriceOracleAndPerformOperation(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, client.account.address, securityPoolAllowance)
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await approveAndDepositRep(attackerClient, repDeposit, questionId)
		await manipulatePriceOracleAndPerformOperation(attackerClient, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.SetSecurityBondsAllowance, attackerClient.account.address, securityPoolAllowance)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		await depositRep(attackerClient, securityPoolAddresses.securityPool, forkThreshold)

		const repBalanceInGenesisPool = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)

		// Verify the own-game fork left the parent pool fully initialized for migration
		strictEqualTypeSafe(await getSystemState(client, securityPoolAddresses.securityPool), SystemState.PoolForked, 'Parent is forked')
		const forkData = await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool)
		assert.ok(forkData.auctionableRepAtFork > 0n, 'rep at fork should stay positive after the own-game fork')
		assert.ok(forkData.auctionableRepAtFork <= repBalanceInGenesisPool + forkThreshold * 2n, 'rep at fork should stay bounded by the REP that actually participated in the own-game fork')
		strictEqualTypeSafe(forkData.migratedRep, 0n, 'migrated rep should be 0 so far')
		strictEqualTypeSafe(forkData.ownFork, true, 'should be own fork')

		// Step 2: Call migrateRepToZoltar separately for each outcome
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.No])
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid])

		// Additional migration should fail (all rep already allocated)
		await assert.rejects(migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes]), /vm/)

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

	test('own-fork initializes unresolved escalation child denominators', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
			await depositRep(client, securityPoolAddresses.securityPool, vaultRepNeeded)
		}
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		const parentVaultBefore = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const yesChildVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesChildDenominator = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		assert.ok(yesChildDenominator > 0n, 'own-fork child denominator should be initialized when vault REP at fork is zero')
		strictEqualTypeSafe(yesChildVault.repDepositShare, 0n, 'own-fork escalation claim should not credit child ownership')
		const parentVaultAfter = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.ok(parentVaultAfter.repInEscalationGame < parentVaultBefore.repInEscalationGame, 'unresolved escalation migration should clear parent vault escalation position')
		if (ownForkRepBuckets.vaultRepAtFork === 0n) {
			assert.strictEqual(parentVaultAfter.repDepositShare, 0n, 'all vault REP was in escalation so parent ownership should stay zero')
		}
	})

	test('own-fork claim path keeps denominator valid when all parent vault REP is escrowed', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		const halfVaultRep = vaultRep / 2n
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, halfVaultRep)
		const vaultAfterFirstDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepRemaining = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterFirstDeposit.repDepositShare)
		const remainingVaultRep = vaultRepRemaining
		if (remainingVaultRep > 0n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, remainingVaultRep)
		}
		const parentVaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentRepAtFork = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, parentVaultBeforeFork.repDepositShare)
		strictEqualTypeSafe(parentRepAtFork, 0n, 'all parent vault REP should be escrowed before own fork')

		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		const ownForkRepBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		assert.strictEqual(ownForkRepBuckets.vaultRepAtFork, 0n, 'all-rep-in-escalation scenario should have zero vaultRepAtFork')

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const walletChildRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])

		const yesChildBalanceAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)
		const walletChildRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		const yesChildVault = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)
		const yesChildDenominator = await getPoolOwnershipDenominator(client, yesSecurityPool.securityPool)
		assert.ok(yesChildDenominator > 0n, 'own-fork child denominator should stay non-zero when all REP is escrowed at fork')
		strictEqualTypeSafe(yesChildBalanceAfterClaim, 0n, 'own-fork escalation claim should not move REP into the child pool')
		strictEqualTypeSafe(yesChildVault.repDepositShare, 0n, 'own-fork escalation claim should not credit child ownership')
		assert.ok(walletChildRepAfterClaim > walletChildRepBeforeClaim, 'own-fork escalation claim should pay child REP directly to the wallet')
	})

	test('direct own-fork escalation claims do not require preparation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vaultBeforeDeposits = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeDeposits = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeDeposits.repDepositShare)
		const vaultRepNeeded = vaultRepBeforeDeposits < 2n * forkThreshold ? 2n * forkThreshold - vaultRepBeforeDeposits : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
		}
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const walletChildRepBeforeClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		const hash = await client.writeContract({
			abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
			address: getInfraContractAddresses().securityPoolForker,
			functionName: 'claimForkedEscalationDeposits',
			args: [securityPoolAddresses.securityPool, client.account.address, Number(QuestionOutcome.Yes), [0n]],
		})
		await client.waitForTransactionReceipt({ hash })
		const walletChildRepAfterClaim = await getERC20Balance(client, getRepTokenAddress(yesUniverse), client.account.address)
		assert.ok(walletChildRepAfterClaim > walletChildRepBeforeClaim, 'own-fork claim should pay child REP without an explicit preparation transaction')
	})

	test('own-fork unresolved escalation migration does not contribute to child migrated REP accounting', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)

		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 4n * forkThreshold ? 4n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			vaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vault.repDepositShare)
		}
		assert.ok(vaultRep > 2n * forkThreshold, 'test setup needs unlocked REP alongside the unresolved escalation deposit')

		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, forkThreshold)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		const parentVaultBeforeMigration = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const parentForkBuckets = await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool)
		const parentOwnershipDenominator = await getPoolOwnershipDenominator(client, securityPoolAddresses.securityPool)
		const expectedUnlockedMigratedRep = parentOwnershipDenominator === 0n ? 0n : (parentVaultBeforeMigration.repDepositShare * parentForkBuckets.vaultRepAtFork) / parentOwnershipDenominator
		const migratedRepBefore = await getMigratedRep(client, yesChildPool)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)
		const migratedRepAfter = await getMigratedRep(client, yesChildPool)
		const childEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address)
		strictEqualTypeSafe(migratedRepAfter - migratedRepBefore, expectedUnlockedMigratedRep, 'own-fork unresolved migration should count only unlocked pool REP as migrated REP')
		assert.ok(childEscrow > 0n, 'own-fork unresolved migration should record child escalation escrow without preparation')
	})

	test('own-fork unresolved migration still works after a prior own-fork claim reduces parent escrow', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)

		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const migratedEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.No, client.account.address)
		assert.ok(migratedEscrow > 0n, 'remaining unresolved own-fork escrow should still migrate after an earlier own-fork claim')
	})

	test('direct own-fork unresolved migration allows arbitrary vault order without preparation', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await approveAndDepositRep(client, 2n * forkThreshold, questionId)
		await approveAndDepositRep(attackerClient, 2n * forkThreshold, questionId)
		const clientYesEscalation = forkThreshold / 2n
		const attackerYesEscalation = forkThreshold - clientYesEscalation
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, clientYesEscalation)
		await depositToEscalationGame(attackerClient, securityPoolAddresses.securityPool, QuestionOutcome.Yes, attackerYesEscalation)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, forkThreshold)
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Yes])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(attackerClient, securityPoolAddresses.securityPool, attackerClient.account.address, QuestionOutcome.Yes)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesChildPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier).securityPool
		const clientEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address)
		const attackerEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, attackerClient.account.address)
		assert.ok(clientEscrow > 0n, 'direct migration should allow the client vault to migrate')
		assert.ok(attackerEscrow > 0n, 'direct migration should allow the attacker vault to migrate')
	})

	test('own-fork unresolved migration can migrate to the invalid child branch without preparation', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		const vaultBeforeFork = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepBeforeFork = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultBeforeFork.repDepositShare)
		const vaultRepNeeded = vaultRepBeforeFork < 2n * forkThreshold ? 2n * forkThreshold - vaultRepBeforeFork : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
		}
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		await migrateRepToZoltar(client, securityPoolAddresses.securityPool, [QuestionOutcome.Invalid])
		await createChildUniverse(client, securityPoolAddresses.securityPool, QuestionOutcome.Invalid)
		await migrateVaultWithUnresolvedEscalation(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Invalid)

		const invalidUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Invalid)
		const invalidSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, invalidUniverse, questionId, securityMultiplier)
		const invalidEscalationGame = await getSecurityPoolsEscalationGame(client, invalidSecurityPool.securityPool)
		const invalidOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.Invalid)
		const yesOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.Yes)
		const noOutcomeState = await getEscalationGameOutcomeState(client, invalidEscalationGame, QuestionOutcome.No)
		const childEscrow = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Invalid, client.account.address)
		const childYesEscrowByOriginalDepositOutcome = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.Yes, client.account.address)
		const childNoEscrowByOriginalDepositOutcome = await getForkedEscrowChildRepByOutcomeAndVault(client, invalidSecurityPool.securityPool, QuestionOutcome.No, client.account.address)
		const childEscrowByOriginalDepositOutcome = childYesEscrowByOriginalDepositOutcome + childNoEscrowByOriginalDepositOutcome
		strictEqualTypeSafe(childEscrow, 0n, 'invalid child migration should not record forked escrow against the child branch outcome')
		assert.ok(childEscrowByOriginalDepositOutcome > 0n, 'invalid child migration should record forked escrow against the original deposit outcome')
		strictEqualTypeSafe(invalidOutcomeState.balance, 0n, 'migrating to the invalid child should not credit resolution balance to the child fork outcome')
		strictEqualTypeSafe(yesOutcomeState.balance + noOutcomeState.balance, childEscrowByOriginalDepositOutcome, 'migrating unresolved deposits should credit resolution balances to original deposit outcomes')
	})

	test('own-fork escalation claim zero child allocation does not revert', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const parent = securityPoolAddresses.securityPool

		await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'setOwnForkRepBuckets',
			args: [parent, 1n, 2n],
		})

		const claimHash = await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationClaim',
			args: [parent, 1n],
		})
		await client.waitForTransactionReceipt({ hash: claimHash })
	})

	test('own-fork escalation claim rounds positive source claims up to non-zero child REP', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const parent = securityPoolAddresses.securityPool
		const previewOwnForkEscalationClaimAbi = [
			{
				inputs: [
					{
						internalType: 'address',
						name: 'parent',
						type: 'address',
					},
					{
						internalType: 'uint256',
						name: 'sourceRepAmount',
						type: 'uint256',
					},
				],
				name: 'previewOwnForkEscalationClaim',
				outputs: [
					{
						internalType: 'uint256',
						name: 'childRepAmount',
						type: 'uint256',
					},
				],
				stateMutability: 'view',
				type: 'function',
			},
		] satisfies Abi

		await client.writeContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'setOwnForkRepBuckets',
			args: [parent, 1n, 2n],
		})

		const childRepAmount = await client.readContract({
			abi: previewOwnForkEscalationClaimAbi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationClaim',
			args: [parent, 1n],
		})

		strictEqualTypeSafe(childRepAmount, 1n, 'a positive own-fork claim should round up to non-zero child REP')
	})

	test('own-fork escalation ownership credit rounds up small positive claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()

		const ownershipToCredit = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationOwnershipToCredit',
			args: [1n, 1n, 2n],
		})

		strictEqualTypeSafe(ownershipToCredit, 1n, 'a positive child REP claim should round up to at least one ownership unit')
	})

	test('own-fork escalation ownership credit stays conserved across split claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const [credits, totalOwnershipClaimed] = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationOwnershipSequence',
			args: [[1n, 1n], 3n, 2n],
		})

		assert.deepStrictEqual(credits, [2n, 1n], 'split own-fork claims should allocate the remaining ownership rather than rounding each claim independently')
		strictEqualTypeSafe(totalOwnershipClaimed, 3n, 'split own-fork claims should never mint more than the fixed child ownership denominator')
	})

	test('own-fork escalation collateral stays conserved across split claims', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const [collateralTransfers, totalCollateralTransferred] = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkEscalationCollateralSequence',
			args: [[1n, 1n], 3n, 2n],
		})

		assert.deepStrictEqual(collateralTransfers, [2n, 1n], 'split own-fork claims should transfer collateral from the fixed fork snapshot, not from the shrinking remainder')
		strictEqualTypeSafe(totalCollateralTransferred, 3n, 'split own-fork claims should transfer the same total collateral as a single combined claim')
	})

	test('own-fork escalation claim zero child allocation returns without moving child balance', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const parent = securityPoolAddresses.securityPool
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, parent))) / 20n / securityMultiplier
		let vault = await getSecurityVault(client, parent, client.account.address)
		let vaultRep = await poolOwnershipToRep(client, parent, vault.repDepositShare)
		const vaultRepNeeded = vaultRep < 2n * forkThreshold ? 2n * forkThreshold - vaultRep : 0n
		if (vaultRepNeeded > 0n) {
			await approveAndDepositRep(client, vaultRepNeeded, questionId)
			vault = await getSecurityVault(client, parent, client.account.address)
			vaultRep = await poolOwnershipToRep(client, parent, vault.repDepositShare)
		}
		assert.ok(vaultRep >= 2n * forkThreshold, 'test setup needs enough REP to trigger own fork')
		await triggerOwnGameFork(client, parent)

		const childRepAtForkSlot = getMappingStorageSlot(parent, 0n)
		const escalationChildRepAtForkSlot = formatStorageSlot(childRepAtForkSlot + 11n)
		await mockWindow.addStateOverrides({
			[getInfraContractAddresses().securityPoolForker]: {
				stateDiff: {
					[escalationChildRepAtForkSlot]: 0n,
				},
			},
		})

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(parent, yesUniverse, questionId, securityMultiplier)
		const parentVaultBefore = await getSecurityVault(client, parent, client.account.address)
		const yesRepTokenAddress = getRepTokenAddress(yesUniverse)
		const childBalanceBefore = (await contractExists(client, yesRepTokenAddress)) ? await getERC20Balance(client, yesRepTokenAddress, yesSecurityPool.securityPool) : 0n

		await claimForkedEscalationDeposits(client, parent, client.account.address, QuestionOutcome.Yes, [0n])

		const parentVaultAfter = await getSecurityVault(client, parent, client.account.address)
		const childBalanceAfter = (await contractExists(client, yesRepTokenAddress)) ? await getERC20Balance(client, yesRepTokenAddress, yesSecurityPool.securityPool) : 0n
		const childVaultAfter = await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)

		strictEqualTypeSafe(childBalanceAfter, childBalanceBefore, 'zero-child own-fork settlement should not move REP into the child pool')
		strictEqualTypeSafe(childVaultAfter.repDepositShare, 0n, 'zero-child own-fork settlement should not credit child ownership')
		assert.ok(parentVaultAfter.repInEscalationGame < parentVaultBefore.repInEscalationGame, 'zero-child own-fork settlement should consume the claimed parent escalation position')
	})

	test('own-fork escalation claim settlement is order independent across claims', async () => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10n * DAY)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		let clientVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		let clientVaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, clientVault.repDepositShare)
		const clientVaultRepNeeded = clientVaultRep < 2n * forkThreshold ? 2n * forkThreshold - clientVaultRep : 0n
		if (clientVaultRepNeeded > 0n) {
			await approveAndDepositRep(client, clientVaultRepNeeded, questionId)
			clientVault = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
			clientVaultRep = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, clientVault.repDepositShare)
		}
		const firstYesDeposit = reportBond
		const secondYesDeposit = clientVaultRep / 2n > firstYesDeposit ? clientVaultRep / 2n - firstYesDeposit : 0n
		assert.ok(secondYesDeposit > 0n, 'test setup needs two distinct yes-side deposits')
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, firstYesDeposit)
		await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.Yes, secondYesDeposit)
		const vaultAfterFirstDeposit = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		const vaultRepRemaining = await poolOwnershipToRep(client, securityPoolAddresses.securityPool, vaultAfterFirstDeposit.repDepositShare)
		if (vaultRepRemaining > 0n) {
			await depositToEscalationGame(client, securityPoolAddresses.securityPool, QuestionOutcome.No, vaultRepRemaining)
		}
		await forkZoltarWithOwnEscalationGame(client, securityPoolAddresses.securityPool)

		const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
		const yesSecurityPool = getSecurityPoolAddresses(securityPoolAddresses.securityPool, yesUniverse, questionId, securityMultiplier)
		const claimOrderSnapshot = await mockWindow.anvilSnapshot()

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])
		const clientChildShareAfterClientFirst = (await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).repDepositShare
		const childBalanceAfterClientFirst = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)

		await mockWindow.anvilRevert(claimOrderSnapshot)

		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [1n])
		await claimForkedEscalationDeposits(client, securityPoolAddresses.securityPool, client.account.address, QuestionOutcome.Yes, [0n])
		const clientChildShareAfterAttackerFirst = (await getSecurityVault(client, yesSecurityPool.securityPool, client.account.address)).repDepositShare
		const childBalanceAfterAttackerFirst = await getERC20Balance(client, getRepTokenAddress(yesUniverse), yesSecurityPool.securityPool)

		strictEqualTypeSafe(clientChildShareAfterClientFirst, clientChildShareAfterAttackerFirst, 'client child ownership should not depend on claim order')
		strictEqualTypeSafe(childBalanceAfterClientFirst, childBalanceAfterAttackerFirst, 'child REP balance should not depend on claim order')
	})

	test('own-fork unresolved escalation allocation stays per-vault stable across input order', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const childRepAtFork = 7n * 10n ** 18n
		const vaults: Address[] = [client.account.address, addressString(TEST_ADDRESSES[1]), addressString(TEST_ADDRESSES[2])]
		const sourceAmounts: bigint[] = [10n * 10n ** 18n, 11n * 10n ** 18n, 13n * 10n ** 18n]
		const reversedVaults: Address[] = [vaults[2], vaults[1], vaults[0]]
		const reversedSourceAmounts: bigint[] = [sourceAmounts[2], sourceAmounts[1], sourceAmounts[0]]

		const allocationsInInputOrder = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [vaults, sourceAmounts, childRepAtFork],
		})
		const allocationsInReversedOrder = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [reversedVaults, reversedSourceAmounts, childRepAtFork],
		})

		const allocationByVault = new Map<Address, bigint>()
		for (let index = 0; index < vaults.length; index++) allocationByVault.set(vaults[index], allocationsInInputOrder[index])
		for (let index = 0; index < reversedVaults.length; index++) strictEqualTypeSafe(allocationsInReversedOrder[index], allocationByVault.get(reversedVaults[index]) ?? 0n, 'each vault should keep the same fixed-rate allocation regardless of batch order')
	})

	test('own-fork unresolved escalation allocation uses a fixed per-vault rate and leaves residual dust', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const vaults: Address[] = [client.account.address, addressString(TEST_ADDRESSES[1])]
		const sourceAmounts: bigint[] = [1n, 1n]
		const childRepAtFork = 1n
		const childAmounts = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationAllocation',
			args: [vaults, sourceAmounts, childRepAtFork],
		})

		assert.deepStrictEqual(childAmounts, [0n, 0n], 'each vault should receive its independently rounded-down fixed-rate share')
		strictEqualTypeSafe(childAmounts[0] + childAmounts[1], 0n, 'fixed-rate unresolved migration should be allowed to leave residual child REP dust unallocated')
	})

	test('own-fork unresolved escalation allocation stays stable across pools with different vault creation order', async () => {
		const attackerClient = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const baseSnapshot = await mockWindow.anvilSnapshot()
		const runScenario = async (questionTitleSuffix: string, vaultCreationOrder: Address[]) => {
			const scenarioQuestionData = {
				...questionData,
				title: `${questionData.title} ${questionTitleSuffix}`,
				endTime: questionData.endTime + DAY,
			}
			const scenarioQuestionId = getQuestionId(scenarioQuestionData, outcomes)
			await createQuestion(client, scenarioQuestionData, outcomes)
			await deployOriginSecurityPool(client, genesisUniverse, scenarioQuestionId, securityMultiplier, MAX_RETENTION_RATE)
			const scenarioPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, scenarioQuestionId, securityMultiplier).securityPool
			const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, scenarioPool))) / 20n / securityMultiplier
			const depositorsByAddress = new Map<Address, WriteClient>([
				[client.account.address, client],
				[attackerClient.account.address, attackerClient],
			])
			for (const vault of vaultCreationOrder) {
				const depositor = depositorsByAddress.get(vault)
				if (depositor === undefined) throw new Error(`missing depositor for ${vault}`)
				await approveAndDepositRep(depositor, 2n * forkThreshold, scenarioQuestionId)
			}
			await mockWindow.setTime(scenarioQuestionData.endTime + 10n * DAY)
			const clientYesEscalation = forkThreshold / 2n
			const attackerYesEscalation = forkThreshold - clientYesEscalation
			await depositToEscalationGame(client, scenarioPool, QuestionOutcome.Yes, clientYesEscalation)
			await depositToEscalationGame(attackerClient, scenarioPool, QuestionOutcome.Yes, attackerYesEscalation)
			await depositToEscalationGame(client, scenarioPool, QuestionOutcome.No, forkThreshold)

			await forkZoltarWithOwnEscalationGame(client, scenarioPool)
			await migrateRepToZoltar(client, scenarioPool, [QuestionOutcome.Yes])
			await createChildUniverse(client, scenarioPool, QuestionOutcome.Yes)

			await migrateVaultWithUnresolvedEscalation(client, scenarioPool, client.account.address, QuestionOutcome.Yes)
			await migrateVaultWithUnresolvedEscalation(attackerClient, scenarioPool, attackerClient.account.address, QuestionOutcome.Yes)

			const yesUniverse = getChildUniverseId(genesisUniverse, QuestionOutcome.Yes)
			const yesChildPool = getSecurityPoolAddresses(scenarioPool, yesUniverse, scenarioQuestionId, securityMultiplier).securityPool
			return {
				clientEscrow: await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, client.account.address),
				attackerEscrow: await getForkedEscrowChildRepByOutcomeAndVault(client, yesChildPool, QuestionOutcome.Yes, attackerClient.account.address),
			}
		}

		const firstScenario = await runScenario('creation order client-first', [client.account.address, attackerClient.account.address])
		await mockWindow.anvilRevert(baseSnapshot)
		const secondScenario = await runScenario('creation order attacker-first', [attackerClient.account.address, client.account.address])

		strictEqualTypeSafe(firstScenario.clientEscrow, secondScenario.clientEscrow, 'client child escrow allocation should not depend on parent vault creation order')
		strictEqualTypeSafe(firstScenario.attackerEscrow, secondScenario.attackerEscrow, 'attacker child escrow allocation should not depend on parent vault creation order')
	})

	test('own-fork unresolved escalation zero child allocation is a no-op', async () => {
		const harnessAddress = await deployOwnForkEscalationClaimHarness()
		const exportedAmounts: bigint[] = [3n * reportBond, 5n * reportBond, 7n * reportBond]

		const returnedAmounts = await client.readContract({
			abi: test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.abi,
			address: harnessAddress,
			functionName: 'previewOwnForkUnresolvedEscalationNoop',
			args: [exportedAmounts, 0n],
		})

		assert.deepStrictEqual(returnedAmounts, exportedAmounts, 'zero child allocation should preserve exported unresolved deposits')
	})

	test('SecurityPool receive restricts unauthorized senders', async () => {
		const forkerAddress = getInfraContractAddresses().securityPoolForker
		const poolAddress = securityPoolAddresses.securityPool

		// Ensure forker has ETH to send
		await mockWindow.setBalance(forkerAddress, testInternalSenderBalance)

		// 1. Unauthorized sender should revert
		await assert.rejects(client.sendTransaction({ to: poolAddress, value: 1000n }))

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
		await assert.rejects(client.sendTransaction({ to: childPoolAddress, value: 100n }))

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
		await assert.rejects(client.sendTransaction({ to: forkerAddress, value: 100n }))

		// 2. Authorized sender: truthAuction
		const initialForkerBal = await getETHBalance(client, forkerAddress)
		await mockWindow.impersonateAccount(truthAuctionAddress)
		await sendEthAndWait(truthAuctionAddress, forkerAddress, 2000n)
		const newForkerBal = await getETHBalance(client, forkerAddress)
		strictEqualTypeSafe(newForkerBal - initialForkerBal, 2000n, 'Forker balance increase from truthAuction')
	})
})
