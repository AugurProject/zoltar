/// <reference types="bun-types" />

import { beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, zeroAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import {
	createOpenOracleReportInstance,
	executeOracleManagerStagedOperation,
	getOpenOracleAddress,
	loadCoordinatorInitialReportFundingRequirement,
	loadErc20Balance,
	loadOpenOracleReportDetails,
	loadOpenOracleReportSummaries,
	loadOracleManagerDetails,
	queueOracleManagerOperation,
	requestOraclePrice,
	settleOracleReport,
	submitInitialOracleReport,
	wrapWeth as wrapUiWeth,
} from '../../../protocol/index.js'
import {
	addOpenOracleBountyBuffer,
	deriveOpenOracleDisputeSubmissionDetails,
	deriveOpenOracleInitialReportSubmissionDetails,
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleFeePercentage,
	formatOpenOracleFeePercentageInput,
	formatOpenOracleInitialReportApprovalStatusUnavailableMessage,
	formatOpenOracleInitialReportBalanceStatusUnavailableMessage,
	formatOpenOracleInitialReportPriceUnavailableMessage,
	formatOpenOracleInitialReportWriteErrorMessage,
	formatOpenOracleMultiplier,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateValidationMessage,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	loadOpenOracleInitialReportPrice,
	loadOpenOracleInitialReportPriceResult,
	parseOpenOracleCreateFormSubmission,
	parseOpenOracleFeePercentageInput,
} from '../../../features/open-oracle/lib/openOracle.js'
import { getDefaultOpenOracleCreateFormState } from '../../../features/markets/lib/marketForm.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../../../features/security-pools/lib/securityVault.js'
import { createConnectedReadClient, createWalletWriteClient } from '../../../lib/clients.js'
import { ETH_ADDRESS, REP_ADDRESS, USDC_ADDRESS } from '../../../protocol/uniswapQuoter.js'
import type { InjectedEthereum } from '../../../injectedEthereum.js'
import type { WriteContractClient } from '../../../protocol/core.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS, TEST_ADDRESSES } from '../../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addressString } from '../../../../../solidity/ts/testSupport/simulator/utils/bigint'
import { approveToken, setupTestAccounts, ensureProxyDeployerDeployed } from '../../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getOpenOracleExtraData, getRequestPriceEthCost, OperationType, requestPriceIfNeededAndStageOperation, requestPriceWithValue, wrapWeth as wrapWethTestHelper } from '../../../../../solidity/ts/testSupport/simulator/utils/contracts/peripherals'

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum, accountAddress: Address = addressString(TEST_ADDRESSES[0])) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) globalWindow.window = globalThis as Window & typeof globalThis
	const request: InjectedEthereum['request'] = async args => {
		if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [accountAddress] as never
		if (args.method === 'eth_chainId') return '0x1' as never
		return (await mockWindow.request(args)) as never
	}
	const injectedEthereum: InjectedEthereum = {
		on: mockWindow.on,
		removeListener: mockWindow.removeListener,
		request,
	}
	globalWindow.window.ethereum = injectedEthereum
}

const genesisUniverse = 0n
const securityMultiplier = 2n
const DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
const outcomes = ['Yes', 'No']

function createSuccessfulReceipt(hash: Hash, managerAddress: Address) {
	return {
		status: 'success',
		blockHash: '0x0',
		blockNumber: 0n,
		contractAddress: null,
		cumulativeGasUsed: 0n,
		from: getAddress('0x00000000000000000000000000000000000000a1'),
		gasUsed: 0n,
		logs: [],
		logsBloom: '0x',
		to: managerAddress,
		transactionHash: hash,
		transactionIndex: 0n,
		type: 'eip1559',
	} as never
}

function createQuoteClient(amountOut: bigint): Parameters<typeof loadOpenOracleInitialReportPrice>[0] {
	const client = createConnectedReadClient()
	const simulateContract: Parameters<typeof loadOpenOracleInitialReportPrice>[0]['simulateContract'] = async () => ({ result: [amountOut, 100000n], request: {} as never }) as never
	client.simulateContract = simulateContract
	return client
}

function createFailingQuoteClient(message: string): Parameters<typeof loadOpenOracleInitialReportPrice>[0] {
	const client = createConnectedReadClient()
	const simulateContract: Parameters<typeof loadOpenOracleInitialReportPrice>[0]['simulateContract'] = async () => {
		throw new Error(message)
	}
	client.simulateContract = simulateContract
	return client
}

function createInitialReportSubmissionPreview(overrides: Partial<Parameters<typeof deriveOpenOracleInitialReportSubmissionDetails>[0]> = {}) {
	return deriveOpenOracleInitialReportSubmissionDetails({
		approvedToken1Amount: 100n,
		approvedToken2Amount: 25n,
		defaultPrice: '4.0',
		defaultPriceError: undefined,
		defaultPriceSource: 'Uniswap V4',
		defaultPriceSourceUrl: 'https://app.uniswap.org/explore/pools/ethereum/0xpool',
		priceInput: '',
		quoteAttemptedSources: undefined,
		quoteFailureReason: undefined,
		reportDetails: {
			currentReporter: zeroAddress,
			disputeOccurred: false,
			exactToken1Report: 100n,
			isDistributed: false,
			reportTimestamp: 0n,
			token1: REP_ADDRESS,
			token1Symbol: 'REP',
			token2: WETH_ADDRESS,
			token2Symbol: 'WETH',
		},
		token1AllowanceError: undefined,
		token1Balance: 100n,
		token1BalanceError: undefined,
		token1Decimals: 0,
		token2AllowanceError: undefined,
		token2Balance: 25n,
		token2BalanceError: undefined,
		token2Decimals: 0,
		walletEthBalance: 10n,
		...overrides,
	})
}

function createOpenOracleLifecycleReport(
	overrides: Partial<{
		currentBlockNumber: bigint
		currentReporter: Address
		currentTime: bigint
		disputeDelay: bigint
		disputeOccurred: boolean
		isDistributed: boolean
		reportTimestamp: bigint
		settlementTime: bigint
		timeType: boolean
	}> = {},
) {
	return {
		currentBlockNumber: 0n,
		currentReporter: getAddress(addressString(TEST_ADDRESSES[1])),
		currentTime: 0n,
		disputeDelay: 10n,
		disputeOccurred: false,
		isDistributed: false,
		reportTimestamp: 100n,
		settlementTime: 60n,
		timeType: true,
		...overrides,
	}
}

function createDisputeSubmissionPreview(overrides: Partial<Parameters<typeof deriveOpenOracleDisputeSubmissionDetails>[0]> = {}) {
	return deriveOpenOracleDisputeSubmissionDetails({
		approvedToken1Amount: 1_000n,
		approvedToken2Amount: 1_000n,
		disputeNewAmount1Input: '200',
		disputeNewAmount2Input: '80',
		disputeTokenToSwap: 'token1',
		reportDetails: {
			currentAmount1: 100n,
			currentAmount2: 50n,
			currentBlockNumber: 0n,
			currentReporter: getAddress(addressString(TEST_ADDRESSES[1])),
			currentTime: 200n,
			disputeDelay: 10n,
			escalationHalt: 200n,
			feePercentage: 1_000_000n,
			isDistributed: false,
			multiplier: 20_000n,
			protocolFee: 500_000n,
			reportTimestamp: 100n,
			settlementTime: 200n,
			timeType: true,
			token1: REP_ADDRESS,
			token1Symbol: 'REP',
			token2: WETH_ADDRESS,
			token2Symbol: 'WETH',
		},
		token1AllowanceError: undefined,
		token1Balance: 1_000n,
		token1BalanceError: undefined,
		token1Decimals: 0,
		token2AllowanceError: undefined,
		token2Balance: 1_000n,
		token2BalanceError: undefined,
		token2Decimals: 0,
		...overrides,
	})
}

describe('Open Oracle helpers', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	let managerAddress: Address

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		installInjectedEthereum(mockWindow)
		uiReadClient = createConnectedReadClient()
		uiWriteClient = createWalletWriteClient(addressString(TEST_ADDRESSES[0]))
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: 'Test question for Open Oracle',
			description: '',
			startTime: 0n,
			endTime: currentTimestamp + 365n * DAY,
			numTicks: 0n,
			displayValueMin: 0n,
			displayValueMax: 0n,
			answerUnit: '',
		}
		const questionId = getQuestionId(questionData, outcomes)
		await createQuestion(client, questionData, outcomes)
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier)
		managerAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		installInjectedEthereum(mockWindow)
		uiReadClient = createConnectedReadClient()
		uiWriteClient = createWalletWriteClient(addressString(TEST_ADDRESSES[0]))
	})

	test('getOpenOracleAddress returns the deterministic non-zero oracle address', () => {
		expect(getOpenOracleAddress()).not.toBe(zeroAddress)
	})

	test('executeOracleManagerStagedOperation forwards an explicit gas limit', async () => {
		const stagedOperationManagerAddress = getAddress('0x00000000000000000000000000000000000000b1')
		const hash = `0x${'1'.repeat(64)}` as Hash
		const sentTransactions: Array<{ gas: bigint | undefined; to: Address | undefined }> = []

		const writeClient = {
			sendTransaction: async ({ gas, to }) => {
				sentTransactions.push({ gas, to: typeof to === 'string' ? to : undefined })
				return hash
			},
			waitForTransactionReceipt: async () => createSuccessfulReceipt(hash, stagedOperationManagerAddress),
		} satisfies WriteContractClient

		const result = await executeOracleManagerStagedOperation(writeClient, stagedOperationManagerAddress, 7n)

		expect(sentTransactions).toEqual([
			{
				gas: 5_000_000n,
				to: stagedOperationManagerAddress,
			},
		])
		expect(result).toEqual({
			action: 'executeStagedOperation',
			hash,
		})
	})

	test('createOpenOracleReportInstance creates a browsable report and browse ordering is newest-first', async () => {
		const createResult1 = await createOpenOracleReportInstance(uiWriteClient, {
			disputeDelay: 10,
			escalationHalt: 0n,
			exactToken1Report: 1n,
			ethValue: 1_100n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerReward: 1_000n,
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		})
		expect(createResult1.action).toBe('createReportInstance')

		const createResult2 = await createOpenOracleReportInstance(uiWriteClient, {
			disputeDelay: 10,
			escalationHalt: 0n,
			exactToken1Report: 2n,
			ethValue: 1_200n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerReward: 1_100n,
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		})
		expect(createResult2.action).toBe('createReportInstance')

		const page = await loadOpenOracleReportSummaries(uiReadClient, 0, 1)
		expect(page.reportCount).toBe(2n)
		expect(page.reports).toHaveLength(1)
		const newestReport = page.reports[0]
		if (newestReport === undefined) throw new Error('Expected a newest report summary')
		expect(newestReport.reportId).toBe(2n)
		expect(getOpenOracleReportStatus(newestReport)).toBe('Awaiting Initial Report')

		const firstPage = await loadOpenOracleReportSummaries(uiReadClient, 0, 10)
		expect(firstPage.reports.map(report => report.reportId)).toEqual([2n, 1n])
		expect(firstPage.reports.map(report => report.price)).toEqual([0n, 0n])
	})

	test('createOpenOracleReportInstance rejects numeric parameters above Number.MAX_SAFE_INTEGER', async () => {
		await expect(
			createOpenOracleReportInstance(uiWriteClient, {
				disputeDelay: Number.MAX_SAFE_INTEGER + 1,
				escalationHalt: 0n,
				exactToken1Report: 1n,
				ethValue: 1_100n,
				feePercentage: 100,
				multiplier: 100,
				protocolFee: 100,
				settlementTime: 60,
				settlerReward: 1_000n,
				token1Address: addressString(GENESIS_REPUTATION_TOKEN),
				token2Address: WETH_ADDRESS,
			}),
		).rejects.toThrow('Dispute delay exceeds the maximum safe integer range')
	})

	test('createOpenOracleReportInstance rejects invalid direct configs before preparing a wallet write', async () => {
		let preparedCount = 0
		const writeClientWithPrepareSpy = createWalletWriteClient(addressString(TEST_ADDRESSES[0]), {
			onTransactionPrepared: () => {
				preparedCount += 1
			},
		})

		await expect(
			createOpenOracleReportInstance(writeClientWithPrepareSpy, {
				disputeDelay: 10,
				escalationHalt: 0n,
				exactToken1Report: 1n,
				ethValue: 1_100n,
				feePercentage: 100,
				multiplier: 65_536,
				protocolFee: 100,
				settlementTime: 60,
				settlerReward: 1_000n,
				token1Address: addressString(GENESIS_REPUTATION_TOKEN),
				token2Address: WETH_ADDRESS,
			}),
		).rejects.toThrow('Multiplier exceeds the contract maximum.')
		expect(preparedCount).toBe(0)
	})

	test('initial report price helpers derive a Uniswap default price and preserve quote failure metadata', async () => {
		const quote = await loadOpenOracleInitialReportPrice(createQuoteClient(25n), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)
		expect(quote).toEqual({
			price: 4_000_000_000_000_000_000_000_000_000_000n,
			priceSource: 'Uniswap V4',
			token2Amount: 25n,
		})

		const failure = await loadOpenOracleInitialReportPriceResult(createFailingQuoteClient('no pool'), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)
		expect(failure).toEqual({
			attemptedSources: ['Uniswap V4', 'Uniswap V3'],
			failureKind: 'quote-failed',
			reason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no pool. Uniswap V3 quote failed: no pool',
			status: 'failure',
		})
		await expect(loadOpenOracleInitialReportPrice(createFailingQuoteClient('no pool'), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)).rejects.toThrow(
			'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no pool. Uniswap V3 quote failed: no pool',
		)
	})

	test('initial report price helpers report both Uniswap V4 and V3 failures when fallback was attempted', async () => {
		let callCount = 0
		const failingClient = createConnectedReadClient()
		const simulateContract: Parameters<typeof loadOpenOracleInitialReportPrice>[0]['simulateContract'] = async () => {
			callCount += 1
			throw new Error(callCount <= 4 ? 'no v4 pool' : 'v3 quote reverted')
		}
		failingClient.simulateContract = simulateContract

		await expect(loadOpenOracleInitialReportPrice(failingClient, REP_ADDRESS, ETH_ADDRESS, 100n)).rejects.toThrow('Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v4 pool. Uniswap V3 quote failed: v3 quote reverted')
	})

	test('initial report price helpers use Uniswap V3 for REP/WETH pairs when V4 is unavailable', async () => {
		let callCount = 0
		const fallbackClient = createConnectedReadClient()
		const simulateContract: Parameters<typeof loadOpenOracleInitialReportPrice>[0]['simulateContract'] = async () => {
			callCount += 1
			if (callCount <= 4) throw new Error('no v4 pool')
			return { result: [200_000_000_000_000_000n, 0n, 0, 0n], request: {} as never } as never
		}
		fallbackClient.simulateContract = simulateContract

		await expect(loadOpenOracleInitialReportPrice(fallbackClient, REP_ADDRESS, WETH_ADDRESS, 100n * 10n ** 18n)).resolves.toEqual({
			price: 500_000_000_000_000_000_000_000_000_000_000n,
			priceSource: 'Uniswap V3',
			token2Amount: 200_000_000_000_000_000n,
		})
	})

	test('initial report price helpers use Uniswap V3 for non-REP pairs when V4 is unavailable', async () => {
		let callCount = 0
		const fallbackClient = createConnectedReadClient()
		const simulateContract: Parameters<typeof loadOpenOracleInitialReportPrice>[0]['simulateContract'] = async () => {
			callCount += 1
			if (callCount <= 4) throw new Error('no v4 pool')
			return { result: [50n, 0n, 0, 0n], request: {} as never } as never
		}
		fallbackClient.simulateContract = simulateContract

		await expect(loadOpenOracleInitialReportPrice(fallbackClient, USDC_ADDRESS, WETH_ADDRESS, 100n)).resolves.toEqual({
			price: 2_000_000_000_000_000_000_000_000_000_000n,
			priceSource: 'Uniswap V3',
			token2Amount: 50n,
		})
	})

	test('initial report submission helper computes preview amounts and approval gating', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken2Amount: 24n,
		})

		expect(preview.priceSource).toBe('Uniswap V4')
		expect(preview.priceSourceUrl).toBe('https://app.uniswap.org/explore/pools/ethereum/0xpool')
		expect(preview.price).toBe(4_000_000_000_000_000_000_000_000_000_000n)
		expect(preview.amount1).toBe(100n)
		expect(preview.amount2).toBe(25n)
		expect(preview.token2Approval.neededAmount).toBe(1n)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'WETH approval required',
		})
	})

	test('dispute submission helper computes token contributions across both swap directions', () => {
		const cases = [
			{ disputeTokenToSwap: 'token1' as const, expectedToken1Contribution: 315n, expectedToken2Contribution: 30n },
			{ disputeTokenToSwap: 'token2' as const, expectedToken1Contribution: 100n, expectedToken2Contribution: 137n },
		]

		for (const testCase of cases) {
			const preview = createDisputeSubmissionPreview({
				disputeTokenToSwap: testCase.disputeTokenToSwap,
				reportDetails: {
					currentAmount1: 100n,
					currentAmount2: 50n,
					currentBlockNumber: 0n,
					currentReporter: getAddress(addressString(TEST_ADDRESSES[1])),
					currentTime: 200n,
					disputeDelay: 10n,
					escalationHalt: 200n,
					feePercentage: 1_000_000n,
					isDistributed: false,
					multiplier: 20_000n,
					protocolFee: 500_000n,
					reportTimestamp: 100n,
					settlementTime: 200n,
					timeType: true,
					token1: REP_ADDRESS,
					token1Symbol: 'REP',
					token2: WETH_ADDRESS,
					token2Symbol: 'WETH',
				},
			})

			expect(preview.expectedNewAmount1).toBe(200n)
			expect(preview.token1ContributionAmount).toBe(testCase.expectedToken1Contribution)
			expect(preview.token2ContributionAmount).toBe(testCase.expectedToken2Contribution)
			expect(preview.canSubmit).toBe(true)
		}
	})

	test('initial report submission helper hides the automatic quote loading state', () => {
		const preview = createInitialReportSubmissionPreview({
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: undefined,
			quoteFailureReason: undefined,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'hidden-loading',
			message: 'Loading automatic price quote.',
		})
	})

	test('initial report submission helper explains exhausted quote paths with a short reason', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken2Amount: 100n,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: ['Uniswap V4', 'Uniswap V3'],
			quoteFailureReason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: execution reverted for an unknown reason. Uniswap V3 quote failed: no pool',
			reportDetails: {
				currentReporter: zeroAddress,
				disputeOccurred: false,
				exactToken1Report: 100n,
				isDistributed: false,
				reportTimestamp: 0n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: ETH_ADDRESS,
				token2Symbol: 'ETH',
			},
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Automatic price quote unavailable for REP / ETH. Tried: Uniswap V4, then Uniswap V3. Reason: Uniswap V4 quote failed: execution reverted for an unknown reason. Uniswap V3 quote failed: no pool. Enter a price manually to submit the initial report.',
		})
	})

	test('manual price entry overrides automatic quote unavailability', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken2Amount: 24n,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '4.0',
			quoteAttemptedSources: ['Uniswap V4'],
			quoteFailureReason: 'no pool',
			reportDetails: {
				currentReporter: zeroAddress,
				disputeOccurred: false,
				exactToken1Report: 100n,
				isDistributed: false,
				reportTimestamp: 0n,
				token1: getAddress('0x00000000000000000000000000000000000000a1'),
				token1Symbol: 'ABC',
				token2: getAddress('0x00000000000000000000000000000000000000a2'),
				token2Symbol: 'XYZ',
			},
		})

		expect(preview.priceSource).toBe('Manual override')
		expect(preview.price).toBe(4_000_000_000_000_000_000_000_000_000_000n)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'XYZ approval required',
		})
	})

	test('initial report submission helper surfaces the fetch price failure reason when no default price is available', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken2Amount: 100n,
			defaultPrice: undefined,
			defaultPriceError: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 quote failed: no v3 pool',
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: ['Uniswap V4', 'Uniswap V3'],
			quoteFailureReason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 quote failed: no v3 pool',
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 quote failed: no v3 pool',
		})
	})

	test('formats unavailable price messages with sanitized reasons and address fallback labels', () => {
		expect(
			formatOpenOracleInitialReportPriceUnavailableMessage({
				attemptedSources: ['Uniswap V4'],
				reason: 'Failed to load automatic price: execution reverted: pool not found',
				token1Label: undefined,
				token2Label: '0x00000000000000000000000000000000000000a2',
			}),
		).toBe('Automatic price quote unavailable for Token1 / 0x00000000000000000000000000000000000000a2. Tried: Uniswap V4. Reason: pool not found. Enter a price manually to submit the initial report.')
	})

	test('initial report submission helper surfaces allowance read failures separately from approval gating', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken1Amount: undefined,
			token1AllowanceError: 'Failed to load token approval: request timed out',
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Unable to verify REP approval before submitting the initial report. Reason: request timed out. Retry loading the approval status before continuing.',
		})
	})

	test('initial report submission helper surfaces balance read failures separately from approval gating', () => {
		const preview = createInitialReportSubmissionPreview({
			token2Balance: undefined,
			token2BalanceError: 'Failed to load token balance: request timed out',
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Unable to verify WETH balance for this report. Reason: request timed out. Retry loading the report or balance status before submitting the initial report.',
		})
	})

	test('initial report submission helper hides token balance loading states such as REPv2 balance refresh', () => {
		const preview = createInitialReportSubmissionPreview({
			reportDetails: {
				currentReporter: zeroAddress,
				disputeOccurred: false,
				exactToken1Report: 100n,
				isDistributed: false,
				reportTimestamp: 0n,
				token1: REP_ADDRESS,
				token1Symbol: 'REPv2',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
			token1Balance: undefined,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'hidden-loading',
			message: 'Loading current REPv2 balance.',
		})
	})

	test('initial report submission helper hides token approval loading states', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken1Amount: undefined,
			token1AllowanceError: undefined,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'hidden-loading',
			message: 'Loading current REP approval.',
		})
	})

	test('initial report submission helper surfaces token-specific insufficient token1 balances', () => {
		const preview = createInitialReportSubmissionPreview({
			token1Balance: 99n,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Insufficient REP balance for this report. Need 100, wallet has 99.',
		})
	})

	test('initial report submission helper disables submit for tiny insufficient REP balances', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken1Amount: 11_000_000n,
			approvedToken2Amount: 11_000_000n,
			defaultPrice: '1',
			reportDetails: {
				currentReporter: zeroAddress,
				disputeOccurred: false,
				exactToken1Report: 11_000_000n,
				isDistributed: false,
				reportTimestamp: 0n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
			token1Balance: 10_000_000n,
			token1Decimals: 18,
			token2Balance: 11_000_000n,
			token2Decimals: 18,
			walletEthBalance: 0n,
		})

		expect(preview.amount1).toBe(11_000_000n)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Insufficient REP balance for this report. Need 0.000000000011, wallet has 0.00000000001.',
		})
	})

	test('initial report submission helper surfaces insufficient WETH balances and exposes wrap details', () => {
		const preview = createInitialReportSubmissionPreview({
			token2Balance: 24n,
			walletEthBalance: 10n,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Insufficient WETH balance for this report. Need 25, wallet has 24. Wrap ETH into WETH first.',
		})
		expect(preview.hasWethWrapAction).toBe(true)
		expect(preview.requiredWethWrapAmount).toBe(1n)
		expect(preview.canWrapRequiredWeth).toBe(true)
		expect(preview.wrapRequiredWethMessage).toBeUndefined()
	})

	test('initial report submission helper disables submit for tiny insufficient WETH balances', () => {
		const preview = createInitialReportSubmissionPreview({
			approvedToken1Amount: 11_000_000n,
			approvedToken2Amount: 11_000_000n,
			defaultPrice: '1',
			reportDetails: {
				currentReporter: zeroAddress,
				disputeOccurred: false,
				exactToken1Report: 11_000_000n,
				isDistributed: false,
				reportTimestamp: 0n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
			token1Balance: 11_000_000n,
			token1Decimals: 18,
			token2Balance: 10_000_000n,
			token2Decimals: 18,
			walletEthBalance: 1_000_000n,
		})

		expect(preview.amount2).toBe(11_000_000n)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'Insufficient WETH balance for this report. Need 0.000000000011, wallet has 0.00000000001. Wrap ETH into WETH first.',
		})
		expect(preview.requiredWethWrapAmount).toBe(1_000_000n)
		expect(preview.canWrapRequiredWeth).toBe(true)
	})

	test('initial report submission helper reports when wallet ETH is insufficient to wrap the required WETH', () => {
		const preview = createInitialReportSubmissionPreview({
			token2Balance: 24n,
			walletEthBalance: 0n,
		})

		expect(preview.requiredWethWrapAmount).toBe(1n)
		expect(preview.canWrapRequiredWeth).toBe(false)
		expect(preview.wrapRequiredWethMessage).toEqual({
			kind: 'visible',
			message: 'Wallet has 0 ETH, need 0.000000000000000001 ETH to wrap the required WETH.',
		})
	})

	test('initial report submission helper reports when wallet ETH balance is still loading for WETH wrap', () => {
		const preview = createInitialReportSubmissionPreview({
			token2Balance: 24n,
			walletEthBalance: undefined,
		})

		expect(preview.requiredWethWrapAmount).toBe(1n)
		expect(preview.canWrapRequiredWeth).toBe(false)
		expect(preview.wrapRequiredWethMessage).toEqual({
			kind: 'hidden-loading',
			message: 'Loading wallet ETH balance.',
		})
	})

	test('initial report submission helper keeps the WETH wrap action visible when no top-up is needed', () => {
		const preview = createInitialReportSubmissionPreview()

		expect(preview.hasWethWrapAction).toBe(true)
		expect(preview.requiredWethWrapAmount).toBeUndefined()
		expect(preview.canWrapRequiredWeth).toBe(false)
		expect(preview.wrapRequiredWethMessage).toBeUndefined()
	})

	test('initial report submission helper explains that a price is needed before determining a WETH wrap amount', () => {
		const preview = createInitialReportSubmissionPreview({
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			defaultPriceSourceUrl: undefined,
			priceInput: '',
			quoteAttemptedSources: ['Uniswap V4'],
			quoteFailureReason: 'no pool',
		})

		expect(preview.hasWethWrapAction).toBe(true)
		expect(preview.requiredWethWrapAmount).toBeUndefined()
		expect(preview.canWrapRequiredWeth).toBe(false)
		expect(preview.wrapRequiredWethMessage).toBeUndefined()
	})

	test('initial report submission helper allows submit when balances and approvals are sufficient', () => {
		const preview = createInitialReportSubmissionPreview()

		expect(preview.canSubmit).toBe(true)
		expect(preview.blockMessage).toBeUndefined()
	})

	test('initial report submission helper blocks reports that already moved past initial reporting', () => {
		const reporter = getAddress(addressString(TEST_ADDRESSES[1]))

		const pendingPreview = createInitialReportSubmissionPreview({
			reportDetails: {
				currentReporter: reporter,
				disputeOccurred: false,
				exactToken1Report: 100n,
				isDistributed: false,
				reportTimestamp: 1n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
		})
		expect(pendingPreview.canSubmit).toBe(false)
		expect(pendingPreview.blockMessage).toEqual({
			kind: 'visible',
			message: 'This report already has an initial report.',
		})

		const disputedPreview = createInitialReportSubmissionPreview({
			reportDetails: {
				currentReporter: reporter,
				disputeOccurred: true,
				exactToken1Report: 100n,
				isDistributed: false,
				reportTimestamp: 1n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
		})
		expect(disputedPreview.canSubmit).toBe(false)
		expect(disputedPreview.blockMessage).toEqual({
			kind: 'visible',
			message: 'This report already has an initial report.',
		})

		const settledPreview = createInitialReportSubmissionPreview({
			reportDetails: {
				currentReporter: reporter,
				disputeOccurred: false,
				exactToken1Report: 100n,
				isDistributed: true,
				reportTimestamp: 1n,
				token1: REP_ADDRESS,
				token1Symbol: 'REP',
				token2: WETH_ADDRESS,
				token2Symbol: 'WETH',
			},
		})
		expect(settledPreview.canSubmit).toBe(false)
		expect(settledPreview.blockMessage).toEqual({
			kind: 'visible',
			message: 'This report is already settled and can no longer accept an initial report.',
		})
	})

	test('maps initial report write failures into friendly guidance', () => {
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: report submitted'))).toBe('This report already has an initial report.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: report id'))).toBe('This report is no longer valid. Reload it before submitting the initial report again.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: token1 amount'))).toBe('The required token1 amount changed on-chain. Reload the report before submitting the initial report again.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: token2 amount'))).toBe('The selected price produces an invalid token2 amount for the initial report.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: state hash'))).toBe('This report changed on-chain. Reload the report before submitting the initial report again.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('ERC20: transfer amount exceeds allowance'))).toBe(
			'Transaction failed while submitting the initial report. Wallet balance or token approval changed since the last refresh. Reload the report and verify both token balances and approvals before submitting the initial report again.',
		)
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted'))).toBe('Transaction failed while submitting the initial report. Reload the report and try again.')
		expect(formatOpenOracleInitialReportWriteErrorMessage(new Error('execution reverted: pool not found'))).toBe('Transaction failed while submitting the initial report. Reason: pool not found')
	})

	test('formats unavailable approval status messages with sanitized reasons', () => {
		expect(
			formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
				reason: 'Failed to load token approval: execution reverted',
				tokenLabel: 'WETH',
			}),
		).toBe('Unable to verify WETH approval before submitting the initial report. Retry loading the approval status before continuing.')
	})

	test('formats unavailable balance status messages with sanitized reasons', () => {
		expect(
			formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
				reason: 'Failed to load token balance: execution reverted',
				tokenLabel: 'WETH',
			}),
		).toBe('Unable to verify WETH balance for this report. Retry loading the report or balance status before submitting the initial report.')
	})

	test('open oracle fee and multiplier formatters render human values', () => {
		expect(formatOpenOracleFeePercentage(10_000n)).toBe('0.1%')
		expect(formatOpenOracleFeePercentageInput(100n)).toBe('0.001')
		expect(formatOpenOracleFeePercentage(BigInt(Number.MAX_SAFE_INTEGER) * 100_000n + 12_345n)).toBe('9,007,199,254,740,991.12345%')
		expect(formatOpenOracleMultiplier(140n)).toBe('1.40x')
		expect(formatOpenOracleMultiplier(BigInt(Number.MAX_SAFE_INTEGER) * 100n + 1n)).toBe('9007199254740991.01x')
	})

	test('open oracle fee percentage input parser accepts user-facing percentages', () => {
		expect(parseOpenOracleFeePercentageInput('0.001', 'Protocol fee')).toBe(100)
		expect(parseOpenOracleFeePercentageInput('1', 'Protocol fee')).toBe(100_000)
		expect(() => parseOpenOracleFeePercentageInput('', 'Protocol fee')).toThrow('Protocol fee is required')
		expect(() => parseOpenOracleFeePercentageInput('-0.1', 'Protocol fee')).toThrow('Protocol fee must be non-negative')
		expect(() => parseOpenOracleFeePercentageInput('0.000001', 'Protocol fee')).toThrow('Protocol fee must be a decimal percentage')
	})

	test('open oracle create form parser accepts user-facing decimal values', () => {
		const token1Address = addressString(GENESIS_REPUTATION_TOKEN)
		const parsed = parseOpenOracleCreateFormSubmission({
			form: {
				...getDefaultOpenOracleCreateFormState(),
				disputeDelay: '10',
				escalationHalt: '2.5',
				exactToken1Report: '1.25',
				ethValue: '0.0000000000000011',
				feePercentage: '0.001',
				multiplier: '100',
				protocolFee: '0.002',
				settlementTime: '60',
				settlerReward: '0.000000000000001',
				token1Address,
				token2Address: WETH_ADDRESS,
			},
			token1Decimals: 6,
		})

		expect(parsed).toEqual({
			disputeDelay: 10,
			escalationHalt: 2_500_000n,
			exactToken1Report: 1_250_000n,
			ethValue: 1100n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 200,
			settlementTime: 60,
			settlerReward: 1000n,
			token1Address: getAddress(token1Address),
			token2Address: getAddress(WETH_ADDRESS),
		})
	})

	test('open oracle create validation blocks contract-reverting configurations before submission', () => {
		const token1Address = addressString(GENESIS_REPUTATION_TOKEN)
		const highPrecisionToken1Amount = '0.000000000000000000000000000000000001'
		const baseForm = {
			...getDefaultOpenOracleCreateFormState(),
			disputeDelay: '10',
			exactToken1Report: '1',
			ethValue: '1',
			feePercentage: '1',
			multiplier: '100',
			protocolFee: '1',
			settlementTime: '60',
			settlerReward: '0.1',
			token1Address,
			token2Address: WETH_ADDRESS,
		}

		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '0' } })).toBe('Exact token1 report must be greater than zero.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, token2Address: token1Address } })).toBe('Token1 and token2 must be different addresses.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlementTime: '9' } })).toBe('Settlement time must be greater than or equal to dispute delay.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, feePercentage: '60', protocolFee: '50.00001' } })).toBe('Fee percentage plus protocol fee must not exceed 100%.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, multiplier: '99' } })).toBe('Multiplier must be at least 1.00x.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '1000000000' } })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '1000000000' }, token1Decimals: 18 })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount } })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount }, token1Decimals: 36 })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '.' } })).toBe('Enter a valid exact token1 report.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '-.' } })).toBe('Enter a valid exact token1 report.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: '.' } })).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: '-.' } })).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, multiplier: (1n << 16n).toString() } })).toBe('Multiplier exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, disputeDelay: (1n << 24n).toString() } })).toBe('Dispute delay exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlementTime: (1n << 48n).toString() } })).toBe('Settlement time exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: (1n << 128n).toString() }, token1Decimals: 18 })).toBe('Exact token1 report exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: (1n << 128n).toString() }, token1Decimals: 18 })).toBe('Escalation halt exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlerReward: (1n << 96n).toString() } })).toBe('Settler reward exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, ethValue: (1n << 96n).toString() } })).toBe('ETH value to send exceeds the contract maximum.')
	})

	test('open oracle create parser accepts high-decimal token1 amounts once token decimals are known', () => {
		const parsed = parseOpenOracleCreateFormSubmission({
			form: {
				...getDefaultOpenOracleCreateFormState(),
				disputeDelay: '10',
				escalationHalt: '0.000000000000000000000000000000000001',
				exactToken1Report: '0.000000000000000000000000000000000001',
				ethValue: '1',
				feePercentage: '1',
				multiplier: '100',
				protocolFee: '1',
				settlementTime: '60',
				settlerReward: '0.1',
				token1Address: addressString(GENESIS_REPUTATION_TOKEN),
				token2Address: WETH_ADDRESS,
			},
			token1Decimals: 36,
		})

		expect(parsed.exactToken1Report).toBe(1n)
		expect(parsed.escalationHalt).toBe(1n)
	})

	test('open oracle create parser throws invariant validation messages before preparing a write', () => {
		expect(() =>
			parseOpenOracleCreateFormSubmission({
				form: {
					...getDefaultOpenOracleCreateFormState(),
					disputeDelay: '10',
					exactToken1Report: '1',
					ethValue: '1',
					feePercentage: '60',
					multiplier: '100',
					protocolFee: '50.00001',
					settlementTime: '60',
					settlerReward: '0.1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
			}),
		).toThrow('Fee percentage plus protocol fee must not exceed 100%.')
		expect(() =>
			parseOpenOracleCreateFormSubmission({
				form: {
					...getDefaultOpenOracleCreateFormState(),
					disputeDelay: '10',
					exactToken1Report: '1',
					ethValue: '1',
					feePercentage: '1',
					multiplier: (1n << 16n).toString(),
					protocolFee: '1',
					settlementTime: '60',
					settlerReward: '0.1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
			}),
		).toThrow('Multiplier exceeds the contract maximum.')
	})

	test('oracle bounty buffer adds a 20% headroom and rounds up', () => {
		expect(addOpenOracleBountyBuffer(101n)).toBe(122n)
		expect(addOpenOracleBountyBuffer(1_000n)).toBe(1_200n)
	})

	test('selected report action mode follows the report lifecycle', () => {
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentReporter: zeroAddress, reportTimestamp: 0n }))).toBe('initial-report')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 110n }))).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 110n, disputeOccurred: true }))).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 161n }))).toBe('settle')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 161n, isDistributed: true }))).toBe('read-only')
	})

	test('dispute and settle availability follow time-based report lifecycle', () => {
		const beforeDisputeDelay = createOpenOracleLifecycleReport({ currentTime: 109n })
		expect(getOpenOracleDisputeAvailability(beforeDisputeDelay)).toEqual({
			canAct: false,
			message: 'This report is not ready to dispute.',
		})
		expect(getOpenOracleSettleAvailability(beforeDisputeDelay)).toEqual({
			canAct: false,
			message: 'This report can be settled in less than a minute if no disputes occur.',
		})

		const insideDisputeWindow = createOpenOracleLifecycleReport({ currentTime: 110n })
		expect(getOpenOracleDisputeAvailability(insideDisputeWindow)).toEqual({
			canAct: true,
			message: undefined,
		})
		expect(getOpenOracleSettleAvailability(insideDisputeWindow)).toEqual({
			canAct: false,
			message: 'This report can be settled in less than a minute if no disputes occur.',
		})

		const exactSettlementBoundary = createOpenOracleLifecycleReport({ currentTime: 160n })
		expect(getOpenOracleDisputeAvailability(exactSettlementBoundary)).toEqual({
			canAct: true,
			message: undefined,
		})
		expect(getOpenOracleSettleAvailability(exactSettlementBoundary)).toEqual({
			canAct: true,
			message: undefined,
		})

		const afterSettlementWindow = createOpenOracleLifecycleReport({ currentTime: 161n })
		expect(getOpenOracleDisputeAvailability(afterSettlementWindow)).toEqual({
			canAct: false,
			message: 'Dispute window closed. Settle Report instead.',
		})
		expect(getOpenOracleSettleAvailability(afterSettlementWindow)).toEqual({
			canAct: true,
			message: undefined,
		})
	})

	test('dispute and settle availability use current block number for block-based reports', () => {
		const blockBasedReport = createOpenOracleLifecycleReport({
			currentBlockNumber: 111n,
			currentTime: 1n,
			timeType: false,
		})

		expect(getOpenOracleDisputeAvailability(blockBasedReport)).toEqual({
			canAct: true,
			message: undefined,
		})
		expect(getOpenOracleSettleAvailability(blockBasedReport)).toEqual({
			canAct: false,
			message: 'This report can be settled in 49 blocks if no disputes occur.',
		})
	})

	test('dispute and settle availability block reports without an initial report or already-settled reports', () => {
		const noInitialReport = createOpenOracleLifecycleReport({
			currentReporter: zeroAddress,
			reportTimestamp: 0n,
		})
		expect(getOpenOracleDisputeAvailability(noInitialReport)).toEqual({
			canAct: false,
			message: 'Submit an initial report before disputing this report.',
		})
		expect(getOpenOracleSettleAvailability(noInitialReport)).toEqual({
			canAct: false,
			message: 'Submit an initial report before settling this report.',
		})

		const settledReport = createOpenOracleLifecycleReport({
			currentTime: 200n,
			isDistributed: true,
		})
		expect(getOpenOracleDisputeAvailability(settledReport)).toEqual({
			canAct: false,
			message: 'This report is already settled.',
		})
		expect(getOpenOracleSettleAvailability(settledReport)).toEqual({
			canAct: false,
			message: 'This report is already settled.',
		})
	})

	test('maps dispute and settle write failures into friendly guidance', () => {
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: 0x98bdb2e0'))).toBe('This report requires a higher settlement gas limit because it executes a callback on settlement. Retry with the updated UI.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: settlement'))).toBe('This report is not ready to settle.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: no initial report'))).toBe('Submit an initial report before settling this report.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute too early'))).toBe('This report is not ready to dispute.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute period expired'))).toBe('Dispute window closed. Settle Report instead.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: report settled'))).toBe('This report is already settled.')
	})

	test('loadOracleManagerDetails reflects initial manager state after deployment', async () => {
		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)

		expect(details.managerAddress).toBe(managerAddress)
		expect(details.openOracleAddress).toBe(getOpenOracleAddress())
		expect(details.activeStagedOperationCount).toBe(0n)
		expect(details.pendingReportId).toBe(0n)
		expect(details.pendingOperation).toBe(undefined)
		expect(details.pendingOperationSlotId).toBe(0n)
		expect(details.lastPrice).toBe(0n)
		expect(details.lastSettlementTimestamp).toBe(0n)
		expect(details.isPriceValid).toBe(false)
		expect(details.priceValidUntilTimestamp).toBe(undefined)
	})

	test('requestOraclePrice creates a pending report visible via loadOpenOracleReportDetails', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1Report',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1Report)

		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)
		const reportId = details.pendingReportId
		const extraData = await getOpenOracleExtraData(client, reportId)

		expect(reportId).toBeGreaterThan(0n)
		expect(details.callbackStateHash).toBe(extraData.stateHash)
		expect(details.token1).toBe(getAddress(WETH_ADDRESS))
		expect(details.token2).toBe(getAddress(addressString(GENESIS_REPUTATION_TOKEN)))

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.reportId).toBe(reportId)
		expect(details.exactToken1Report).toBe(reportDetails.exactToken1Report)
		expect(getAddress(reportDetails.token1)).toBe(getAddress(WETH_ADDRESS))
		expect(getAddress(reportDetails.token2)).toBe(getAddress(addressString(GENESIS_REPUTATION_TOKEN)))
		expect(reportDetails.settlementTimestamp).toBe(0n)
		expect(reportDetails.token1Decimals).toBe(0)
		expect(reportDetails.token2Decimals).toBe(18)
		expect(reportDetails.stateHash).toBe((await getOpenOracleExtraData(client, reportId)).stateHash)
	})

	test('requestOraclePrice accepts caller-selected WETH above the coordinator minimum', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		const requestedInitialWeth = minimumToken1Report * 3n

		await requestOraclePrice(uiWriteClient, managerAddress, 10n ** 18n, requestedInitialWeth)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.exactToken1Report).toBe(requestedInitialWeth)
		expect(reportDetails.currentAmount1).toBe(requestedInitialWeth)
		expect(reportDetails.currentAmount2).toBe(requestedInitialWeth)
	})

	test('requestOraclePrice derives stale cached price refresh amounts with coordinator 1e18 precision', async () => {
		const seededRepEthPrice = 2n * 10n ** 18n
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1Report',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		const seededAmount2 = minimumToken1Report * 2n
		const seededRequestEthCost = await getRequestPriceEthCost(client, managerAddress)

		await requestPriceWithValue(client, managerAddress, seededRequestEthCost, seededRepEthPrice)
		const seededReportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, getOpenOracleAddress(), seededReportId)
		await mockWindow.advanceTime(ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS + 1n)

		await requestOraclePrice(uiWriteClient, managerAddress)

		const staleRefreshReportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const staleRefreshDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), staleRefreshReportId)
		expect(staleRefreshDetails.currentAmount1).toBe(minimumToken1Report)
		expect(staleRefreshDetails.currentAmount2).toBe(seededAmount2)
		expect(seededRepEthPrice).toBe((staleRefreshDetails.currentAmount2 * 10n ** 18n) / staleRefreshDetails.currentAmount1)
	})

	test('requestOraclePrice rejects fresh cached prices before wrap or approval side effects', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1Report',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1Report)
		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, getOpenOracleAddress(), reportId)
		const wethBalanceAfterSettlement = await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)

		await expect(requestOraclePrice(uiWriteClient, managerAddress)).rejects.toThrow('A fresh oracle price is already available')
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)).toBe(wethBalanceAfterSettlement)
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId).toBe(0n)
	})

	test('loadCoordinatorInitialReportFundingRequirement uses a live quote for the REP side', async () => {
		const minimumToken1Report = 100n * 10n ** 18n
		const quotedAmount2 = 7n * 10n ** 18n
		const currentWethBalance = 2n * 10n ** 18n
		const currentRepBalance = 300n * 10n ** 18n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const mockClient = createConnectedReadClient()
		mockClient.readContract = async parameters => {
			const address = parameters.address as Address
			const functionName = parameters.functionName as string
			if (functionName === 'minimumToken1Report') return minimumToken1Report as never
			if (functionName === 'lastPrice') return 0n as never
			if (functionName === 'reputationToken') return reputationTokenAddress as never
			if (functionName === 'balanceOf' && address === WETH_ADDRESS) return currentWethBalance as never
			if (functionName === 'balanceOf' && address === reputationTokenAddress) return currentRepBalance as never
			throw new Error(`Unexpected read ${functionName} for ${address}`)
		}
		mockClient.simulateContract = async () => ({ result: [quotedAmount2, 100000n], request: {} as never }) as never

		const funding = await loadCoordinatorInitialReportFundingRequirement(mockClient, managerAddress, uiWriteClient.account.address)

		expect(funding.initialReportAmount2).toBe(quotedAmount2 * 2n)
		expect(funding.proposedRepPerEthPrice).toBe((quotedAmount2 * 10n ** 18n) / minimumToken1Report)
		expect(funding.minimumToken1Report).toBe(minimumToken1Report)
		expect(funding.maximumInitialWeth).toBe(minimumToken1Report * 2n)
		expect(funding.wethShortfall).toBe(minimumToken1Report * 2n - currentWethBalance)
	})

	test('loadCoordinatorInitialReportFundingRequirement funds a caller-selected WETH amount above the buffered minimum', async () => {
		const minimumToken1Report = 100n
		const requestedInitialWeth = 250n
		const proposedRepPerEthPrice = 2n * 10n ** 18n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const mockClient = createConnectedReadClient()
		mockClient.readContract = async parameters => {
			const address = parameters.address as Address
			const functionName = parameters.functionName as string
			if (functionName === 'minimumToken1Report') return minimumToken1Report as never
			if (functionName === 'reputationToken') return reputationTokenAddress as never
			if (functionName === 'balanceOf' && address === WETH_ADDRESS) return 0n as never
			if (functionName === 'balanceOf' && address === reputationTokenAddress) return 1_000n as never
			throw new Error(`Unexpected read ${functionName} for ${address}`)
		}

		const funding = await loadCoordinatorInitialReportFundingRequirement(mockClient, managerAddress, uiWriteClient.account.address, proposedRepPerEthPrice, requestedInitialWeth)

		expect(funding.minimumToken1Report).toBe(minimumToken1Report)
		expect(funding.requestedInitialWeth).toBe(requestedInitialWeth)
		expect(funding.maximumInitialWeth).toBe(requestedInitialWeth)
		expect(funding.initialReportAmount2).toBe(500n)
		expect(funding.wethShortfall).toBe(requestedInitialWeth)
	})

	test('requestOraclePrice rejects an unavailable first-report REP quote instead of assuming a price', async () => {
		await expect(requestOraclePrice(uiWriteClient, managerAddress)).rejects.toThrow('Failed to fetch price from Uniswap')
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId).toBe(0n)
	})

	test('requestOraclePrice rejects insufficient REP before WETH wrap side effects', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1Report',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		const currentRepBalance = await client.readContract({
			address: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
			abi: [
				{
					type: 'function',
					name: 'balanceOf',
					stateMutability: 'view',
					inputs: [{ name: 'account', type: 'address' }],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'balanceOf',
			args: [uiWriteClient.account.address],
		})
		if (typeof currentRepBalance !== 'bigint') throw new Error('expected bigint REP balance')
		const repToKeep = minimumToken1Report - 1n
		const repToTransfer = currentRepBalance - repToKeep
		const startWethBalance = await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)
		const transferHash = await client.writeContract({
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
			address: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
			functionName: 'transfer',
			args: [getAddress(addressString(TEST_ADDRESSES[1])), repToTransfer],
		})
		await client.waitForTransactionReceipt({ hash: transferHash })

		await expect(requestOraclePrice(uiWriteClient, managerAddress, minimumToken1Report)).rejects.toThrow('Insufficient REP balance for coordinator initial report')
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)).toBe(startWethBalance)
	})

	test('loadOracleManagerDetails preserves queued zero-amount security bond allowance operations', async () => {
		await requestPriceIfNeededAndStageOperation(client, managerAddress, OperationType.SetSecurityBondsAllowance, client.account.address, 0n)

		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)

		expect(details.pendingOperationSlotId).toBeGreaterThan(0n)
		expect(details.activeStagedOperationCount).toBe(1n)
		expect(details.pendingOperation).toBeDefined()
		expect(details.pendingOperation?.operation).toBe('setSecurityBondsAllowance')
		expect(details.pendingOperation?.amount).toBe(0n)
		expect(details.pendingOperation?.targetVault).toBe(client.account.address)
	})

	test('queueOracleManagerOperation returns queued operation metadata for the pending settlement list', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		const result = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'setSecurityBondsAllowance', client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1Report)

		expect(result.queuedOperation).toBeDefined()
		expect(result.queuedOperation?.isPendingSlot).toBe(true)
		expect(result.queuedOperation?.operation).toBe('setSecurityBondsAllowance')
		expect(result.queuedOperation?.operationId).toBeGreaterThan(0n)
		expect(result.stagedExecution).toBeUndefined()
	})

	test('queueOracleManagerOperation preserves incremental ids when adding to the pending settlement list', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		const firstResult = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'setSecurityBondsAllowance', client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1Report)
		const secondResult = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'liquidation', addressString(TEST_ADDRESSES[1]), 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)
		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)
		const firstOperationId = firstResult.queuedOperation?.operationId
		const secondOperationId = secondResult.queuedOperation?.operationId
		if (firstOperationId === undefined) throw new Error('Expected the first queued operation id to be defined')
		if (secondOperationId === undefined) throw new Error('Expected the second queued operation id to be defined')

		expect(firstResult.queuedOperation?.isPendingSlot).toBe(true)
		expect(secondResult.queuedOperation).toBeDefined()
		expect(secondResult.queuedOperation?.isPendingSlot).toBe(true)
		expect(secondResult.queuedOperation?.operationId).toBeGreaterThan(firstOperationId)
		expect(details.activeStagedOperationCount).toBe(2n)
		expect(details.pendingOperationSlotId).toBe(firstOperationId)
		expect(details.pendingOperation?.operationId).toBe(firstOperationId)
		expect(details.stagedOperations?.map(operation => operation.operationId)).toEqual([secondOperationId, firstOperationId])
		expect(details.stagedOperations?.map(operation => operation.operation)).toEqual(['liquidation', 'setSecurityBondsAllowance'])
	})

	test('queueOracleManagerOperation only lets the pending report sponsor add more queued operations', async () => {
		const secondAddress = addressString(TEST_ADDRESSES[1])
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await queueOracleManagerOperation(uiWriteClient, managerAddress, 'setSecurityBondsAllowance', client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1Report)

		const managerDetails = await loadOracleManagerDetails(uiReadClient, managerAddress)
		expect(managerDetails.pendingReportId).toBeGreaterThan(0n)
		expect(managerDetails.queuedOperationEthCost).toBe(0n)

		await mockWindow.setNextBlockBaseFeePerGasToZero()
		installInjectedEthereum(mockWindow, secondAddress)
		const secondUiWriteClient = createWalletWriteClient(secondAddress)
		await expect(queueOracleManagerOperation(secondUiWriteClient, managerAddress, 'setSecurityBondsAllowance', secondAddress, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1Report)).rejects.toThrow('Only the pending report sponsor can queue more operations until settlement')
		const queuedResult = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'setSecurityBondsAllowance', client.account.address, 0n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		expect(queuedResult.queuedOperation).toBeDefined()
		expect(queuedResult.queuedOperation?.isPendingSlot).toBe(true)
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingSettlementOperationIds.length).toBe(2)
	})

	test('submitted and settled reports are tracked in loadOpenOracleReportDetails', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1Report)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report: reportExactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const amount1 = reportExactToken1Report
		const openOracleAddress = getOpenOracleAddress()

		let reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.currentAmount1).toBe(amount1)
		expect(reportDetails.currentAmount2).toBe(amount1)
		expect(reportDetails.settlementTimestamp).toBe(0n)
		expect(getOpenOracleReportStatus(reportDetails)).toBe('Pending')

		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, openOracleAddress, reportId)

		reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.settlementTimestamp).toBeGreaterThan(0n)
		expect(getOpenOracleReportStatus(reportDetails)).toBe('Settled')

		const managerDetails = await loadOracleManagerDetails(uiReadClient, managerAddress)
		expect(managerDetails.pendingReportId).toBe(0n)
		expect(managerDetails.lastSettlementTimestamp).toBeGreaterThan(0n)
		expect(managerDetails.isPriceValid).toBe(true)
		expect(managerDetails.priceValidUntilTimestamp).toBe(managerDetails.lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS)
	})

	test('submitInitialOracleReport rejects a second initial report for the same report', async () => {
		const minimumToken1Report = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1Report', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1Report',
			args: [],
		})
		if (typeof minimumToken1Report !== 'bigint') throw new Error('expected bigint minimumToken1Report')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1Report)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report: reportExactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const amount1 = reportExactToken1Report

		const openOracleAddress = getOpenOracleAddress()
		const stateHash = (await getOpenOracleExtraData(client, reportId)).stateHash
		await expect(submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount1, stateHash)).rejects.toThrow(/0xcc0220a9|reportalreadysubmitted|custom error/i)
	})

	test('submitInitialOracleReport rejects an invalid state hash', async () => {
		await createOpenOracleReportInstance(uiWriteClient, {
			disputeDelay: 10,
			escalationHalt: 0n,
			exactToken1Report: 1n,
			ethValue: 1_100n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerReward: 1_000n,
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		})

		const latestReports = await loadOpenOracleReportSummaries(uiReadClient, 0, 1)
		const latestReport = latestReports.reports[0]
		if (latestReport === undefined) throw new Error('Expected a direct OpenOracle report')
		const reportId = latestReport.reportId
		const amount1 = 1n
		const amount2 = 1n

		const openOracleAddress = getOpenOracleAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracleAddress)
		await approveToken(client, WETH_ADDRESS, openOracleAddress)
		await mockWindow.setBalance(client.account.address, amount2 + 10n ** 18n)
		await wrapWethTestHelper(client, amount2)

		const stateHash = (await getOpenOracleExtraData(client, reportId)).stateHash
		const invalidStateHash = stateHash === '0x0000000000000000000000000000000000000000000000000000000000000000' ? '0x0000000000000000000000000000000000000000000000000000000000000001' : '0x0000000000000000000000000000000000000000000000000000000000000000'

		await expect(submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount2, invalidStateHash)).rejects.toThrow(/0x937d7862|invalidstatehash/i)
	})

	test('ui wrapWeth helper deposits ETH into WETH and reports the wrap action', async () => {
		const walletAddress = addressString(TEST_ADDRESSES[0])
		const startBalance = await loadErc20Balance(uiReadClient, WETH_ADDRESS, walletAddress)
		const wrapAmount = 123n

		const result = await wrapUiWeth(uiWriteClient, wrapAmount)
		expect(result.action).toBe('wrapWeth')

		const endBalance = await loadErc20Balance(uiReadClient, WETH_ADDRESS, walletAddress)
		expect(endBalance - startBalance).toEqual(wrapAmount)
	})
})
