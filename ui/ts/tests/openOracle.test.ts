/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from 'viem'
import { createOpenOracleReportInstance, getOpenOracleAddress, loadOpenOracleReportDetails, loadOpenOracleReportSummaries, loadOracleManagerDetails, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import {
	deriveOpenOracleInitialReportSubmissionDetails,
	addOpenOracleBountyBuffer,
	formatOpenOracleFeePercentage,
	formatOpenOracleInitialReportApprovalStatusUnavailableMessage,
	formatOpenOracleInitialReportPriceUnavailableMessage,
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
import { getOpenOracleExtraData, wrapWeth } from '../../../solidity/ts/testsuite/simulator/utils/contracts/peripherals'

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
const ONE = 10n ** 18n

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
			attemptedSources: ['Uniswap V4', 'Uniswap V3 fallback'],
			failureKind: 'quote-failed',
			reason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no pool. Uniswap V3 fallback failed: no pool',
			status: 'failure',
		})
		await expect(loadOpenOracleInitialReportPrice(createFailingQuoteClient('no pool'), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)).rejects.toThrow(
			'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no pool. Uniswap V3 fallback failed: no pool',
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

		await expect(loadOpenOracleInitialReportPrice(failingClient, REP_ADDRESS, ETH_ADDRESS, 100n)).rejects.toThrow('Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v4 pool. Uniswap V3 fallback failed: v3 quote reverted')
	})

	test('initial report price helpers use the V3 fallback for REP/WETH pairs', async () => {
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
			priceSource: 'Uniswap V3 fallback',
			token2Amount: 200_000_000_000_000_000n,
		})
	})

	test('initial report price helpers use the V3 fallback for non-REP pairs too', async () => {
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
			priceSource: 'Uniswap V3 fallback',
			token2Amount: 50n,
		})
	})

	test('initial report submission helper computes preview amounts and approval gating', () => {
		const details = {
			exactToken1Report: 100n * ONE,
			token1Symbol: 'REP',
			token2Symbol: 'ETH',
		}
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 100n * ONE,
			approvedToken2Amount: 24n * ONE,
			defaultPrice: '4.0',
			defaultPriceError: undefined,
			defaultPriceSource: 'Uniswap V4',
			priceInput: '',
			quoteAttemptedSources: undefined,
			quoteFailureReason: undefined,
			reportDetails: details,
			token1AllowanceError: undefined,
			token2AllowanceError: undefined,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.priceSource).toBe('Uniswap V4')
		expect(preview.price).toBe(4_000_000_000_000_000_000n)
		expect(preview.amount1).toBe(100n * ONE)
		expect(preview.amount2).toBe(25n * ONE)
		expect(preview.token2Approval.neededAmount).toBe(ONE)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockReason).toBe('Need 1 more ETH approved before submitting the initial report. Approving will set the allowance to 25 ETH.')
	})

	test('initial report submission helper explains exhausted quote paths with a short reason', () => {
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 100n * ONE,
			approvedToken2Amount: 100n * ONE,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			priceInput: '',
			quoteAttemptedSources: ['Uniswap V4', 'Uniswap V3 fallback'],
			quoteFailureReason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: execution reverted for an unknown reason. Uniswap V3 fallback failed: no pool',
			reportDetails: {
				exactToken1Report: 100n * ONE,
				token1Symbol: 'REP',
				token2Symbol: 'ETH',
			},
			token1AllowanceError: undefined,
			token2AllowanceError: undefined,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockReason).toBe('Automatic price quote unavailable for REP / ETH. Tried: Uniswap V4, then Uniswap V3 fallback. Reason: Uniswap V4 quote failed: execution reverted for an unknown reason. Uniswap V3 fallback failed: no pool. Enter a price manually to submit the initial report.')
	})

	test('manual price entry overrides automatic quote unavailability', () => {
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 100n * ONE,
			approvedToken2Amount: 24n * ONE,
			defaultPrice: undefined,
			defaultPriceError: undefined,
			defaultPriceSource: undefined,
			priceInput: '4.0',
			quoteAttemptedSources: ['Uniswap V4'],
			quoteFailureReason: 'no pool',
			reportDetails: {
				exactToken1Report: 100n * ONE,
				token1Symbol: 'ABC',
				token2Symbol: 'XYZ',
			},
			token1AllowanceError: undefined,
			token2AllowanceError: undefined,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.priceSource).toBe('Manual override')
		expect(preview.price).toBe(4_000_000_000_000_000_000n)
		expect(preview.blockReason).toBe('Need 1 more XYZ approved before submitting the initial report. Approving will set the allowance to 25 XYZ.')
	})

	test('initial report submission helper surfaces the fetch price failure reason when no default price is available', () => {
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 100n * ONE,
			approvedToken2Amount: 100n * ONE,
			defaultPrice: undefined,
			defaultPriceError: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 fallback failed: no v3 pool',
			defaultPriceSource: undefined,
			priceInput: '',
			quoteAttemptedSources: ['Uniswap V4', 'Uniswap V3 fallback'],
			quoteFailureReason: 'Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 fallback failed: no v3 pool',
			reportDetails: {
				exactToken1Report: 100n * ONE,
			},
			token1AllowanceError: undefined,
			token2AllowanceError: undefined,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockReason).toBe('Failed to fetch price from Uniswap. Uniswap V4 quote failed: no v3 pool. Uniswap V3 fallback failed: no v3 pool')
	})

	test('formats unavailable price messages with sanitized reasons and address fallback labels', () => {
		expect(
			formatOpenOracleInitialReportPriceUnavailableMessage({
				attemptedSources: ['Uniswap V4'],
				reason: 'Failed to load automatic price: execution reverted: pool not found',
				token1Label: undefined,
				token2Label: '0x00000000000000000000000000000000000000a2',
			}),
		).toBe('Automatic price quote unavailable for Token1 / 0x00000000000000000000000000000000000000a2. Tried: Uniswap V4. Reason: execution reverted: pool not found. Enter a price manually to submit the initial report.')
	})

	test('initial report submission helper surfaces allowance read failures separately from approval gating', () => {
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: undefined,
			approvedToken2Amount: 25n * ONE,
			defaultPrice: '4.0',
			defaultPriceError: undefined,
			defaultPriceSource: 'Uniswap V4',
			priceInput: '',
			quoteAttemptedSources: undefined,
			quoteFailureReason: undefined,
			reportDetails: {
				exactToken1Report: 100n * ONE,
				token1Symbol: 'REP',
				token2Symbol: 'ETH',
			},
			token1AllowanceError: 'Failed to load token approval: request timed out',
			token2AllowanceError: undefined,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.blockReason).toBe('Unable to verify REP approval before submitting the initial report. Reason: request timed out. Retry loading the approval status before continuing.')
	})

	test('formats unavailable approval status messages with sanitized reasons', () => {
		expect(
			formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
				reason: 'Failed to load token approval: execution reverted',
				tokenLabel: 'WETH',
			}),
		).toBe('Unable to verify WETH approval before submitting the initial report. Reason: execution reverted. Retry loading the approval status before continuing.')
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

		// The pending report should now be visible through the selected report loader.
		expect(reportId).toBeGreaterThan(0n)

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.reportId).toBe(reportId)
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
		await wrapWeth(client, amount2)

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
})
