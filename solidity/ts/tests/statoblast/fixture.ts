import { beforeAll, beforeEach } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import type { Abi, Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { AnvilWindowEthereum } from '../../testSupport/simulator/AnvilWindowEthereum'
import { useIsolatedAnvilNode } from '../../testSupport/simulator/useIsolatedAnvilNode'

import { pickFixtureProperties } from '../../testSupport/pickFixtureProperties'
import { createWriteClient, WriteClient } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { setupTestAccounts } from '../../testSupport/simulator/utils/utilities'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { approveAndDepositRepToVault } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { deployOriginSecurityPool, ensureInfraDeployed, getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { createQuestion, getQuestionId } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'

import { ensureZoltarDeployed, getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'

import { createStatoblastTruthAuctionScenarioHelpers } from './truthAuctionScenarioHelpers'
import { getSecurityVault, backingUnitsToAttoRep } from '../../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, test_statoblast_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness } from '../../types/contractArtifact'

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

function formatStorageSlot(slot: bigint) {
	return `0x${slot.toString(16).padStart(64, '0')}`
}

function getMappingStorageSlot(key: Address, mappingSlot: bigint) {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [key, mappingSlot])))
}

function useStatoblastTestFixture() {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	const reportBond = 11n * 10n ** 17n
	const PRICE_PRECISION = 1n * 10n ** 18n
	const repDeposit = 10_000n * 10n ** 18n
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
	const statoblastSecurityMultiplierBps = 20_000n
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
			data: `0x${test_statoblast_OwnForkEscalationClaimHarness_OwnForkEscalationClaimHarness.evm.bytecode.object}`,
		})
		const receipt = await client.waitForTransactionReceipt({ hash: deploymentHash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === undefined) throw new Error('deployment address missing')
		return contractAddress
	}

	const getVaultRepClaim = async (vaultAddress: Address) => {
		const vault = await getSecurityVault(client, securityPoolAddresses.securityPool, vaultAddress)
		return await backingUnitsToAttoRep(client, securityPoolAddresses.securityPool, vault.repBackingUnits)
	}
	const { finalizeQuestionAsYesWithoutFork, setupFinalizedTruthAuctionWithMixedBids, setupOwnForkWithEscrow, setupStartedTruthAuction, setupTruthAuctionWithMixedBids, setupTruthAuctionWithTwoWinningBids, triggerExternalForkForSecurityPool } = createStatoblastTruthAuctionScenarioHelpers({
		genesisUniverse,
		getClient: () => client,
		getMockWindow: () => mockWindow,
		getOutcomes: () => outcomes,
		getQuestionData: () => questionData,
		getQuestionId: () => questionId,
		getSecurityPoolAddresses: () => securityPoolAddresses,
		repDeposit,
		reportBond,
		statoblastSecurityMultiplierBps,
		transferRepToAddress,
	})

	const initializeStatoblastBaseline = async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		const factory = getInfraContractAddresses().securityPoolFactory
		const originId = await client.readContract({
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'getOriginId',
			address: factory,
			args: [genesisUniverse, questionId, statoblastSecurityMultiplierBps, 10n * 10n ** 9n],
		})
		const registeredPool = await client.readContract({
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'getSecurityPool',
			address: factory,
			args: [originId, genesisUniverse],
		})
		const expectedPool = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
		assert.strictEqual(registeredPool, expectedPool, 'origin security pool address derivation should match the lineage registry')
		await approveAndDepositRepToVault(client, repDeposit, questionId)
		securityPoolAddresses = getSecurityPoolAddresses(addressString(0x0n), genesisUniverse, questionId, statoblastSecurityMultiplierBps)
	}

	beforeAll(async () => {
		await initializeStatoblastBaseline()
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0])
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
		initializeStatoblastBaseline,
		getMigrationProxyAddressAbi,
		formatStorageSlot,
		getMappingStorageSlot,
		reportBond,
		PRICE_PRECISION,
		repDeposit,
		genesisUniverse,
		statoblastSecurityMultiplierBps,
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

export function useStatoblastDeploymentAndOwnForkEscalationFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, [
		'formatStorageSlot',
		'getMappingStorageSlot',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'statoblastSecurityMultiplierBps',
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

export type StatoblastDeploymentAndOwnForkEscalationFixture = ReturnType<typeof useStatoblastDeploymentAndOwnForkEscalationFixture>

export function useStatoblastEscalationMigrationFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, ['getMigrationProxyAddressAbi', 'formatStorageSlot', 'getMappingStorageSlot', 'reportBond', 'repDeposit', 'genesisUniverse', 'statoblastSecurityMultiplierBps', 'outcomes', 'mockWindow', 'client', 'securityPoolAddresses', 'questionData', 'questionId'] as const)
}

export type StatoblastEscalationMigrationFixture = ReturnType<typeof useStatoblastEscalationMigrationFixture>

export function useStatoblastForkMigrationFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, [
		'getMigrationProxyAddressAbi',
		'formatStorageSlot',
		'getMappingStorageSlot',
		'reportBond',
		'PRICE_PRECISION',
		'repDeposit',
		'genesisUniverse',
		'statoblastSecurityMultiplierBps',
		'MAX_RETENTION_RATE',
		'outcomes',
		'transferRepToAddress',
		'getVaultRepClaim',
		'finalizeQuestionAsYesWithoutFork',
		'setupFinalizedTruthAuctionWithMixedBids',
		'triggerExternalForkForSecurityPool',
		'setupOwnForkWithEscrow',
		'mockWindow',
		'client',
		'securityPoolAddresses',
		'questionData',
		'questionId',
	] as const)
}

export type StatoblastForkMigrationFixture = ReturnType<typeof useStatoblastForkMigrationFixture>

export function useStatoblastReceiveGuardsFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, ['repDeposit', 'genesisUniverse', 'statoblastSecurityMultiplierBps', 'testInternalSenderBalance', 'sendEthAndWait', 'mockWindow', 'client', 'securityPoolAddresses', 'questionId'] as const)
}

export type StatoblastReceiveGuardsFixture = ReturnType<typeof useStatoblastReceiveGuardsFixture>

export function useStatoblastTruthAuctionFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, [
		'formatStorageSlot',
		'getMappingStorageSlot',
		'getMigrationProxyAddressAbi',
		'PRICE_PRECISION',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'statoblastSecurityMultiplierBps',
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

export type StatoblastTruthAuctionFixture = ReturnType<typeof useStatoblastTruthAuctionFixture>

export function useStatoblastVaultAccountingFixture() {
	const fixture = useStatoblastTestFixture()
	return pickFixtureProperties(fixture, [
		'getAnvilWindowEthereum',
		'setBaselineSnapshot',
		'initializeStatoblastBaseline',
		'formatStorageSlot',
		'reportBond',
		'repDeposit',
		'genesisUniverse',
		'statoblastSecurityMultiplierBps',
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

export type StatoblastVaultAccountingFixture = ReturnType<typeof useStatoblastVaultAccountingFixture>
