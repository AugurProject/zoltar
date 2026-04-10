/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, maxUint256, zeroAddress, type Address } from 'viem'
import { createOpenOracleReportInstance, getOpenOracleAddress, loadOpenOracleReportDetails, loadOpenOracleReportSummaries, loadOracleManagerDetails, requestOraclePrice, settleOracleReport, submitInitialOracleReport } from '../contracts.js'
import { deriveOpenOracleInitialReportSubmissionDetails, formatOpenOracleFeePercentage, formatOpenOracleMultiplier, loadOpenOracleInitialReportPrice, OPEN_ORACLE_APPROVAL_AMOUNT, getOpenOracleReportStatus, getOpenOracleSelectedReportActionMode } from '../lib/openOracle.js'
import { createConnectedReadClient, createWalletWriteClient } from '../lib/clients.js'
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
const startingRepEthPrice = 10n
const outcomes = ['Yes', 'No']

function createQuoteClient(amountOut: bigint): Parameters<typeof loadOpenOracleInitialReportPrice>[0] {
	return {
		simulateContract: async () => ({ result: [amountOut, 100000n] }),
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, securityMultiplier, MAX_RETENTION_RATE, startingRepEthPrice)
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

	test('initial report price helpers derive a Uniswap default price and can fall back to manual input', async () => {
		const quote = await loadOpenOracleInitialReportPrice(createQuoteClient(25n), getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000a2'), 100n)
		expect(quote).toEqual({
			price: 4_000_000_000_000_000_000n,
			priceSource: 'Uniswap V4',
			token2Amount: 25n,
		})
		await expect(
			loadOpenOracleInitialReportPrice(
				{
					simulateContract: async () => {
						throw new Error('no pool')
					},
				} as unknown as Parameters<typeof loadOpenOracleInitialReportPrice>[0],
				getAddress('0x00000000000000000000000000000000000000a1'),
				getAddress('0x00000000000000000000000000000000000000a2'),
				100n,
			),
		).resolves.toBeUndefined()
	})

	test('initial report submission helper computes preview amounts and approval gating', () => {
		const details = {
			exactToken1Report: 100n,
		}
		const preview = deriveOpenOracleInitialReportSubmissionDetails({
			approvedToken1Amount: 100n,
			approvedToken2Amount: 24n,
			defaultPrice: '4.0',
			defaultPriceSource: 'Uniswap V4',
			priceInput: '',
			reportDetails: details,
			token1Decimals: 18,
			token2Decimals: 18,
		})

		expect(preview.priceSource).toBe('Uniswap V4')
		expect(preview.price).toBe(4_000_000_000_000_000_000n)
		expect(preview.amount1).toBe(100n)
		expect(preview.amount2).toBe(25n)
		expect(preview.canSubmit).toBe(false)
		expect(preview.blockReason).toBe('Token2 approval required')
	})

	test('open oracle fee and multiplier formatters render human values', () => {
		expect(formatOpenOracleFeePercentage(10_000n)).toBe('0.1%')
		expect(formatOpenOracleMultiplier(140n)).toBe('1.40x')
		expect(OPEN_ORACLE_APPROVAL_AMOUNT).toBe(maxUint256)
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
		expect(details.lastPrice).toBe(startingRepEthPrice)
		expect(details.lastSettlementTimestamp).toBe(0n)
		expect(details.isPriceValid).toBe(false)
	})

	test('requestOraclePrice creates a pending report visible via loadOpenOracleReportDetails', async () => {
		const { requestPriceEthCost } = await loadOracleManagerDetails(uiReadClient, managerAddress)

		await requestOraclePrice(uiWriteClient, managerAddress, requestPriceEthCost)

		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)
		const reportId = details.pendingReportId

		expect(reportId).toBeGreaterThan(0n)

		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.reportId).toBe(reportId)
		expect(getAddress(reportDetails.token1)).toBe(getAddress(addressString(GENESIS_REPUTATION_TOKEN)))
		expect(getAddress(reportDetails.token2)).toBe(getAddress(WETH_ADDRESS))
		expect(reportDetails.settlementTimestamp).toBe(0n)
		expect(reportDetails.createdAt).toBeGreaterThan(0n)
		expect(reportDetails.token1Decimals).toBe(18)
		expect(reportDetails.token2Decimals).toBe(0)
		expect(reportDetails.stateHash).toBe((await getOpenOracleExtraData(client, reportId)).stateHash)
	})

	test('submitted and settled reports are tracked in loadOpenOracleReportDetails', async () => {
		const { requestPriceEthCost } = await loadOracleManagerDetails(uiReadClient, managerAddress)
		await requestOraclePrice(uiWriteClient, managerAddress, requestPriceEthCost)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const PRICE_PRECISION = 10n ** 18n
		const amount1 = exactToken1Report
		const amount2 = (amount1 * PRICE_PRECISION) / startingRepEthPrice

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
	})
})
