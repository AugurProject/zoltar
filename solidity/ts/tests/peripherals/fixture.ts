import { beforeAll, beforeEach, setDefaultTimeout } from 'bun:test'
import assert from '../../testsuite/simulator/utils/assert'
import { decodeEventLog, encodeAbiParameters, keccak256 } from '@zoltar/shared/ethereum'
import type { Abi, Address, Hash } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../../testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../testsuite/simulator/useIsolatedAnvilNode'
import { sortBigIntsAscending } from '@zoltar/shared/bigInt'
import { REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT } from '@zoltar/shared/constants'
// The solidity worktree can temporarily see a stale @zoltar/shared package through the shared node_modules link during refreshes.
// Import the generated shared helper directly so this fixture stays stable across merge-validation runs.
import { pickFixtureProperties } from '../../../../shared/js/testing/pickFixtureProperties.js'
import { createWriteClient, WriteClient } from '../../testsuite/simulator/utils/clients'
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
import { createPeripheralsTruthAuctionScenarioHelpers } from './truthAuctionScenarioHelpers'
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
	updateCollateralAmount,
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
] as const satisfies Abi

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
] as const satisfies Abi

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
	const reportedRepEthPrice = 10n * 10n ** 18n
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
	const { finalizeQuestionAsYesWithoutFork, setupFinalizedTruthAuctionWithMixedBids, setupOwnForkWithEscrow, setupStartedTruthAuction, setupTruthAuctionWithMixedBids, setupTruthAuctionWithTwoWinningBids, triggerExternalForkForSecurityPool } = createPeripheralsTruthAuctionScenarioHelpers({
		genesisUniverse,
		getClient: () => client,
		getMockWindow: () => mockWindow,
		getOutcomes: () => outcomes,
		getQuestionData: () => questionData,
		getQuestionId: () => questionId,
		getSecurityPoolAddresses: () => securityPoolAddresses,
		repDeposit,
		reportBond,
		securityMultiplier,
		transferRepToAddress,
	})

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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
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
		updateCollateralAmount,
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
		setupStartedTruthAuction,
		setupOwnForkWithEscrow,
		setupTruthAuctionWithMixedBids,
		setupTruthAuctionWithTwoWinningBids,
		setupFinalizedTruthAuctionWithMixedBids,
	}
}

export function usePeripheralsDeploymentAndOwnForkEscalationFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'strictEqualTypeSafe',
		'decodeEventLog',
		'createWriteClient',
		'DAY',
		'GENESIS_REPUTATION_TOKEN',
		'TEST_ADDRESSES',
		'approveToken',
		'contractExists',
		'getChildUniverseId',
		'getERC20Balance',
		'sortStringArrayByKeccak',
		'addressString',
		'approveAndDepositRep',
		'manipulatePriceOracle',
		'manipulatePriceOracleAndPerformOperation',
		'triggerOwnGameFork',
		'deployOriginSecurityPool',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'createQuestion',
		'getQuestionId',
		'getQuestionEndDate',
		'OperationType',
		'QuestionOutcome',
		'SystemState',
		'createChildUniverse',
		'getMigratedRep',
		'getForkedEscrowChildRepByOutcomeAndVault',
		'getOwnForkRepBuckets',
		'getQuestionOutcome',
		'getSecurityPoolForkerForkData',
		'forkZoltarWithOwnEscalationGame',
		'claimForkedEscalationDeposits',
		'migrateRepToZoltar',
		'migrateVaultWithUnresolvedEscalation',
		'getEscalationGameOutcomeState',
		'forkUniverse',
		'getRepTokenAddress',
		'getTotalTheoreticalSupply',
		'getUniverseData',
		'getZoltarAddress',
		'depositRep',
		'depositToEscalationGame',
		'getPoolOwnershipDenominator',
		'getRepToken',
		'getSecurityPoolsEscalationGame',
		'getSecurityVault',
		'getSystemState',
		'poolOwnershipToRep',
		'peripherals_EscalationGame_EscalationGame',
		'peripherals_SecurityPoolForker_SecurityPoolForker',
		'test_peripherals_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness',
		'formatStorageSlot',
		'getMappingStorageSlot',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'MAX_RETENTION_RATE',
		'outcomes',
		'deployOwnForkEscalationClaimHarness',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionEndDate',
		'questionData',
		'questionId',
	] as const)
}

export type PeripheralsDeploymentAndOwnForkEscalationFixture = ReturnType<typeof usePeripheralsDeploymentAndOwnForkEscalationFixture>

export function usePeripheralsEscalationMigrationFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'approximatelyEqual',
		'strictEqualTypeSafe',
		'decodeEventLog',
		'encodeAbiParameters',
		'keccak256',
		'REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT',
		'createWriteClient',
		'DAY',
		'GENESIS_REPUTATION_TOKEN',
		'TEST_ADDRESSES',
		'approveToken',
		'contractExists',
		'getChildUniverseId',
		'getERC20Balance',
		'addressString',
		'approveAndDepositRep',
		'manipulatePriceOracleAndPerformOperation',
		'triggerOwnGameFork',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'createQuestion',
		'getQuestionId',
		'getQuestionEndDate',
		'OperationType',
		'QuestionOutcome',
		'SystemState',
		'ensureDefined',
		'createChildUniverse',
		'finalizeTruthAuction',
		'getForkedEscrowChildRepByOutcomeAndVault',
		'getForkedEscrowPrincipalByOutcomeAndVault',
		'getSecurityPoolForkerForkData',
		'forkZoltarWithOwnEscalationGame',
		'initiateSecurityPoolFork',
		'claimForkedEscalationDeposits',
		'migrateRepToZoltar',
		'migrateVault',
		'migrateVaultWithUnresolvedEscalation',
		'startTruthAuction',
		'getEscalationGameDeposits',
		'getEscalationGameOutcomeState',
		'getEscalationGameTotalCost',
		'getQuestionResolution',
		'forkUniverse',
		'getRepTokenAddress',
		'getTotalTheoreticalSupply',
		'getZoltarAddress',
		'getZoltarForkThreshold',
		'createCompleteSet',
		'depositRep',
		'depositToEscalationGame',
		'getCompleteSetCollateralAmount',
		'getRepToken',
		'getAwaitingForkContinuation',
		'getSecurityPoolsEscalationGame',
		'getSecurityVault',
		'getSystemState',
		'getTotalSecurityBondAllowance',
		'poolOwnershipToRep',
		'withdrawFromEscalationGame',
		'peripherals_EscalationGame_EscalationGame',
		'peripherals_SecurityPoolForker_SecurityPoolForker',
		'getMigrationProxyAddressAbi',
		'migrateVaultWithUnresolvedEscalationReturnAbi',
		'formatStorageSlot',
		'getMappingStorageSlot',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'outcomes',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionData',
		'questionId',
	] as const)
}

export type PeripheralsEscalationMigrationFixture = ReturnType<typeof usePeripheralsEscalationMigrationFixture>

export function usePeripheralsForkMigrationFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'approximatelyEqual',
		'strictEqual18Decimal',
		'strictEqualTypeSafe',
		'decodeEventLog',
		'sortBigIntsAscending',
		'REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT',
		'createWriteClient',
		'DAY',
		'GENESIS_REPUTATION_TOKEN',
		'TEST_ADDRESSES',
		'approveToken',
		'contractExists',
		'getChildUniverseId',
		'getERC20Balance',
		'getETHBalance',
		'addressString',
		'rpow',
		'approveAndDepositRep',
		'canLiquidate',
		'handleOracleReporting',
		'manipulatePriceOracle',
		'manipulatePriceOracleAndPerformOperation',
		'triggerOwnGameFork',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'createQuestion',
		'getQuestionId',
		'balanceOfShares',
		'balanceOfSharesInCash',
		'getEthRaiseCap',
		'getLastPrice',
		'getQuestionEndDate',
		'migrateShares',
		'OperationType',
		'participateAuction',
		'requestPriceIfNeededAndStageOperation',
		'getScalarOutcomeIndex',
		'tickToPrice',
		'QuestionOutcome',
		'SystemState',
		'ensureDefined',
		'claimAuctionProceeds',
		'createChildUniverse',
		'finalizeTruthAuction',
		'getMigratedRep',
		'getOwnForkRepBuckets',
		'getQuestionOutcome',
		'getSecurityPoolForkerForkData',
		'forkZoltarWithOwnEscalationGame',
		'initiateSecurityPoolFork',
		'claimForkedEscalationDeposits',
		'migrateRepToZoltar',
		'migrateVault',
		'startTruthAuction',
		'forkUniverse',
		'getRepTokenAddress',
		'getTotalTheoreticalSupply',
		'getZoltarAddress',
		'getZoltarForkThreshold',
		'getTotalRepPurchased',
		'createCompleteSet',
		'depositRep',
		'depositToEscalationGame',
		'getCompleteSetCollateralAmount',
		'getCurrentRetentionRate',
		'getPoolOwnershipDenominator',
		'getRepToken',
		'getShareTokenSupply',
		'getTotalRepBalance',
		'getSecurityPoolsEscalationGame',
		'getSecurityVault',
		'getSystemState',
		'getTotalFeesOwedToVaults',
		'getTotalSecurityBondAllowance',
		'poolOwnershipToRep',
		'redeemCompleteSet',
		'redeemFees',
		'redeemRep',
		'redeemShares',
		'sharesToCash',
		'updateCollateralAmount',
		'updateVaultFees',
		'withdrawFromEscalationGame',
		'peripherals_EscalationGame_EscalationGame',
		'peripherals_SecurityPoolForker_SecurityPoolForker',
		'peripherals_factories_SecurityPoolFactory_SecurityPoolFactory',
		'formatStorageSlot',
		'getMappingStorageSlot',
		'reportBond',
		'PRICE_PRECISION',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'MAX_RETENTION_RATE',
		'outcomes',
		'transferRepToAddress',
		'getVaultRepClaim',
		'finalizeQuestionAsYesWithoutFork',
		'triggerExternalForkForSecurityPool',
		'setupOwnForkWithEscrow',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionData',
		'questionId',
	] as const)
}

export type PeripheralsForkMigrationFixture = ReturnType<typeof usePeripheralsForkMigrationFixture>

export function usePeripheralsReceiveGuardsFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'strictEqualTypeSafe',
		'createWriteClient',
		'TEST_ADDRESSES',
		'getChildUniverseId',
		'getETHBalance',
		'manipulatePriceOracleAndPerformOperation',
		'triggerOwnGameFork',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'getQuestionEndDate',
		'OperationType',
		'QuestionOutcome',
		'migrateRepToZoltar',
		'migrateVault',
		'getTotalTheoreticalSupply',
		'createCompleteSet',
		'depositRep',
		'getRepToken',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'testInternalSenderBalance',
		'sendEthAndWait',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionId',
	] as const)
}

export type PeripheralsReceiveGuardsFixture = ReturnType<typeof usePeripheralsReceiveGuardsFixture>

export function usePeripheralsTruthAuctionFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'approximatelyEqual',
		'strictEqualTypeSafe',
		'decodeEventLog',
		'createWriteClient',
		'DAY',
		'GENESIS_REPUTATION_TOKEN',
		'TEST_ADDRESSES',
		'formatStorageSlot',
		'getMappingStorageSlot',
		'approveToken',
		'contractExists',
		'getChildUniverseId',
		'getERC20Balance',
		'getETHBalance',
		'addressString',
		'approveAndDepositRep',
		'handleOracleReporting',
		'manipulatePriceOracle',
		'manipulatePriceOracleAndPerformOperation',
		'triggerOwnGameFork',
		'deployOriginSecurityPool',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'createQuestion',
		'getQuestionId',
		'getEthRaiseCap',
		'getQuestionEndDate',
		'OperationType',
		'participateAuction',
		'requestPriceIfNeededAndStageOperation',
		'tickToPrice',
		'QuestionOutcome',
		'SystemState',
		'claimAuctionProceeds',
		'createChildUniverse',
		'finalizeTruthAuction',
		'getMigratedRep',
		'getOwnForkRepBuckets',
		'getQuestionOutcome',
		'getSecurityPoolForkerForkData',
		'initiateSecurityPoolFork',
		'claimForkedEscalationDeposits',
		'migrateRepToZoltar',
		'migrateVault',
		'settleAuctionBids',
		'startTruthAuction',
		'forkUniverse',
		'getMigrationRepBalance',
		'getRepTokenAddress',
		'getTotalTheoreticalSupply',
		'getZoltarAddress',
		'getTotalRepPurchased',
		'isIgnorableLogDecodeError',
		'createCompleteSet',
		'depositRep',
		'depositToEscalationGame',
		'getCompleteSetCollateralAmount',
		'getPoolOwnershipDenominator',
		'getRepToken',
		'getSecurityVault',
		'getSystemState',
		'getTotalFeesOwedToVaults',
		'getTotalSecurityBondAllowance',
		'getVaultCount',
		'poolOwnershipToRep',
		'redeemFees',
		'redeemRep',
		'updateVaultFees',
		'peripherals_SecurityPoolForker_SecurityPoolForker',
		'getMigrationProxyAddressAbi',
		'PRICE_PRECISION',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'MAX_RETENTION_RATE',
		'outcomes',
		'triggerExternalForkForSecurityPool',
		'setupStartedTruthAuction',
		'setupTruthAuctionWithMixedBids',
		'setupTruthAuctionWithTwoWinningBids',
		'setupFinalizedTruthAuctionWithMixedBids',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionData',
		'questionId',
	] as const)
}

export type PeripheralsTruthAuctionFixture = ReturnType<typeof usePeripheralsTruthAuctionFixture>

export function usePeripheralsVaultAccountingFixture() {
	const fixture = usePeripheralsTestFixture()
	return pickFixtureProperties(fixture, [
		'assert',
		'approximatelyEqual',
		'strictEqualTypeSafe',
		'decodeEventLog',
		'REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT',
		'createWriteClient',
		'DAY',
		'GENESIS_REPUTATION_TOKEN',
		'TEST_ADDRESSES',
		'approveToken',
		'getERC20Balance',
		'ensureProxyDeployerDeployed',
		'setupTestAccounts',
		'addressString',
		'approveAndDepositRep',
		'manipulatePriceOracle',
		'manipulatePriceOracleAndPerformOperation',
		'deployOriginSecurityPool',
		'ensureDeploymentStatusOracleDeployed',
		'getAnvilWindowEthereum',
		'setBaselineSnapshot',
		'initializePeripheralsBaseline',
		'getDeploymentStatusOracleAddress',
		'getDeploymentStepAddresses',
		'getInfraContractAddresses',
		'getSecurityPoolAddresses',
		'loadDeploymentStatusOracleMask',
		'createQuestion',
		'getQuestionId',
		'getLastPrice',
		'getQuestionEndDate',
		'OperationType',
		'requestPriceIfNeededAndStageOperation',
		'QuestionOutcome',
		'ensureDefined',
		'getQuestionOutcome',
		'getEscalationGameDeposits',
		'getNonDecisionThreshold',
		'getQuestionResolution',
		'getStartBond',
		'forkUniverse',
		'getZoltarAddress',
		'isIgnorableLogDecodeError',
		'depositRep',
		'depositToEscalationGame',
		'getPoolOwnershipDenominator',
		'getRepToken',
		'getTotalRepBalance',
		'getActiveVaultCount',
		'getActiveVaults',
		'getSecurityPoolsEscalationGame',
		'getSecurityVault',
		'getVaultCount',
		'getVaults',
		'poolOwnershipToRep',
		'redeemRep',
		'updateVaultFees',
		'withdrawFromEscalationGame',
		'peripherals_EscalationGame_EscalationGame',
		'peripherals_factories_SecurityPoolFactory_SecurityPoolFactory',
		'peripherals_tokens_ShareToken_ShareToken',
		'formatStorageSlot',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'securityMultiplier',
		'reportedRepEthPrice',
		'MAX_RETENTION_RATE',
		'outcomes',
		'transferRepToAddress',
		'getVaultRepClaim',
		'finalizeQuestionAsYesWithoutFork',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionData',
		'questionId',
	] as const)
}

export type PeripheralsVaultAccountingFixture = ReturnType<typeof usePeripheralsVaultAccountingFixture>
