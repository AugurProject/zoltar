/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from 'viem'
import { createOpenOracleReportInstance, getOpenOracleAddress, loadErc20Balance, loadOpenOracleReportDetails, loadOpenOracleReportSummaries, loadOracleManagerDetails, requestOraclePrice, settleOracleReport, submitInitialOracleReport, wrapWeth as wrapUiWeth } from '../contracts.js'
import {
	addOpenOracleBountyBuffer,
	deriveOpenOracleInitialReportSubmissionDetails,
	formatOpenOracleFeePercentage,
	formatOpenOracleInitialReportApprovalStatusUnavailableMessage,
	formatOpenOracleInitialReportBalanceStatusUnavailableMessage,
	formatOpenOracleInitialReportPriceUnavailableMessage,
	formatOpenOracleInitialReportWriteErrorMessage,
	formatOpenOracleMultiplier,
	getOpenOracleReportStatus,
	getOpenOracleSelectedReportActionMode,
	loadOpenOracleInitialReportPrice,
	loadOpenOracleInitialReportPriceResult,
} from '../lib/openOracle.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../lib/securityVault.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
import { ETH_ADDRESS, REP_ADDRESS, USDC_ADDRESS } from '../lib/uniswapQuoter.js'
import type { InjectedEthereum } from '../injectedEthereum.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS, TEST_ADDRESSES } from '../../../solidity/ts/testsuite/simulator/utils/constants'
import { addressString } from '../../../solidity/ts/testsuite/simulator/utils/bigint'
import { approveToken, setupTestAccounts, ensureProxyDeployerDeployed } from '../../../solidity/ts/testsuite/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../solidity/ts/testsuite/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../solidity/ts/testsuite/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../solidity/ts/testsuite/simulator/utils/viem'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../../../solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals'
import { ensureZoltarDeployed } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../../solidity/ts/testsuite/simulator/utils/contracts/zoltarQuestionData'
import { getOpenOracleExtraData, wrapWeth as wrapWethTestHelper } from '../../../solidity/ts/testsuite/simulator/utils/contracts/peripherals'

setDefaultTimeout(TEST_TIMEOUT_MS)

function installInjectedEthereum(mockWindow: AnvilWindowEthereum) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) {
		globalWindow.window = globalThis as unknown as Window & typeof globalThis
	}
	globalWindow.window.ethereum = mockWindow as unknown as InjectedEthereum
}

const genesisUniverse = 0n
const securityMultiplier = 2n
const MAX_RETENTION_RATE = 999_999_996_848_000_000n
const reportedRepEthPrice = 10n
const outcomes = ['Yes', 'No']

function createQuoteClient(amountOut: bigint): Parameters<typeof loadOpenOracleInitialReportPrice>[0] {
	return {
		simulateContract: async () => ({ result: [amountOut, 100000n] }),
	} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0]
}

function createFailingQuoteClient(message: string): Parameters<typeof loadOpenOracleInitialReportPrice>[0] {
	return {
		simulateContract: async () => {
			throw new Error(message)
		},
	} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0]
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

describe('Open Oracle helpers', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	let managerAddress: Address

	beforeEach(async () => {
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE)
		managerAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, securityMultiplier).priceOracleManagerAndOperatorQueuer
	})

	test('getOpenOracleAddress returns the deterministic non-zero oracle address', () => {
		expect(getOpenOracleAddress()).not.toBe(zeroAddress)
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

	test('initial report price helpers derive a Uniswap default price and preserve quote failure metadata', async () => {
		const quote = await loadOpenOracleInitialReportPrice(createQuoteClient(25n), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)
		expect(quote).toEqual({
			price: 4_000_000_000_000_000_000n,
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
		const failingClient = {
			simulateContract: async () => {
				callCount += 1
				throw new Error(callCount <= 4 ? 'no v4 pool' : 'v3 quote reverted')
			},
		} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0]

		await expect(loadOpenOracleInitialReportPrice(failingClient, REP_ADDRESS, ETH_ADDRESS, 100n)).rejects.toThrow('Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v4 pool. Uniswap V3 quote failed: v3 quote reverted')
	})

	test('initial report price helpers use Uniswap V3 for REP/WETH pairs when V4 is unavailable', async () => {
		let callCount = 0
		const fallbackClient = {
			simulateContract: async () => {
				callCount += 1
				if (callCount <= 4) {
					throw new Error('no v4 pool')
				}
				return { result: [200_000_000_000_000_000n, 0n, 0, 0n] }
			},
		} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0]

		await expect(loadOpenOracleInitialReportPrice(fallbackClient, REP_ADDRESS, WETH_ADDRESS, 100n * 10n ** 18n)).resolves.toEqual({
			price: 500_000_000_000_000_000_000n,
			priceSource: 'Uniswap V3',
			token2Amount: 200_000_000_000_000_000n,
		})
	})

	test('initial report price helpers use Uniswap V3 for non-REP pairs when V4 is unavailable', async () => {
		let callCount = 0
		const fallbackClient = {
			simulateContract: async () => {
				callCount += 1
				if (callCount <= 4) {
					throw new Error('no v4 pool')
				}
				return { result: [50n, 0n, 0, 0n] }
			},
		} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0]

		await expect(loadOpenOracleInitialReportPrice(fallbackClient, USDC_ADDRESS, WETH_ADDRESS, 100n)).resolves.toEqual({
			price: 2_000_000_000_000_000_000n,
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
		expect(preview.price).toBe(4_000_000_000_000_000_000n)
		expect(preview.amount1).toBe(100n)
		expect(preview.amount2).toBe(25n)
		expect(preview.token2Approval.neededAmount).toBe(1n)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockMessage).toEqual({
			kind: 'visible',
			message: 'WETH approval required',
		})
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
		expect(preview.price).toBe(4_000_000_000_000_000_000n)
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
		expect(formatOpenOracleMultiplier(140n)).toBe('1.40x')
	})

	test('oracle bounty buffer adds a 20% headroom and rounds up', () => {
		expect(addOpenOracleBountyBuffer(101n)).toBe(122n)
		expect(addOpenOracleBountyBuffer(1_000n)).toBe(1_200n)
	})

	test('selected report action mode follows the report lifecycle', () => {
		expect(getOpenOracleSelectedReportActionMode({ currentReporter: zeroAddress, disputeOccurred: false, isDistributed: false, reportTimestamp: 0n })).toBe('initial-report')
		const reporter = getAddress(addressString(TEST_ADDRESSES[1]))
		expect(getOpenOracleSelectedReportActionMode({ currentReporter: reporter, disputeOccurred: false, isDistributed: false, reportTimestamp: 1n })).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode({ currentReporter: reporter, disputeOccurred: true, isDistributed: false, reportTimestamp: 1n })).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode({ currentReporter: reporter, disputeOccurred: false, isDistributed: true, reportTimestamp: 1n })).toBe('read-only')
	})

	test('loadOracleManagerDetails reflects initial manager state after deployment', async () => {
		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)

		expect(details.managerAddress).toBe(managerAddress)
		expect(details.openOracleAddress).toBe(getOpenOracleAddress())
		expect(details.pendingReportId).toBe(0n)
		expect(details.lastPrice).toBe(0n)
		expect(details.lastSettlementTimestamp).toBe(0n)
		expect(details.isPriceValid).toBe(false)
		expect(details.priceValidUntilTimestamp).toBe(undefined)
	})

	test('requestOraclePrice creates a pending report visible via loadOpenOracleReportDetails', async () => {
		await requestOraclePrice(uiWriteClient, managerAddress)

		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)
		const reportId = details.pendingReportId
		const extraData = await getOpenOracleExtraData(client, reportId)

		expect(reportId).toBeGreaterThan(0n)
		expect(details.callbackStateHash).toBe(extraData.stateHash)
		expect(details.token1).toBe(getAddress(addressString(GENESIS_REPUTATION_TOKEN)))
		expect(details.token2).toBe(getAddress(WETH_ADDRESS))

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.reportId).toBe(reportId)
		expect(details.exactToken1Report).toBe(reportDetails.exactToken1Report)
		expect(getAddress(reportDetails.token1)).toBe(getAddress(addressString(GENESIS_REPUTATION_TOKEN)))
		expect(getAddress(reportDetails.token2)).toBe(getAddress(WETH_ADDRESS))
		expect(reportDetails.settlementTimestamp).toBe(0n)
		expect(reportDetails.token1Decimals).toBe(18)
		expect(reportDetails.token2Decimals).toBe(0)
		expect(reportDetails.stateHash).toBe((await getOpenOracleExtraData(client, reportId)).stateHash)
	})

	test('submitted and settled reports are tracked in loadOpenOracleReportDetails', async () => {
		await requestOraclePrice(uiWriteClient, managerAddress)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const PRICE_PRECISION = 10n ** 18n
		const amount1 = exactToken1Report
		const amount2 = (amount1 * PRICE_PRECISION) / reportedRepEthPrice

		const openOracleAddress = getOpenOracleAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracleAddress)
		await approveToken(client, WETH_ADDRESS, openOracleAddress)
		await wrapWethTestHelper(client, amount2)

		const stateHash = (await getOpenOracleExtraData(client, reportId)).stateHash
		await submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount2, stateHash)

		let reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.currentAmount1).toBe(amount1)
		expect(reportDetails.currentAmount2).toBe(amount2)
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
		await requestOraclePrice(uiWriteClient, managerAddress)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const PRICE_PRECISION = 10n ** 18n
		const amount1 = exactToken1Report
		const amount2 = (amount1 * PRICE_PRECISION) / reportedRepEthPrice

		const openOracleAddress = getOpenOracleAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracleAddress)
		await approveToken(client, WETH_ADDRESS, openOracleAddress)
		await wrapWethTestHelper(client, amount2)

		const stateHash = (await getOpenOracleExtraData(client, reportId)).stateHash
		await submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount2, stateHash)

		await expect(submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount2, stateHash)).rejects.toThrow(/report submitted/i)
	})

	// Temporarily disabled because `eth_simulate` changes the state hash while testing in
	// Interceptor, so this validation must stay commented out for that flow.
	test('submitInitialOracleReport accepts an invalid state hash', async () => {
		await requestOraclePrice(uiWriteClient, managerAddress)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const PRICE_PRECISION = 10n ** 18n
		const amount1 = exactToken1Report
		const amount2 = (amount1 * PRICE_PRECISION) / reportedRepEthPrice

		const openOracleAddress = getOpenOracleAddress()
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracleAddress)
		await approveToken(client, WETH_ADDRESS, openOracleAddress)
		await wrapWethTestHelper(client, amount2)

		const stateHash = (await getOpenOracleExtraData(client, reportId)).stateHash
		const invalidStateHash = stateHash === '0x0000000000000000000000000000000000000000000000000000000000000000' ? '0x0000000000000000000000000000000000000000000000000000000000000001' : '0x0000000000000000000000000000000000000000000000000000000000000000'

		await submitInitialOracleReport(uiWriteClient, openOracleAddress, reportId, amount1, amount2, invalidStateHash)

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.currentAmount1).toBe(amount1)
		expect(reportDetails.currentAmount2).toBe(amount2)
		expect(getOpenOracleReportStatus(reportDetails)).toBe('Pending')
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
