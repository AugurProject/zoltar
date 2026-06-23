import { beforeAll, beforeEach, setDefaultTimeout } from 'bun:test'
import assert from 'node:assert/strict'
import { decodeEventLog, encodeAbiParameters, keccak256 } from 'viem'
import type { Abi, Address, Hash } from 'viem'
import { AnvilWindowEthereum } from '../../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../testsuite/simulator/useIsolatedAnvilNode'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/shared/constants'
import { createWriteClient, WriteClient } from '../../testsuite/simulator/utils/viem'
import { DAY, GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testsuite/simulator/utils/constants'
import { approveToken, contractExists, getChildUniverseId, getERC20Balance, getETHBalance, ensureProxyDeployerDeployed, setupTestAccounts, sortStringArrayByKeccak } from '../../testsuite/simulator/utils/utilities'
import { addressString, rpow } from '../../testsuite/simulator/utils/bigint'
import { approveAndDepositRep, canLiquidate, handleOracleReporting, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation, triggerOwnGameFork } from '../../testsuite/simulator/utils/contracts/peripheralsTestUtils'
import { deployOriginSecurityPool, ensureDeploymentStatusOracleDeployed, ensureInfraDeployed, getDeploymentStatusOracleAddress, getDeploymentStepAddresses, getInfraContractAddresses, getSecurityPoolAddresses, loadDeploymentStatusOracleMask } from '../../testsuite/simulator/utils/contracts/deployPeripherals'
import { createQuestion, getQuestionId } from '../../testsuite/simulator/utils/contracts/zoltarQuestionData'

import { balanceOfShares, balanceOfSharesInCash, getEthRaiseCap, getLastPrice, getQuestionEndDate, migrateShares, OperationType, participateAuction, requestPriceIfNeededAndStageOperation } from '../../testsuite/simulator/utils/contracts/peripherals'
import { getScalarOutcomeIndex } from '../../testsuite/simulator/utils/contracts/scalarOutcome'
import { tickToPrice } from '../../testsuite/simulator/utils/tickMath'
import { QuestionOutcome } from '../../testsuite/simulator/types/types'
import { SystemState } from '../../testsuite/simulator/types/peripheralTypes'
import { approximatelyEqual, ensureDefined, strictEqual18Decimal, strictEqualTypeSafe } from '../../testsuite/simulator/utils/testUtils'
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
} from '../../testsuite/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameDeposits, getEscalationGameOutcomeState, getEscalationGameTotalCost, getNonDecisionThreshold, getQuestionResolution, getStartBond } from '../../testsuite/simulator/utils/contracts/escalationGame'
import { ensureZoltarDeployed, forkUniverse, getMigrationRepBalance, getRepTokenAddress, getTotalTheoreticalSupply, getUniverseData, getZoltarAddress, getZoltarForkThreshold } from '../../testsuite/simulator/utils/contracts/zoltar'
import { getTotalRepPurchased } from '../../testsuite/simulator/utils/contracts/auction'
import { isIgnorableLogDecodeError } from '../logDecodeErrors'
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
} from '../../testsuite/simulator/utils/contracts/securityPool'
import {
	peripherals_EscalationGame_EscalationGame,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_tokens_ShareToken_ShareToken,
	test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness,
} from '../../types/contractArtifact'

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
			{ internalType: 'uint256', name: 'childOutcomeIndex', type: 'uint256' },
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

function usePeripheralsTestFixture() {
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

	const setupOwnForkWithEscrow = async (strayRepBeforeFork: bigint = 0n) => {
		const endTime = await getQuestionEndDate(client, questionId)
		await mockWindow.setTime(endTime + 10000n)
		const forkThreshold = (await getTotalTheoreticalSupply(client, await getRepToken(client, securityPoolAddresses.securityPool))) / 20n / securityMultiplier
		await depositRep(client, securityPoolAddresses.securityPool, 2n * forkThreshold)
		const repBalance = await getERC20Balance(client, getRepTokenAddress(genesisUniverse), securityPoolAddresses.securityPool)
		if (strayRepBeforeFork > 0n) await transferRepToAddress(client, getInfraContractAddresses().securityPoolForker, strayRepBeforeFork)
		await triggerOwnGameFork(client, securityPoolAddresses.securityPool)
		return {
			forkData: await getSecurityPoolForkerForkData(client, securityPoolAddresses.securityPool),
			forkThreshold,
			ownForkRepBuckets: await getOwnForkRepBuckets(client, securityPoolAddresses.securityPool),
			repBalance,
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

	return {
		get mockWindow() {
			return mockWindow
		},
		get client() {
			return client
		},
		get securityPoolAddresses() {
			return securityPoolAddresses
		},
		get questionEndDate() {
			return questionEndDate
		},
		get questionData() {
			return questionData
		},
		get questionId() {
			return questionId
		},
		getAnvilWindowEthereum,
		setBaselineSnapshot,
		initializePeripheralsBaseline,
		assert,
		decodeEventLog,
		encodeAbiParameters,
		keccak256,
		sortBigIntsAscending,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient,
		DAY,
		GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES,
		approveToken,
		contractExists,
		getChildUniverseId,
		getERC20Balance,
		getETHBalance,
		ensureProxyDeployerDeployed,
		setupTestAccounts,
		sortStringArrayByKeccak,
		addressString,
		rpow,
		approveAndDepositRep,
		canLiquidate,
		handleOracleReporting,
		manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork,
		deployOriginSecurityPool,
		ensureDeploymentStatusOracleDeployed,
		ensureInfraDeployed,
		getDeploymentStatusOracleAddress,
		getDeploymentStepAddresses,
		getInfraContractAddresses,
		getSecurityPoolAddresses,
		loadDeploymentStatusOracleMask,
		createQuestion,
		getQuestionId,
		balanceOfShares,
		balanceOfSharesInCash,
		getEthRaiseCap,
		getLastPrice,
		getQuestionEndDate,
		migrateShares,
		OperationType,
		participateAuction,
		requestPriceIfNeededAndStageOperation,
		getScalarOutcomeIndex,
		tickToPrice,
		QuestionOutcome,
		SystemState,
		approximatelyEqual,
		ensureDefined,
		strictEqual18Decimal,
		strictEqualTypeSafe,
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
		getEscalationGameDeposits,
		getEscalationGameOutcomeState,
		getEscalationGameTotalCost,
		getNonDecisionThreshold,
		getQuestionResolution,
		getStartBond,
		ensureZoltarDeployed,
		forkUniverse,
		getMigrationRepBalance,
		getRepTokenAddress,
		getTotalTheoreticalSupply,
		getUniverseData,
		getZoltarAddress,
		getZoltarForkThreshold,
		getTotalRepPurchased,
		isIgnorableLogDecodeError,
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
		peripherals_EscalationGame_EscalationGame,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		peripherals_SecurityPoolForker_SecurityPoolForker,
		peripherals_tokens_ShareToken_ShareToken,
		test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness,
		getMigrationProxyAddressAbi,
		migrateVaultWithUnresolvedEscalationReturnAbi,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		PRICE_PRECISION,
		repDeposit,
		genesisUniverse,
		securityMultiplier,
		reportedRepEthPrice,
		testInternalSenderBalance,
		MAX_RETENTION_RATE,
		EXTRA_INFO,
		outcomes,
		sendEthAndWait,
		transferRepToAddress,
		deployOwnForkEscalationClaimHarness,
		getVaultRepClaim,
		finalizeQuestionAsYesWithoutFork,
		triggerExternalForkForSecurityPool,
		setupOwnForkWithEscrow,
		setupTruthAuctionWithMixedBids,
		setupFinalizedTruthAuctionWithMixedBids,
	}
}

export function usePeripheralsDeploymentAndOwnForkEscalationFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		createWriteClient: fixture.createWriteClient,
		DAY: fixture.DAY,
		GENESIS_REPUTATION_TOKEN: fixture.GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		approveToken: fixture.approveToken,
		contractExists: fixture.contractExists,
		getChildUniverseId: fixture.getChildUniverseId,
		getERC20Balance: fixture.getERC20Balance,
		sortStringArrayByKeccak: fixture.sortStringArrayByKeccak,
		addressString: fixture.addressString,
		approveAndDepositRep: fixture.approveAndDepositRep,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork: fixture.triggerOwnGameFork,
		deployOriginSecurityPool: fixture.deployOriginSecurityPool,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		createQuestion: fixture.createQuestion,
		getQuestionId: fixture.getQuestionId,
		getQuestionEndDate: fixture.getQuestionEndDate,
		OperationType: fixture.OperationType,
		QuestionOutcome: fixture.QuestionOutcome,
		SystemState: fixture.SystemState,
		createChildUniverse: fixture.createChildUniverse,
		getMigratedRep: fixture.getMigratedRep,
		getForkedEscrowChildRepByOutcomeAndVault: fixture.getForkedEscrowChildRepByOutcomeAndVault,
		getOwnForkRepBuckets: fixture.getOwnForkRepBuckets,
		getQuestionOutcome: fixture.getQuestionOutcome,
		getSecurityPoolForkerForkData: fixture.getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame: fixture.forkZoltarWithOwnEscalationGame,
		claimForkedEscalationDeposits: fixture.claimForkedEscalationDeposits,
		migrateRepToZoltar: fixture.migrateRepToZoltar,
		migrateVaultWithUnresolvedEscalation: fixture.migrateVaultWithUnresolvedEscalation,
		getEscalationGameOutcomeState: fixture.getEscalationGameOutcomeState,
		forkUniverse: fixture.forkUniverse,
		getRepTokenAddress: fixture.getRepTokenAddress,
		getTotalTheoreticalSupply: fixture.getTotalTheoreticalSupply,
		getUniverseData: fixture.getUniverseData,
		getZoltarAddress: fixture.getZoltarAddress,
		depositRep: fixture.depositRep,
		depositToEscalationGame: fixture.depositToEscalationGame,
		getPoolOwnershipDenominator: fixture.getPoolOwnershipDenominator,
		getRepToken: fixture.getRepToken,
		getSecurityPoolsEscalationGame: fixture.getSecurityPoolsEscalationGame,
		getSecurityVault: fixture.getSecurityVault,
		getSystemState: fixture.getSystemState,
		poolOwnershipToRep: fixture.poolOwnershipToRep,
		peripherals_SecurityPoolForker_SecurityPoolForker: fixture.peripherals_SecurityPoolForker_SecurityPoolForker,
		test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness: fixture.test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness,
		formatStorageSlot: fixture.formatStorageSlot,
		getMappingStorageSlot: fixture.getMappingStorageSlot,
		reportBond: fixture.reportBond,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		MAX_RETENTION_RATE: fixture.MAX_RETENTION_RATE,
		outcomes: fixture.outcomes,
		deployOwnForkEscalationClaimHarness: fixture.deployOwnForkEscalationClaimHarness,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionEndDate() {
			return fixture.questionEndDate
		},
		get questionData() {
			return fixture.questionData
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsDeploymentAndOwnForkEscalationFixture = ReturnType<typeof usePeripheralsDeploymentAndOwnForkEscalationFixture>

export function usePeripheralsEscalationMigrationFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		approximatelyEqual: fixture.approximatelyEqual,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		encodeAbiParameters: fixture.encodeAbiParameters,
		keccak256: fixture.keccak256,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT: fixture.REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient: fixture.createWriteClient,
		DAY: fixture.DAY,
		GENESIS_REPUTATION_TOKEN: fixture.GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		approveToken: fixture.approveToken,
		contractExists: fixture.contractExists,
		getChildUniverseId: fixture.getChildUniverseId,
		getERC20Balance: fixture.getERC20Balance,
		addressString: fixture.addressString,
		approveAndDepositRep: fixture.approveAndDepositRep,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork: fixture.triggerOwnGameFork,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		createQuestion: fixture.createQuestion,
		getQuestionId: fixture.getQuestionId,
		getQuestionEndDate: fixture.getQuestionEndDate,
		OperationType: fixture.OperationType,
		QuestionOutcome: fixture.QuestionOutcome,
		SystemState: fixture.SystemState,
		ensureDefined: fixture.ensureDefined,
		createChildUniverse: fixture.createChildUniverse,
		finalizeTruthAuction: fixture.finalizeTruthAuction,
		getForkedEscrowChildRepByOutcomeAndVault: fixture.getForkedEscrowChildRepByOutcomeAndVault,
		getForkedEscrowPrincipalByOutcomeAndVault: fixture.getForkedEscrowPrincipalByOutcomeAndVault,
		getSecurityPoolForkerForkData: fixture.getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame: fixture.forkZoltarWithOwnEscalationGame,
		initiateSecurityPoolFork: fixture.initiateSecurityPoolFork,
		claimForkedEscalationDeposits: fixture.claimForkedEscalationDeposits,
		migrateRepToZoltar: fixture.migrateRepToZoltar,
		migrateVault: fixture.migrateVault,
		migrateVaultWithUnresolvedEscalation: fixture.migrateVaultWithUnresolvedEscalation,
		startTruthAuction: fixture.startTruthAuction,
		getEscalationGameDeposits: fixture.getEscalationGameDeposits,
		getEscalationGameOutcomeState: fixture.getEscalationGameOutcomeState,
		getEscalationGameTotalCost: fixture.getEscalationGameTotalCost,
		getQuestionResolution: fixture.getQuestionResolution,
		forkUniverse: fixture.forkUniverse,
		getRepTokenAddress: fixture.getRepTokenAddress,
		getTotalTheoreticalSupply: fixture.getTotalTheoreticalSupply,
		getZoltarAddress: fixture.getZoltarAddress,
		getZoltarForkThreshold: fixture.getZoltarForkThreshold,
		createCompleteSet: fixture.createCompleteSet,
		depositRep: fixture.depositRep,
		depositToEscalationGame: fixture.depositToEscalationGame,
		getRepToken: fixture.getRepToken,
		getAwaitingForkContinuation: fixture.getAwaitingForkContinuation,
		getSecurityPoolsEscalationGame: fixture.getSecurityPoolsEscalationGame,
		getSecurityVault: fixture.getSecurityVault,
		getSystemState: fixture.getSystemState,
		poolOwnershipToRep: fixture.poolOwnershipToRep,
		withdrawFromEscalationGame: fixture.withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame: fixture.peripherals_EscalationGame_EscalationGame,
		peripherals_SecurityPoolForker_SecurityPoolForker: fixture.peripherals_SecurityPoolForker_SecurityPoolForker,
		migrateVaultWithUnresolvedEscalationReturnAbi: fixture.migrateVaultWithUnresolvedEscalationReturnAbi,
		formatStorageSlot: fixture.formatStorageSlot,
		getMappingStorageSlot: fixture.getMappingStorageSlot,
		reportBond: fixture.reportBond,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		outcomes: fixture.outcomes,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionData() {
			return fixture.questionData
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsEscalationMigrationFixture = ReturnType<typeof usePeripheralsEscalationMigrationFixture>

export function usePeripheralsForkMigrationFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		approximatelyEqual: fixture.approximatelyEqual,
		strictEqual18Decimal: fixture.strictEqual18Decimal,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		sortBigIntsAscending: fixture.sortBigIntsAscending,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT: fixture.REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient: fixture.createWriteClient,
		DAY: fixture.DAY,
		GENESIS_REPUTATION_TOKEN: fixture.GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		approveToken: fixture.approveToken,
		contractExists: fixture.contractExists,
		getChildUniverseId: fixture.getChildUniverseId,
		getERC20Balance: fixture.getERC20Balance,
		getETHBalance: fixture.getETHBalance,
		addressString: fixture.addressString,
		rpow: fixture.rpow,
		approveAndDepositRep: fixture.approveAndDepositRep,
		canLiquidate: fixture.canLiquidate,
		handleOracleReporting: fixture.handleOracleReporting,
		manipulatePriceOracle: fixture.manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork: fixture.triggerOwnGameFork,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		createQuestion: fixture.createQuestion,
		getQuestionId: fixture.getQuestionId,
		balanceOfShares: fixture.balanceOfShares,
		balanceOfSharesInCash: fixture.balanceOfSharesInCash,
		getEthRaiseCap: fixture.getEthRaiseCap,
		getLastPrice: fixture.getLastPrice,
		getQuestionEndDate: fixture.getQuestionEndDate,
		migrateShares: fixture.migrateShares,
		OperationType: fixture.OperationType,
		participateAuction: fixture.participateAuction,
		requestPriceIfNeededAndStageOperation: fixture.requestPriceIfNeededAndStageOperation,
		getScalarOutcomeIndex: fixture.getScalarOutcomeIndex,
		tickToPrice: fixture.tickToPrice,
		QuestionOutcome: fixture.QuestionOutcome,
		SystemState: fixture.SystemState,
		ensureDefined: fixture.ensureDefined,
		claimAuctionProceeds: fixture.claimAuctionProceeds,
		createChildUniverse: fixture.createChildUniverse,
		finalizeTruthAuction: fixture.finalizeTruthAuction,
		getMigratedRep: fixture.getMigratedRep,
		getOwnForkRepBuckets: fixture.getOwnForkRepBuckets,
		getQuestionOutcome: fixture.getQuestionOutcome,
		getSecurityPoolForkerForkData: fixture.getSecurityPoolForkerForkData,
		forkZoltarWithOwnEscalationGame: fixture.forkZoltarWithOwnEscalationGame,
		initiateSecurityPoolFork: fixture.initiateSecurityPoolFork,
		claimForkedEscalationDeposits: fixture.claimForkedEscalationDeposits,
		migrateRepToZoltar: fixture.migrateRepToZoltar,
		migrateVault: fixture.migrateVault,
		startTruthAuction: fixture.startTruthAuction,
		forkUniverse: fixture.forkUniverse,
		getRepTokenAddress: fixture.getRepTokenAddress,
		getTotalTheoreticalSupply: fixture.getTotalTheoreticalSupply,
		getZoltarAddress: fixture.getZoltarAddress,
		getZoltarForkThreshold: fixture.getZoltarForkThreshold,
		getTotalRepPurchased: fixture.getTotalRepPurchased,
		createCompleteSet: fixture.createCompleteSet,
		depositRep: fixture.depositRep,
		depositToEscalationGame: fixture.depositToEscalationGame,
		getCompleteSetCollateralAmount: fixture.getCompleteSetCollateralAmount,
		getCurrentRetentionRate: fixture.getCurrentRetentionRate,
		getPoolOwnershipDenominator: fixture.getPoolOwnershipDenominator,
		getRepToken: fixture.getRepToken,
		getShareTokenSupply: fixture.getShareTokenSupply,
		getTotalRepBalance: fixture.getTotalRepBalance,
		getSecurityVault: fixture.getSecurityVault,
		getSystemState: fixture.getSystemState,
		getTotalFeesOwedToVaults: fixture.getTotalFeesOwedToVaults,
		getTotalSecurityBondAllowance: fixture.getTotalSecurityBondAllowance,
		poolOwnershipToRep: fixture.poolOwnershipToRep,
		redeemCompleteSet: fixture.redeemCompleteSet,
		redeemFees: fixture.redeemFees,
		redeemRep: fixture.redeemRep,
		redeemShares: fixture.redeemShares,
		sharesToCash: fixture.sharesToCash,
		updateVaultFees: fixture.updateVaultFees,
		withdrawFromEscalationGame: fixture.withdrawFromEscalationGame,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory: fixture.peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		formatStorageSlot: fixture.formatStorageSlot,
		getMappingStorageSlot: fixture.getMappingStorageSlot,
		reportBond: fixture.reportBond,
		PRICE_PRECISION: fixture.PRICE_PRECISION,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		MAX_RETENTION_RATE: fixture.MAX_RETENTION_RATE,
		outcomes: fixture.outcomes,
		transferRepToAddress: fixture.transferRepToAddress,
		getVaultRepClaim: fixture.getVaultRepClaim,
		finalizeQuestionAsYesWithoutFork: fixture.finalizeQuestionAsYesWithoutFork,
		triggerExternalForkForSecurityPool: fixture.triggerExternalForkForSecurityPool,
		setupOwnForkWithEscrow: fixture.setupOwnForkWithEscrow,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionData() {
			return fixture.questionData
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsForkMigrationFixture = ReturnType<typeof usePeripheralsForkMigrationFixture>

export function usePeripheralsReceiveGuardsFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		createWriteClient: fixture.createWriteClient,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		getChildUniverseId: fixture.getChildUniverseId,
		getETHBalance: fixture.getETHBalance,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork: fixture.triggerOwnGameFork,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		getQuestionEndDate: fixture.getQuestionEndDate,
		OperationType: fixture.OperationType,
		QuestionOutcome: fixture.QuestionOutcome,
		migrateRepToZoltar: fixture.migrateRepToZoltar,
		migrateVault: fixture.migrateVault,
		getTotalTheoreticalSupply: fixture.getTotalTheoreticalSupply,
		createCompleteSet: fixture.createCompleteSet,
		depositRep: fixture.depositRep,
		getRepToken: fixture.getRepToken,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		testInternalSenderBalance: fixture.testInternalSenderBalance,
		sendEthAndWait: fixture.sendEthAndWait,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsReceiveGuardsFixture = ReturnType<typeof usePeripheralsReceiveGuardsFixture>

export function usePeripheralsTruthAuctionFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		approximatelyEqual: fixture.approximatelyEqual,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		decodeEventLog: fixture.decodeEventLog,
		createWriteClient: fixture.createWriteClient,
		DAY: fixture.DAY,
		GENESIS_REPUTATION_TOKEN: fixture.GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		approveToken: fixture.approveToken,
		contractExists: fixture.contractExists,
		getChildUniverseId: fixture.getChildUniverseId,
		getERC20Balance: fixture.getERC20Balance,
		getETHBalance: fixture.getETHBalance,
		addressString: fixture.addressString,
		approveAndDepositRep: fixture.approveAndDepositRep,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		triggerOwnGameFork: fixture.triggerOwnGameFork,
		deployOriginSecurityPool: fixture.deployOriginSecurityPool,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		createQuestion: fixture.createQuestion,
		getQuestionId: fixture.getQuestionId,
		getEthRaiseCap: fixture.getEthRaiseCap,
		getQuestionEndDate: fixture.getQuestionEndDate,
		OperationType: fixture.OperationType,
		participateAuction: fixture.participateAuction,
		tickToPrice: fixture.tickToPrice,
		QuestionOutcome: fixture.QuestionOutcome,
		SystemState: fixture.SystemState,
		claimAuctionProceeds: fixture.claimAuctionProceeds,
		createChildUniverse: fixture.createChildUniverse,
		finalizeTruthAuction: fixture.finalizeTruthAuction,
		getMigratedRep: fixture.getMigratedRep,
		getOwnForkRepBuckets: fixture.getOwnForkRepBuckets,
		getQuestionOutcome: fixture.getQuestionOutcome,
		getSecurityPoolForkerForkData: fixture.getSecurityPoolForkerForkData,
		initiateSecurityPoolFork: fixture.initiateSecurityPoolFork,
		claimForkedEscalationDeposits: fixture.claimForkedEscalationDeposits,
		migrateRepToZoltar: fixture.migrateRepToZoltar,
		migrateVault: fixture.migrateVault,
		settleAuctionBids: fixture.settleAuctionBids,
		startTruthAuction: fixture.startTruthAuction,
		forkUniverse: fixture.forkUniverse,
		getMigrationRepBalance: fixture.getMigrationRepBalance,
		getRepTokenAddress: fixture.getRepTokenAddress,
		getTotalTheoreticalSupply: fixture.getTotalTheoreticalSupply,
		getZoltarAddress: fixture.getZoltarAddress,
		getTotalRepPurchased: fixture.getTotalRepPurchased,
		isIgnorableLogDecodeError: fixture.isIgnorableLogDecodeError,
		createCompleteSet: fixture.createCompleteSet,
		depositRep: fixture.depositRep,
		depositToEscalationGame: fixture.depositToEscalationGame,
		getCompleteSetCollateralAmount: fixture.getCompleteSetCollateralAmount,
		getPoolOwnershipDenominator: fixture.getPoolOwnershipDenominator,
		getRepToken: fixture.getRepToken,
		getSecurityVault: fixture.getSecurityVault,
		getSystemState: fixture.getSystemState,
		getTotalSecurityBondAllowance: fixture.getTotalSecurityBondAllowance,
		getVaultCount: fixture.getVaultCount,
		poolOwnershipToRep: fixture.poolOwnershipToRep,
		redeemRep: fixture.redeemRep,
		updateVaultFees: fixture.updateVaultFees,
		peripherals_SecurityPoolForker_SecurityPoolForker: fixture.peripherals_SecurityPoolForker_SecurityPoolForker,
		getMigrationProxyAddressAbi: fixture.getMigrationProxyAddressAbi,
		PRICE_PRECISION: fixture.PRICE_PRECISION,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		MAX_RETENTION_RATE: fixture.MAX_RETENTION_RATE,
		outcomes: fixture.outcomes,
		triggerExternalForkForSecurityPool: fixture.triggerExternalForkForSecurityPool,
		setupTruthAuctionWithMixedBids: fixture.setupTruthAuctionWithMixedBids,
		setupFinalizedTruthAuctionWithMixedBids: fixture.setupFinalizedTruthAuctionWithMixedBids,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionData() {
			return fixture.questionData
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsTruthAuctionFixture = ReturnType<typeof usePeripheralsTruthAuctionFixture>

export function usePeripheralsVaultAccountingFixture() {
	const fixture = usePeripheralsTestFixture()
	return {
		assert: fixture.assert,
		approximatelyEqual: fixture.approximatelyEqual,
		strictEqualTypeSafe: fixture.strictEqualTypeSafe,
		decodeEventLog: fixture.decodeEventLog,
		REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT: fixture.REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT,
		createWriteClient: fixture.createWriteClient,
		DAY: fixture.DAY,
		GENESIS_REPUTATION_TOKEN: fixture.GENESIS_REPUTATION_TOKEN,
		TEST_ADDRESSES: fixture.TEST_ADDRESSES,
		approveToken: fixture.approveToken,
		getERC20Balance: fixture.getERC20Balance,
		ensureProxyDeployerDeployed: fixture.ensureProxyDeployerDeployed,
		setupTestAccounts: fixture.setupTestAccounts,
		addressString: fixture.addressString,
		approveAndDepositRep: fixture.approveAndDepositRep,
		manipulatePriceOracle: fixture.manipulatePriceOracle,
		manipulatePriceOracleAndPerformOperation: fixture.manipulatePriceOracleAndPerformOperation,
		deployOriginSecurityPool: fixture.deployOriginSecurityPool,
		ensureDeploymentStatusOracleDeployed: fixture.ensureDeploymentStatusOracleDeployed,
		getAnvilWindowEthereum: fixture.getAnvilWindowEthereum,
		setBaselineSnapshot: fixture.setBaselineSnapshot,
		initializePeripheralsBaseline: fixture.initializePeripheralsBaseline,
		getDeploymentStatusOracleAddress: fixture.getDeploymentStatusOracleAddress,
		getDeploymentStepAddresses: fixture.getDeploymentStepAddresses,
		getInfraContractAddresses: fixture.getInfraContractAddresses,
		getSecurityPoolAddresses: fixture.getSecurityPoolAddresses,
		loadDeploymentStatusOracleMask: fixture.loadDeploymentStatusOracleMask,
		createQuestion: fixture.createQuestion,
		getQuestionId: fixture.getQuestionId,
		getLastPrice: fixture.getLastPrice,
		getQuestionEndDate: fixture.getQuestionEndDate,
		OperationType: fixture.OperationType,
		requestPriceIfNeededAndStageOperation: fixture.requestPriceIfNeededAndStageOperation,
		QuestionOutcome: fixture.QuestionOutcome,
		ensureDefined: fixture.ensureDefined,
		getQuestionOutcome: fixture.getQuestionOutcome,
		getEscalationGameDeposits: fixture.getEscalationGameDeposits,
		getNonDecisionThreshold: fixture.getNonDecisionThreshold,
		getQuestionResolution: fixture.getQuestionResolution,
		getStartBond: fixture.getStartBond,
		forkUniverse: fixture.forkUniverse,
		getZoltarAddress: fixture.getZoltarAddress,
		isIgnorableLogDecodeError: fixture.isIgnorableLogDecodeError,
		depositRep: fixture.depositRep,
		depositToEscalationGame: fixture.depositToEscalationGame,
		getPoolOwnershipDenominator: fixture.getPoolOwnershipDenominator,
		getRepToken: fixture.getRepToken,
		getTotalRepBalance: fixture.getTotalRepBalance,
		getActiveVaultCount: fixture.getActiveVaultCount,
		getActiveVaults: fixture.getActiveVaults,
		getSecurityPoolsEscalationGame: fixture.getSecurityPoolsEscalationGame,
		getSecurityVault: fixture.getSecurityVault,
		getVaultCount: fixture.getVaultCount,
		getVaults: fixture.getVaults,
		poolOwnershipToRep: fixture.poolOwnershipToRep,
		redeemRep: fixture.redeemRep,
		updateVaultFees: fixture.updateVaultFees,
		withdrawFromEscalationGame: fixture.withdrawFromEscalationGame,
		peripherals_EscalationGame_EscalationGame: fixture.peripherals_EscalationGame_EscalationGame,
		peripherals_factories_SecurityPoolFactory_SecurityPoolFactory: fixture.peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
		peripherals_tokens_ShareToken_ShareToken: fixture.peripherals_tokens_ShareToken_ShareToken,
		formatStorageSlot: fixture.formatStorageSlot,
		reportBond: fixture.reportBond,
		repDeposit: fixture.repDeposit,
		genesisUniverse: fixture.genesisUniverse,
		securityMultiplier: fixture.securityMultiplier,
		reportedRepEthPrice: fixture.reportedRepEthPrice,
		MAX_RETENTION_RATE: fixture.MAX_RETENTION_RATE,
		outcomes: fixture.outcomes,
		transferRepToAddress: fixture.transferRepToAddress,
		getVaultRepClaim: fixture.getVaultRepClaim,
		finalizeQuestionAsYesWithoutFork: fixture.finalizeQuestionAsYesWithoutFork,
		get mockWindow() {
			return fixture.mockWindow
		},
		get client() {
			return fixture.client
		},
		get securityPoolAddresses() {
			return fixture.securityPoolAddresses
		},
		get questionData() {
			return fixture.questionData
		},
		get questionId() {
			return fixture.questionId
		},
	}
}

export type PeripheralsVaultAccountingFixture = ReturnType<typeof usePeripheralsVaultAccountingFixture>
