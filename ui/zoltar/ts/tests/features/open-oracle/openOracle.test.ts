/// <reference types="bun-types" />

import { beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { getAddress, maxUint256, zeroAddress, type Address, type Hash } from '@zoltar/shared/ethereum'
import {
	createOpenOracleReportInstance,
	executeOracleManagerStagedOperation,
	getOpenOracleAddress,
	loadCoordinatorInitialReportFundingRequirement,
	loadErc20Balance,
	loadOpenOracleWithdrawableBalances,
	loadOpenOracleReportDetails,
	loadOpenOracleReportSummaries,
	loadOracleManagerDetails,
	queueOracleManagerOperation,
	queueSecurityPoolLiquidation,
	requestOraclePrice,
	settleOracleReport,
	withdrawOpenOracleBalance,
	wrapWeth as wrapUiWeth,
} from '../../../protocol/index.js'
import {
	addOpenOracleBountyBuffer,
	deriveOpenOracleDisputeSubmissionDetails,
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleFeePercentage,
	formatOpenOracleFeePercentageInput,
	formatOpenOracleMultiplier,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateValidationMessage,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportStatus,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	parseOpenOracleCreateFormSubmission,
	parseOpenOracleFeePercentageInput,
} from '../../../features/open-oracle/lib/openOracle.js'
import { loadOpenOracleInitialReportPrice, loadOpenOracleInitialReportPriceResult } from '../../../protocol/openOraclePricing.js'
import { getDefaultOpenOracleCreateFormState } from '../../../lib/formDefaults.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../../../protocol/oracleTiming.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js'
import { ETH_ADDRESS, REP_ADDRESS, UNISWAP_V4_QUOTER_ADDRESS, USDC_ADDRESS } from '../../../protocol/uniswapQuoter.js'
import { resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { InjectedEthereum } from '@zoltar/ui-core-shared/injectedEthereum.js'
import type { WriteContractClient } from '../../../protocol/core.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS, TEST_ADDRESSES } from '../../../../../../solidity/ts/testSupport/simulator/utils/constants'
import { addressString } from '../../../../../../solidity/ts/testSupport/simulator/utils/bigint'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../../../../../../solidity/ts/testSupport/simulator/utils/utilities'
import { AnvilWindowEthereum } from '../../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient } from '../../../../../../solidity/ts/testSupport/simulator/utils/clients'
import { deployOriginSecurityPool, ensureInfraDeployed, getSecurityPoolAddresses } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast'
import { ensureZoltarDeployed } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar'
import { createQuestion, getQuestionId } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getOpenOracleExtraData, getRequestPriceCostAttoEth, requestPriceWithValue } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/statoblast'

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
const statoblastSecurityMultiplierBps = 20_000n
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
		await deployOriginSecurityPool(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		managerAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, statoblastSecurityMultiplierBps).priceOracleManagerAndOperatorQueuer
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		resetActiveEnvironmentForTesting()
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
			initialToken2Amount: 1n,
			ethValueAttoEth: 1_000n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerRewardAttoEth: 1_000n,
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		})
		expect(createResult1.action).toBe('createReportInstance')

		const createResult2 = await createOpenOracleReportInstance(uiWriteClient, {
			disputeDelay: 10,
			escalationHalt: 0n,
			exactToken1Report: 2n,
			initialToken2Amount: 2n,
			ethValueAttoEth: 1_100n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerRewardAttoEth: 1_100n,
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
		expect(getOpenOracleReportStatus(newestReport)).toBe('Pending')

		const firstPage = await loadOpenOracleReportSummaries(uiReadClient, 0, 10)
		expect(firstPage.reports.map(report => report.reportId)).toEqual([2n, 1n])
		expect(firstPage.reports.map(report => report.price)).toEqual([10n ** 30n, 10n ** 30n])
	})

	test('settlement stays successful while reporter liquidity and a third-party settler reward remain independently withdrawable', async () => {
		const reporter = uiWriteClient.account.address
		const settler = getAddress(addressString(TEST_ADDRESSES[1]))
		const token1Amount = 3n
		const token2Amount = 4n
		await wrapUiWeth(uiWriteClient, token2Amount)
		const repBalanceBeforeReport = await loadErc20Balance(uiReadClient, addressString(GENESIS_REPUTATION_TOKEN), reporter)
		const wethBalanceAttoEthBeforeReport = await loadErc20Balance(uiReadClient, WETH_ADDRESS, reporter)

		await createOpenOracleReportInstance(uiWriteClient, {
			disputeDelay: 10,
			escalationHalt: 0n,
			exactToken1Report: token1Amount,
			initialToken2Amount: token2Amount,
			ethValueAttoEth: 1_000n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 100,
			settlementTime: 60,
			settlerRewardAttoEth: 1_000n,
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		})
		const report = (await loadOpenOracleReportSummaries(uiReadClient, 0, 1)).reports[0]
		if (report === undefined) throw new Error('Expected a standalone report')
		expect(await loadErc20Balance(uiReadClient, addressString(GENESIS_REPUTATION_TOKEN), reporter)).toBe(repBalanceBeforeReport - token1Amount)
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, reporter)).toBe(wethBalanceAttoEthBeforeReport - token2Amount)

		await mockWindow.advanceTime(61n)
		installInjectedEthereum(mockWindow, settler)
		const settlerWriteClient = createWalletWriteClient(settler)
		const settlement = await settleOracleReport(settlerWriteClient, getOpenOracleAddress(), report.reportId)
		expect(settlement.action).toBe('settle')
		expect(await loadErc20Balance(uiReadClient, addressString(GENESIS_REPUTATION_TOKEN), reporter)).toBe(repBalanceBeforeReport - token1Amount)
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, reporter)).toBe(wethBalanceAttoEthBeforeReport - token2Amount)

		const reporterWithdrawable = await loadOpenOracleWithdrawableBalances(uiReadClient, getOpenOracleAddress(), reporter, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), getAddress(WETH_ADDRESS))
		const settlerWithdrawable = await loadOpenOracleWithdrawableBalances(uiReadClient, getOpenOracleAddress(), settler, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), getAddress(WETH_ADDRESS))
		expect(reporterWithdrawable).toEqual({ ethAttoEth: 0n, token1: token1Amount, token2: token2Amount })
		expect(settlerWithdrawable).toEqual({ ethAttoEth: 1_000n, token1: 0n, token2: 0n })

		installInjectedEthereum(mockWindow, reporter)
		await withdrawOpenOracleBalance(uiWriteClient, getOpenOracleAddress(), getAddress(addressString(GENESIS_REPUTATION_TOKEN)), maxUint256, reporter)
		await withdrawOpenOracleBalance(uiWriteClient, getOpenOracleAddress(), getAddress(WETH_ADDRESS), maxUint256, reporter)
		installInjectedEthereum(mockWindow, settler)
		await withdrawOpenOracleBalance(settlerWriteClient, getOpenOracleAddress(), zeroAddress, maxUint256, settler)
		expect(await loadErc20Balance(uiReadClient, addressString(GENESIS_REPUTATION_TOKEN), reporter)).toBe(repBalanceBeforeReport)
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, reporter)).toBe(wethBalanceAttoEthBeforeReport)
		for (const [holder, token] of [
			[reporter, getAddress(addressString(GENESIS_REPUTATION_TOKEN))],
			[reporter, getAddress(WETH_ADDRESS)],
			[settler, zeroAddress],
		] as const) {
			expect(
				await client.readContract({
					abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
					address: getOpenOracleAddress(),
					functionName: 'tokenHolder',
					args: [holder, token],
				}),
			).toBe(1n)
		}
	})

	test('createOpenOracleReportInstance rejects numeric parameters above Number.MAX_SAFE_INTEGER', async () => {
		await expect(
			createOpenOracleReportInstance(uiWriteClient, {
				disputeDelay: Number.MAX_SAFE_INTEGER + 1,
				escalationHalt: 0n,
				exactToken1Report: 1n,
				initialToken2Amount: 1n,
				ethValueAttoEth: 1_000n,
				feePercentage: 100,
				multiplier: 100,
				protocolFee: 100,
				settlementTime: 60,
				settlerRewardAttoEth: 1_000n,
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
				initialToken2Amount: 1n,
				ethValueAttoEth: 1_000n,
				feePercentage: 100,
				multiplier: 65_536,
				protocolFee: 100,
				settlementTime: 60,
				settlerRewardAttoEth: 1_000n,
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

	test('initial report price helpers select the Uniswap version with the most executable liquidity', async () => {
		const client = createConnectedReadClient()
		client.simulateContract = async parameters => {
			if (parameters.address === UNISWAP_V4_QUOTER_ADDRESS) return { result: [25n, 0n], request: {} as never } as never
			return { result: [40n, 0n, 0, 0n], request: {} as never } as never
		}
		client.readContract = async () => zeroAddress as never

		await expect(loadOpenOracleInitialReportPrice(client, REP_ADDRESS, WETH_ADDRESS, 100n)).resolves.toEqual({
			price: 2_500_000_000_000_000_000_000_000_000_000n,
			priceSource: 'Uniswap V3',
			token2Amount: 40n,
		})
	})

	test('initial report price helpers retain a usable V4 quote when V3 is unavailable', async () => {
		const client = createConnectedReadClient()
		client.simulateContract = async parameters => {
			if (parameters.address === UNISWAP_V4_QUOTER_ADDRESS) return { result: [25n, 0n], request: {} as never } as never
			throw new Error('no v3 pool')
		}

		await expect(loadOpenOracleInitialReportPrice(client, REP_ADDRESS, WETH_ADDRESS, 100n)).resolves.toEqual({
			price: 4_000_000_000_000_000_000_000_000_000_000n,
			priceSource: 'Uniswap V4',
			token2Amount: 25n,
		})
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

	test('dispute submission helper computes token contributions across both swap directions', () => {
		const cases = [
			{ disputeNewAmount2Input: '80', disputeTokenToSwap: 'token1' as const, expectedToken1Contribution: 315n, expectedToken2Contribution: 30n },
			{ disputeNewAmount2Input: '120', disputeTokenToSwap: 'token2' as const, expectedToken1Contribution: 100n, expectedToken2Contribution: 177n },
		]

		for (const testCase of cases) {
			const preview = createDisputeSubmissionPreview({
				disputeNewAmount2Input: testCase.disputeNewAmount2Input,
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

	test('dispute submission helper uses the reduced self-dispute contribution in both swap directions', () => {
		const currentReporter = getAddress(addressString(TEST_ADDRESSES[1]))
		const cases = [
			{ disputeNewAmount2Input: '80', disputeTokenToSwap: 'token1' as const, expectedToken1Contribution: 105n, expectedToken2Contribution: 30n, token1Balance: 105n, token2Balance: 30n },
			{ disputeNewAmount2Input: '120', disputeTokenToSwap: 'token2' as const, expectedToken1Contribution: 100n, expectedToken2Contribution: 72n, token1Balance: 100n, token2Balance: 72n },
		]

		for (const testCase of cases) {
			const selfDisputePreview = createDisputeSubmissionPreview({
				accountAddress: currentReporter,
				approvedToken1Amount: testCase.token1Balance,
				approvedToken2Amount: testCase.token2Balance,
				disputeNewAmount2Input: testCase.disputeNewAmount2Input,
				disputeTokenToSwap: testCase.disputeTokenToSwap,
				token1Balance: testCase.token1Balance,
				token2Balance: testCase.token2Balance,
			})
			const thirdPartyPreview = createDisputeSubmissionPreview({
				accountAddress: getAddress(addressString(TEST_ADDRESSES[2])),
				approvedToken1Amount: testCase.token1Balance,
				approvedToken2Amount: testCase.token2Balance,
				disputeNewAmount2Input: testCase.disputeNewAmount2Input,
				disputeTokenToSwap: testCase.disputeTokenToSwap,
				token1Balance: testCase.token1Balance,
				token2Balance: testCase.token2Balance,
			})

			expect(selfDisputePreview.token1ContributionAmount).toBe(testCase.expectedToken1Contribution)
			expect(selfDisputePreview.token2ContributionAmount).toBe(testCase.expectedToken2Contribution)
			expect(selfDisputePreview.canSubmit).toBe(true)
			expect(thirdPartyPreview.canSubmit).toBe(false)
		}
	})

	test('dispute submission blockers use base and quote token terminology', () => {
		expect(createDisputeSubmissionPreview({ disputeNewAmount1Input: '' }).blockMessage?.message).toBe('Enter a valid new base token amount.')
		expect(createDisputeSubmissionPreview({ disputeNewAmount2Input: '0' }).blockMessage?.message).toBe('Enter a valid new quote token amount greater than zero.')
		expect(createDisputeSubmissionPreview({ disputeNewAmount1Input: '201' }).blockMessage?.message).toBe('New base token amount must be exactly 200 for this dispute.')
	})

	test('blocks dispute approvals when the proposed price direction conflicts with the selected swap token', () => {
		const preview = createDisputeSubmissionPreview({
			disputeTokenToSwap: 'token2',
		})

		expect(preview.canSubmit).toBe(false)
		expect(preview.inputBlockMessage?.message).toBe('These amounts would swap out REP, not WETH. Select REP or change the proposed price.')
		expect(preview.blockMessage).toEqual(preview.inputBlockMessage)
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
				initialToken2Amount: '2',
				ethValue: '0.000000000000001',
				feePercentage: '0.001',
				multiplier: '100',
				protocolFee: '0.002',
				settlementTime: '60',
				settlerRewardEthAmount: '0.000000000000001',
				token1Address,
				token2Address: WETH_ADDRESS,
			},
			token1Decimals: 6,
			token2Decimals: 18,
		})

		expect(parsed).toEqual({
			disputeDelay: 10,
			escalationHalt: 2_500_000n,
			exactToken1Report: 1_250_000n,
			initialToken2Amount: 2_000_000_000_000_000_000n,
			ethValueAttoEth: 1000n,
			feePercentage: 100,
			multiplier: 100,
			protocolFee: 200,
			settlementTime: 60,
			settlerRewardAttoEth: 1000n,
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
			initialToken2Amount: '1',
			ethValue: '1',
			feePercentage: '1',
			multiplier: '100',
			protocolFee: '1',
			settlementTime: '60',
			settlerRewardEthAmount: '1',
			token1Address,
			token2Address: WETH_ADDRESS,
		}

		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '0' } })).toBe('Base token amount must be greater than zero.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, token2Address: token1Address } })).toBe('Base and quote tokens must use different addresses.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlementTime: '9' } })).toBe('Settlement time must be greater than dispute delay.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, feePercentage: '60', protocolFee: '50.00001' } })).toBe('Fee percentage plus protocol fee must not exceed 100%.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, multiplier: '99' } })).toBe('Multiplier must be at least 1.00x.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '1000000000' } })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '1000000000' }, token1Decimals: 18 })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount } })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount }, token1Decimals: 36 })).toBeUndefined()
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '.' } })).toBe('Enter a valid base token amount.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: '-.' } })).toBe('Enter a valid base token amount.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: '.' } })).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: '-.' } })).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, multiplier: (1n << 16n).toString() } })).toBe('Multiplier exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, disputeDelay: (1n << 24n).toString() } })).toBe('Dispute delay exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlementTime: (1n << 48n).toString() } })).toBe('Settlement time exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, exactToken1Report: (1n << 128n).toString() }, token1Decimals: 18 })).toBe('Base token amount exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, escalationHalt: (1n << 128n).toString() }, token1Decimals: 18 })).toBe('Escalation halt exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, settlerRewardEthAmount: (1n << 96n).toString() } })).toBe('Settler reward exceeds the contract maximum.')
		expect(getOpenOracleCreateValidationMessage({ form: { ...baseForm, ethValue: (1n << 96n).toString() } })).toBe('ETH value to send exceeds the contract maximum.')
	})

	test('open oracle create parser accepts high-decimal token1 amounts once token decimals are known', () => {
		const parsed = parseOpenOracleCreateFormSubmission({
			form: {
				...getDefaultOpenOracleCreateFormState(),
				disputeDelay: '10',
				escalationHalt: '0.000000000000000000000000000000000001',
				exactToken1Report: '0.000000000000000000000000000000000001',
				initialToken2Amount: '1',
				ethValue: '1',
				feePercentage: '1',
				multiplier: '100',
				protocolFee: '1',
				settlementTime: '60',
				settlerRewardEthAmount: '1',
				token1Address: addressString(GENESIS_REPUTATION_TOKEN),
				token2Address: WETH_ADDRESS,
			},
			token1Decimals: 36,
			token2Decimals: 18,
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
					initialToken2Amount: '1',
					ethValue: '1',
					feePercentage: '60',
					multiplier: '100',
					protocolFee: '50.00001',
					settlementTime: '60',
					settlerRewardEthAmount: '1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
				token2Decimals: 18,
			}),
		).toThrow('Fee percentage plus protocol fee must not exceed 100%.')
		expect(() =>
			parseOpenOracleCreateFormSubmission({
				form: {
					...getDefaultOpenOracleCreateFormState(),
					disputeDelay: '10',
					exactToken1Report: '1',
					initialToken2Amount: '1',
					ethValue: '1',
					feePercentage: '1',
					multiplier: (1n << 16n).toString(),
					protocolFee: '1',
					settlementTime: '60',
					settlerRewardEthAmount: '1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
				token2Decimals: 18,
			}),
		).toThrow('Multiplier exceeds the contract maximum.')
	})

	test('oracle bounty buffer adds a 20% headroom and rounds up', () => {
		expect(addOpenOracleBountyBuffer(101n)).toBe(122n)
		expect(addOpenOracleBountyBuffer(1_000n)).toBe(1_200n)
	})

	test('selected report action mode follows the report lifecycle', () => {
		expect(() => getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentReporter: zeroAddress, reportTimestamp: 0n }))).toThrow('Open Oracle report is missing its atomic initial report')
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

		const insideDisputeWindow = createOpenOracleLifecycleReport({ currentTime: 159n })
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
			canAct: false,
			message: 'Dispute window closed. Settle report instead.',
		})
		expect(getOpenOracleSettleAvailability(exactSettlementBoundary)).toEqual({
			canAct: true,
			message: undefined,
		})
		expect(getOpenOracleSelectedReportActionMode(exactSettlementBoundary)).toBe('settle')

		const afterSettlementWindow = createOpenOracleLifecycleReport({ currentTime: 161n })
		expect(getOpenOracleDisputeAvailability(afterSettlementWindow)).toEqual({
			canAct: false,
			message: 'Dispute window closed. Settle report instead.',
		})
		expect(getOpenOracleSettleAvailability(afterSettlementWindow)).toEqual({
			canAct: true,
			message: undefined,
		})
	})

	test('dispute and settle availability use current block number for block-based reports', () => {
		const cases = [
			{ currentBlockNumber: 159n, disputeCanAct: true, settleCanAct: false },
			{ currentBlockNumber: 160n, disputeCanAct: false, settleCanAct: true },
			{ currentBlockNumber: 161n, disputeCanAct: false, settleCanAct: true },
		]

		for (const testCase of cases) {
			const blockBasedReport = createOpenOracleLifecycleReport({
				currentBlockNumber: testCase.currentBlockNumber,
				currentTime: 1n,
				timeType: false,
			})
			expect(getOpenOracleDisputeAvailability(blockBasedReport).canAct).toBe(testCase.disputeCanAct)
			expect(getOpenOracleSettleAvailability(blockBasedReport).canAct).toBe(testCase.settleCanAct)
		}
	})

	test('dispute and settle availability reject invalid attoETH/attoREP reports or already-settled reports', () => {
		const noInitialReport = createOpenOracleLifecycleReport({
			currentReporter: zeroAddress,
			reportTimestamp: 0n,
		})
		expect(getOpenOracleDisputeAvailability(noInitialReport)).toEqual({
			canAct: false,
			message: 'This report is invalid because its atomic initial report is missing.',
		})
		expect(getOpenOracleSettleAvailability(noInitialReport)).toEqual({
			canAct: false,
			message: 'This report is invalid because its atomic initial report is missing.',
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
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: no initial report'))).toBe('This report is invalid because its atomic initial report is missing.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute too early'))).toBe('This report is not ready to dispute.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute period expired'))).toBe('Dispute window closed. Settle report instead.')
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
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1ReportAttoEth',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1ReportAttoEth)

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
		expect(reportDetails.token1Decimals).toBe(18)
		expect(reportDetails.token2Decimals).toBe(18)
		expect(reportDetails.token1Symbol).toBe('WETH')
		expect(reportDetails.token2Symbol).toBe('REP')
		expect(reportDetails.stateHash).toBe((await getOpenOracleExtraData(client, reportId)).stateHash)
	})

	test('requestOraclePrice submits the reviewed ETH value after the live request cost changes', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const reviewBaseFeeAttoEthPerGas = 1n * 10n ** 9n
		await mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${reviewBaseFeeAttoEthPerGas.toString(16)}`] })
		await mockWindow.request({ method: 'evm_mine', params: [] })
		const reviewedBaseCost = await getRequestPriceCostAttoEth(client, managerAddress)
		const reviewedRequestValueAttoEth = addOpenOracleBountyBuffer(reviewedBaseCost)
		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await mockWindow.request({ method: 'evm_mine', params: [] })
		expect(await getRequestPriceCostAttoEth(client, managerAddress)).not.toBe(reviewedBaseCost)

		let submittedRequestEthValue: bigint | undefined
		const writeClientWithPrepareSpy = createWalletWriteClient(addressString(TEST_ADDRESSES[0]), {
			onTransactionPrepared: preview => {
				if (preview.functionName === 'requestPrice') submittedRequestEthValue = preview.value
			},
		})
		await requestOraclePrice(writeClientWithPrepareSpy, managerAddress, minimumToken1ReportAttoEth, 0n, reviewedRequestValueAttoEth)

		expect(submittedRequestEthValue).toBe(reviewedRequestValueAttoEth)
	})

	test('requestOraclePrice accepts caller-selected WETH above the coordinator minimum', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const requestedInitialAttoWeth = minimumToken1ReportAttoEth * 3n

		await requestOraclePrice(uiWriteClient, managerAddress, 10n ** 18n, requestedInitialAttoWeth)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const reportDetails = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		expect(reportDetails.exactToken1Report).toBe(requestedInitialAttoWeth)
		expect(reportDetails.currentAmount1).toBe(requestedInitialAttoWeth)
		expect(reportDetails.currentAmount2).toBe(requestedInitialAttoWeth)
	})

	test('requestOraclePrice rejects a stale cached price when a fresh Uniswap quote is unavailable', async () => {
		const seededRepEthPrice = 2n * 10n ** 18n
		const seededRequestEthCost = await getRequestPriceCostAttoEth(client, managerAddress)

		await requestPriceWithValue(client, managerAddress, seededRequestEthCost, seededRepEthPrice)
		const seededReportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, getOpenOracleAddress(), seededReportId)
		await mockWindow.advanceTime(ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS + 1n)

		await expect(requestOraclePrice(uiWriteClient, managerAddress)).rejects.toThrow('Failed to fetch price from Uniswap')
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId).toBe(0n)
	})

	test('requestOraclePrice rejects fresh cached prices before wrap or approval side effects', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1ReportAttoEth',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		await requestOraclePrice(uiWriteClient, managerAddress, minimumToken1ReportAttoEth)
		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		await mockWindow.advanceTime(DAY)
		await settleOracleReport(uiWriteClient, getOpenOracleAddress(), reportId)
		const wethBalanceAttoEthAfterSettlement = await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)

		await expect(requestOraclePrice(uiWriteClient, managerAddress)).rejects.toThrow('A fresh oracle price is already available')
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)).toBe(wethBalanceAttoEthAfterSettlement)
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId).toBe(0n)
	})

	test('loadCoordinatorInitialReportFundingRequirement uses a live quote for the REP side', async () => {
		const minimumToken1ReportAttoEth = 100n * 10n ** 18n
		const quotedAmount2 = 7n * 10n ** 18n
		const currentWethBalanceAttoEth = 2n * 10n ** 18n
		const currentRepBalanceAttoRep = 300n * 10n ** 18n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const mockClient = createConnectedReadClient()
		mockClient.readContract = async parameters => {
			const address = parameters.address as Address
			const functionName = parameters.functionName as string
			if (functionName === 'minimumToken1ReportAttoEth') return minimumToken1ReportAttoEth as never
			if (functionName === 'lastPrice') throw new Error('A cached price must not be used for a new initial report')
			if (functionName === 'reputationToken') return reputationTokenAddress as never
			if (functionName === 'balanceOf' && address === WETH_ADDRESS) return currentWethBalanceAttoEth as never
			if (functionName === 'balanceOf' && address === reputationTokenAddress) return currentRepBalanceAttoRep as never
			throw new Error(`Unexpected read ${functionName} for ${address}`)
		}
		mockClient.simulateContract = async () => ({ result: [quotedAmount2, 100000n], request: {} as never }) as never

		const funding = await loadCoordinatorInitialReportFundingRequirement(mockClient, managerAddress, uiWriteClient.account.address)

		expect(funding.initialReportAmount2).toBe(quotedAmount2 * 2n)
		expect(funding.proposedRepPerEthPrice).toBe((quotedAmount2 * 10n ** 18n) / minimumToken1ReportAttoEth)
		expect(funding.minimumToken1ReportAttoEth).toBe(minimumToken1ReportAttoEth)
		expect(funding.maximumInitialAttoWeth).toBe(minimumToken1ReportAttoEth * 2n)
		expect(funding.wethShortfallAttoEth).toBe(minimumToken1ReportAttoEth * 2n - currentWethBalanceAttoEth)
	})

	test('loadCoordinatorInitialReportFundingRequirement funds a caller-selected WETH amount above the buffered minimum', async () => {
		const minimumToken1ReportAttoEth = 100n
		const requestedInitialAttoWeth = 250n
		const proposedRepPerEthPrice = 2n * 10n ** 18n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const mockClient = createConnectedReadClient()
		mockClient.readContract = async parameters => {
			const address = parameters.address as Address
			const functionName = parameters.functionName as string
			if (functionName === 'minimumToken1ReportAttoEth') return minimumToken1ReportAttoEth as never
			if (functionName === 'reputationToken') return reputationTokenAddress as never
			if (functionName === 'balanceOf' && address === WETH_ADDRESS) return 0n as never
			if (functionName === 'balanceOf' && address === reputationTokenAddress) return 1_000n as never
			throw new Error(`Unexpected read ${functionName} for ${address}`)
		}

		const funding = await loadCoordinatorInitialReportFundingRequirement(mockClient, managerAddress, uiWriteClient.account.address, proposedRepPerEthPrice, requestedInitialAttoWeth)

		expect(funding.minimumToken1ReportAttoEth).toBe(minimumToken1ReportAttoEth)
		expect(funding.requestedInitialAttoWeth).toBe(requestedInitialAttoWeth)
		expect(funding.maximumInitialAttoWeth).toBe(requestedInitialAttoWeth)
		expect(funding.initialReportAmount2).toBe(500n)
		expect(funding.wethShortfallAttoEth).toBe(requestedInitialAttoWeth)
	})

	test('loadCoordinatorInitialReportFundingRequirement selects liquidity at the requested report size', async () => {
		const minimumToken1ReportAttoEth = 100n
		const requestedInitialAttoWeth = 250n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const quotedExactAmounts: bigint[] = []
		const mockClient = createConnectedReadClient()
		mockClient.readContract = async parameters => {
			const address = parameters.address as Address
			const functionName = parameters.functionName as string
			if (functionName === 'minimumToken1ReportAttoEth') return minimumToken1ReportAttoEth as never
			if (functionName === 'reputationToken') return reputationTokenAddress as never
			if (functionName === 'balanceOf' && address === WETH_ADDRESS) return 0n as never
			if (functionName === 'balanceOf' && address === reputationTokenAddress) return 1_000n as never
			if (functionName === 'getPool') return zeroAddress as never
			throw new Error(`Unexpected read ${functionName} for ${address}`)
		}
		mockClient.simulateContract = async parameters => {
			const args = parameters.args
			if (!Array.isArray(args)) throw new Error('Expected Uniswap quote arguments')
			const quoteParameters: unknown = args[0]
			if (typeof quoteParameters !== 'object' || quoteParameters === null) throw new Error('Expected Uniswap quote parameters')
			let exactAmount: unknown
			if ('exactAmount' in quoteParameters) exactAmount = quoteParameters.exactAmount
			else if ('amountIn' in quoteParameters) exactAmount = quoteParameters.amountIn
			if (typeof exactAmount !== 'bigint') throw new Error('Expected an exact Uniswap quote amount')
			quotedExactAmounts.push(exactAmount)
			if (parameters.address === UNISWAP_V4_QUOTER_ADDRESS) return { result: [50n, 0n], request: {} as never } as never
			return { result: [100n, 0n, 0, 0n], request: {} as never } as never
		}

		const funding = await loadCoordinatorInitialReportFundingRequirement(mockClient, managerAddress, uiWriteClient.account.address, undefined, requestedInitialAttoWeth)

		expect(quotedExactAmounts).toEqual(Array.from({ length: 8 }, () => requestedInitialAttoWeth))
		expect(funding.proposedRepPerEthPrice).toBe(400_000_000_000_000_000n)
		expect(funding.initialReportAmount2).toBe(100n)
	})

	test('requestOraclePrice rejects an unavailable first-report REP quote instead of assuming a price', async () => {
		await expect(requestOraclePrice(uiWriteClient, managerAddress)).rejects.toThrow('Failed to fetch price from Uniswap')
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId).toBe(0n)
	})

	test('requestOraclePrice rejects insufficient REP before WETH wrap side effects', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [
				{
					type: 'function',
					name: 'minimumToken1ReportAttoEth',
					stateMutability: 'view',
					inputs: [],
					outputs: [{ name: '', type: 'uint256' }],
				},
			],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const currentRepBalanceAttoRep = await client.readContract({
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
		if (typeof currentRepBalanceAttoRep !== 'bigint') throw new Error('expected bigint REP balance')
		const repToKeep = minimumToken1ReportAttoEth - 1n
		const repToTransfer = currentRepBalanceAttoRep - repToKeep
		const startWethBalanceAttoEth = await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)
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

		await expect(requestOraclePrice(uiWriteClient, managerAddress, minimumToken1ReportAttoEth)).rejects.toThrow('Insufficient REP balance for coordinator initial report')
		expect(await loadErc20Balance(uiReadClient, WETH_ADDRESS, uiWriteClient.account.address)).toBe(startWethBalanceAttoEth)
	})

	test('queueOracleManagerOperation returns queued operation metadata for the pending settlement list', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const result = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'liquidation', addressString(TEST_ADDRESSES[1]), 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1ReportAttoEth)

		expect(result.queuedOperation).toBeDefined()
		expect(result.queuedOperation?.isPendingSlot).toBe(true)
		expect(result.queuedOperation?.operation).toBe('liquidation')
		expect(result.queuedOperation?.operationId).toBeGreaterThan(0n)
		expect(result.stagedExecution).toBeUndefined()
	})

	test('automatic coordinator operations select Uniswap liquidity at the requested report size', async () => {
		const minimumToken1ReportAttoEth = 100n
		const requestedInitialAttoWeth = 250n
		const reputationTokenAddress = getAddress('0x00000000000000000000000000000000000000f1')
		const transactionHash = `0x${'3'.repeat(64)}` as Hash
		const runOperation = async (operation: 'request' | 'liquidation-helper' | 'generic') => {
			const quotedExactAmounts: bigint[] = []
			const preparedQueueArguments: Array<readonly unknown[]> = []
			const onTransactionPrepared: NonNullable<typeof uiWriteClient.onTransactionPrepared> = preview => {
				if ((preview.functionName === 'requestPrice' || preview.functionName === 'requestPriceIfNeededAndStageOperation' || preview.functionName === 'requestPriceIfNeededAndStageLiquidation') && preview.args !== undefined) preparedQueueArguments.push(preview.args)
			}
			const readContract: typeof uiWriteClient.readContract = async parameters => {
				if (parameters.functionName === 'lastPrice') return 0n as never
				if (parameters.functionName === 'getPendingSettlementOperationIds') return [] as never
				if (parameters.functionName === 'MAX_PENDING_SETTLEMENT_OPERATIONS') return 8n as never
				if (parameters.functionName === 'pendingReportId') return 0n as never
				if (parameters.functionName === 'getQueuedOperationCostAttoEth') return 0n as never
				if (parameters.functionName === 'getRequestPriceCostAttoEth') return 10n as never
				if (parameters.functionName === 'isPriceValid') return false as never
				if (parameters.functionName === 'minimumToken1ReportAttoEth') return minimumToken1ReportAttoEth as never
				if (parameters.functionName === 'reputationToken') return reputationTokenAddress as never
				if (parameters.functionName === 'balanceOf') return 1_000n as never
				if (parameters.functionName === 'getPool') return zeroAddress as never
				throw new Error(`Unexpected read ${parameters.functionName} for ${parameters.address}`)
			}
			const simulateContract: typeof uiWriteClient.simulateContract = async parameters => {
				const args = parameters.args
				if (!Array.isArray(args)) throw new Error('Expected Uniswap quote arguments')
				const quoteParameters: unknown = args[0]
				if (typeof quoteParameters !== 'object' || quoteParameters === null) throw new Error('Expected Uniswap quote parameters')
				let exactAmount: unknown
				if ('exactAmount' in quoteParameters) exactAmount = quoteParameters.exactAmount
				else if ('amountIn' in quoteParameters) exactAmount = quoteParameters.amountIn
				if (typeof exactAmount !== 'bigint') throw new Error('Expected an exact Uniswap quote amount')
				quotedExactAmounts.push(exactAmount)
				if (parameters.address === UNISWAP_V4_QUOTER_ADDRESS) return { result: [50n, 0n], request: {} as never } as never
				return { result: [100n, 0n, 0, 0n], request: {} as never } as never
			}
			const mockClient = {
				...uiWriteClient,
				onTransactionPrepared,
				readContract,
				simulateContract,
				sendTransaction: async () => transactionHash,
				waitForTransactionReceipt: async () => createSuccessfulReceipt(transactionHash, managerAddress),
			}

			if (operation === 'request') await requestOraclePrice(mockClient, managerAddress, undefined, requestedInitialAttoWeth, 12n)
			else if (operation === 'liquidation-helper') await queueSecurityPoolLiquidation(mockClient, managerAddress, client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, requestedInitialAttoWeth)
			else await queueOracleManagerOperation(mockClient, managerAddress, 'liquidation', client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, undefined, requestedInitialAttoWeth)

			expect(quotedExactAmounts).toEqual(Array.from({ length: 8 }, () => requestedInitialAttoWeth))
			let expectedArguments: readonly unknown[]
			if (operation === 'request') expectedArguments = [400_000_000_000_000_000n, requestedInitialAttoWeth]
			else if (operation === 'liquidation-helper') expectedArguments = [client.account.address, client.account.address, 1n, `0x${'00'.repeat(32)}`, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 400_000_000_000_000_000n, requestedInitialAttoWeth]
			else expectedArguments = [expect.anything(), client.account.address, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, 400_000_000_000_000_000n, requestedInitialAttoWeth]
			expect(preparedQueueArguments).toEqual([expectedArguments])
		}

		await runOperation('request')
		await runOperation('liquidation-helper')
		await runOperation('generic')
	})

	test('queueOracleManagerOperation preserves incremental ids when adding to the pending settlement list', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const firstResult = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'liquidation', addressString(TEST_ADDRESSES[1]), 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1ReportAttoEth)
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
		expect(details.stagedOperations?.map(operation => operation.operation)).toEqual(['liquidation', 'liquidation'])
	})

	test('queueOracleManagerOperation only lets the pending report sponsor add more queued operations', async () => {
		const secondAddress = addressString(TEST_ADDRESSES[1])
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		await mockWindow.setNextBlockBaseFeePerGasToZero()
		await queueOracleManagerOperation(uiWriteClient, managerAddress, 'liquidation', secondAddress, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1ReportAttoEth)

		const managerDetails = await loadOracleManagerDetails(uiReadClient, managerAddress)
		expect(managerDetails.pendingReportId).toBeGreaterThan(0n)
		expect(managerDetails.queuedOperationCostAttoEth).toBe(0n)

		await mockWindow.setNextBlockBaseFeePerGasToZero()
		installInjectedEthereum(mockWindow, secondAddress)
		const secondUiWriteClient = createWalletWriteClient(secondAddress)
		await expect(queueOracleManagerOperation(secondUiWriteClient, managerAddress, 'liquidation', addressString(TEST_ADDRESSES[2]), 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS, minimumToken1ReportAttoEth)).rejects.toThrow('Only the pending report sponsor can queue more operations until settlement')
		const queuedResult = await queueOracleManagerOperation(uiWriteClient, managerAddress, 'liquidation', secondAddress, 1n, DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS)

		expect(queuedResult.queuedOperation).toBeDefined()
		expect(queuedResult.queuedOperation?.isPendingSlot).toBe(true)
		expect((await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingSettlementOperationIds.length).toBe(2)
	})

	test('submitted and settled reports are tracked in loadOpenOracleReportDetails', async () => {
		const minimumToken1ReportAttoEth = await client.readContract({
			address: managerAddress,
			abi: [{ type: 'function', name: 'minimumToken1ReportAttoEth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] }],
			functionName: 'minimumToken1ReportAttoEth',
			args: [],
		})
		if (typeof minimumToken1ReportAttoEth !== 'bigint') throw new Error('expected bigint minimumToken1ReportAttoEth')
		const proposedRepPerEthPrice = 10n ** 18n
		await requestOraclePrice(uiWriteClient, managerAddress, proposedRepPerEthPrice, minimumToken1ReportAttoEth)

		const reportId = (await loadOracleManagerDetails(uiReadClient, managerAddress)).pendingReportId
		const { exactToken1Report: reportExactToken1Report } = await loadOpenOracleReportDetails(uiReadClient, getOpenOracleAddress(), reportId)
		const amount1 = reportExactToken1Report
		const expectedAmount2 = (amount1 * proposedRepPerEthPrice + 10n ** 18n - 1n) / 10n ** 18n
		const openOracleAddress = getOpenOracleAddress()

		let reportDetails = await loadOpenOracleReportDetails(uiReadClient, openOracleAddress, reportId)
		expect(reportDetails.currentAmount1).toBe(amount1)
		expect(reportDetails.currentAmount2).toBe(expectedAmount2)
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
