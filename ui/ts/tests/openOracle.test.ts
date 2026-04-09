/// <reference types="bun-types" />

import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, zeroAddress, type Address } from 'viem'
import { getOpenOracleAddress, loadOracleManagerDetails, loadOpenOracleReportDetails, requestOraclePrice, submitInitialOracleReport, settleOracleReport } from '../contracts.js'
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

	test('loadOracleManagerDetails reflects initial manager state after deployment', async () => {
		const details = await loadOracleManagerDetails(uiReadClient, managerAddress)

		expect(details.managerAddress).toBe(managerAddress)
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

		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, openOracleAddress, reportId)

		reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.settlementTimestamp).toBeGreaterThan(0n)
	})
})
