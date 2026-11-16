import { wrapWeth as wrapUiWeth } from '@zoltar/ui-statoblast-shared/protocol/wethFunding.js'
import { deployTestPortfolio } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployTestPortfolio.js'
/// <reference types="bun-types" />

import { ABIS } from '@zoltar/ui-core-shared/abis.js'

import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { getAddress, maxUint256, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createOpenOracleReportInstance, loadOpenOracleWithdrawableBalances, loadOpenOracleReportSummaries, settleOracleReport, withdrawOpenOracleBalance } from '@zoltar/ui-statoblast-shared/protocol/openOracle.js'
import { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import { formatCeilingAmountDisplay } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getOpenOracleAddress } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import {
	formatOpenOracleDisputeWriteErrorMessage,
	formatOpenOracleFeePercentage,
	formatOpenOracleMultiplier,
	formatOpenOracleSettleWriteErrorMessage,
	getOpenOracleCreateGuardMessage,
	getOpenOracleCreateValidation,
	getOpenOracleDisputeAvailability,
	getOpenOracleReportProgress,
	getOpenOracleSelectedReportActionMode,
	getOpenOracleSettleAvailability,
	parseOpenOracleCreateFormSubmission,
} from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracle.js'
import { deriveOpenOracleDisputeSubmissionDetails } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleDispute.js'
import { getDefaultOpenOracleCreateFormState } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/formDefaults.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

// Anvil installs this REP fixture; mainnet supplies the WETH and Uniswap quote addresses.
const REP_ADDRESS = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
const _USDC_ADDRESS = MAINNET_NETWORK_PROFILE.usdcAddress
const _UNISWAP_V4_QUOTER_ADDRESS = MAINNET_NETWORK_PROFILE.uniswapV4QuoterAddress
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { InjectedEthereum } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
import { DAY, GENESIS_REPUTATION_TOKEN, WETH_ADDRESS, TEST_ADDRESSES } from '../../../../../../solidity/ts/testSupport/simulator/utils/constants.js'
import { addressString } from '../../../../../../solidity/ts/testSupport/simulator/utils/bigint.js'
import { setupTestAccounts, ensureProxyDeployerDeployed } from '../../../../../../solidity/ts/testSupport/simulator/utils/utilities.js'
import { AnvilWindowEthereum } from '../../../../../../solidity/ts/testSupport/simulator/AnvilWindowEthereum.js'
import { useIsolatedAnvilNode } from '../../../../../../solidity/ts/testSupport/simulator/useIsolatedAnvilNode.js'
import { createWriteClient, type WriteClient } from '../../../../../../solidity/ts/testSupport/simulator/utils/clients.js'
import { ensureInfraDeployed } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/deployStatoblast.js'
import { ensureZoltarDeployed } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltar.js'
import { createQuestion } from '../../../../../../solidity/ts/testSupport/simulator/utils/contracts/zoltarQuestionData.js'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'

function installInjectedEthereum(mockWindow: AnvilWindowEthereum, accountAddress: Address = addressString(TEST_ADDRESSES[0])) {
	const globalWindow = globalThis as typeof globalThis & { window?: Window }
	if (globalWindow.window === undefined) globalWindow.window = globalThis as Window & typeof globalThis
	const request: InjectedEthereum['request'] = async args => {
		if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [accountAddress] as never
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
const _DEFAULT_SELF_OPERATION_TIMEOUT_SECONDS = 5n * 60n
const outcomes = ['Yes', 'No']

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

function createDisputeSubmissionPreviewReport() {
	return {
		currentAmount1: 100n,
		currentAmount2: 50n,
		currentBlockNumber: 0n,
		currentReporter: getAddress(addressString(TEST_ADDRESSES[1])),
		currentTime: 200n,
		disputeDelay: 10n,
		escalationHalt: 200n,
		feePercentage: 1_000_000n,
		feesOnlyAtHalt: false,
		flexibleEscalation: false,
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
	}
}

function createDisputeSubmissionPreview(overrides: Partial<Parameters<typeof deriveOpenOracleDisputeSubmissionDetails>[0]> = {}) {
	return deriveOpenOracleDisputeSubmissionDetails({
		approvedToken1Amount: 1_000n,
		approvedToken2Amount: 1_000n,
		disputeNewAmount1Input: '200',
		disputeNewAmount2Input: '80',
		reportDetails: createDisputeSubmissionPreviewReport(),
		token1AllowanceError: undefined,
		token1Balance: 1_000n,
		token1BalanceError: undefined,
		token1Decimals: 0,
		token2AllowanceError: undefined,
		token2Balance: 1_000n,
		token2BalanceError: undefined,
		token2Decimals: 0,
		walletEthBalanceAttoEth: undefined,
		wethAddress: undefined,
		...overrides,
	})
}

describe('OpenOracle helpers', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let client: WriteClient
	let uiReadClient: ReturnType<typeof createConnectedReadClient>
	let uiWriteClient: ReturnType<typeof createWalletWriteClient>
	let _managerAddress: Address

	async function installSepoliaClients() {
		mockWindow = getAnvilWindowEthereum()
		await mockWindow.request({ method: 'anvil_setChainId', params: [SEPOLIA_NETWORK_PROFILE.chain.id] })
		client = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0, SEPOLIA_NETWORK_PROFILE.chain)
		installInjectedEthereum(mockWindow)
		installActiveEnvironmentForTesting(createInjectedBackend({ profile: { ...MAINNET_NETWORK_PROFILE, genesisRepTokenAddress: REP_ADDRESS, chain: SEPOLIA_NETWORK_PROFILE.chain, chainIdHex: SEPOLIA_NETWORK_PROFILE.chainIdHex, id: 'sepolia', displayName: 'Sepolia' } }))
		uiReadClient = {
			...createConnectedReadClient(),
			getLogs: async () => {
				throw new Error('UI log access is unavailable')
			},
		}
		uiWriteClient = {
			...createWalletWriteClient(addressString(TEST_ADDRESSES[0])),
			getLogs: async () => {
				throw new Error('UI log access is unavailable')
			},
		}
	}

	beforeAll(async () => {
		await installSepoliaClients()
		await setupTestAccounts(mockWindow)
		await ensureProxyDeployerDeployed(client)
		await ensureZoltarDeployed(client)
		await ensureInfraDeployed(client)

		const currentTimestamp = await mockWindow.getTime()
		const questionData = {
			title: 'Test question for OpenOracle',
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
		const portfolio = await deployTestPortfolio(client, genesisUniverse, questionId, statoblastSecurityMultiplierBps)
		_managerAddress = portfolio.openOraclePriceCoordinator
		await setBaselineSnapshot()
	})

	beforeEach(async () => {
		resetActiveEnvironmentForTesting()
		await installSepoliaClients()
	})

	afterEach(() => resetActiveEnvironmentForTesting())

	test('getOpenOracleAddress returns the deterministic non-zero oracle address', () => {
		expect(getOpenOracleAddress()).not.toBe(zeroAddress)
	})

	for (const preapproved of [false, true])
		test(`createOpenOracleReportInstance creates browsable reports with preapproved=${preapproved}`, async () => {
			if (preapproved)
				for (const address of [REP_ADDRESS, getAddress(WETH_ADDRESS)]) {
					const hash = await uiWriteClient.writeContract({ address, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [getOpenOracleAddress(), maxUint256] })
					await uiWriteClient.waitForTransactionReceipt({ hash })
				}

			let plannedFunctions: string[] = []
			let plannedTokenOrder: Address[] = []
			let plannedApprovalOrder: Address[] = []
			const preparedFunctions: string[] = []
			const createResult1 = await createOpenOracleReportInstance(
				{
					...uiWriteClient,
					onTransactionPlan: steps => {
						expect(preparedFunctions).toHaveLength(0)
						plannedFunctions = steps.map(step => step.functionName)
						plannedTokenOrder = steps.at(-1)?.tokenFunding?.map(token => token.tokenAddress) ?? []
						plannedApprovalOrder = steps.filter(step => step.functionName === 'approve').map(step => step.contractAddress)
					},
					onTransactionPrepared: preview => preparedFunctions.push(preview.functionName),
				},
				{
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
				},
			)
			expect(createResult1.action).toBe('createReportInstance')
			// The new report ID comes from the receipt, so the app can link straight to the report.
			expect(createResult1.reportId).toBe(1n)
			expect(plannedFunctions).toEqual(preparedFunctions)
			expect(plannedTokenOrder.map(address => address.toLowerCase())).toEqual([WETH_ADDRESS, REP_ADDRESS].map(address => address.toLowerCase()))
			if (preapproved) expect(plannedFunctions).not.toContain('approve')
			else {
				expect(plannedFunctions.slice(-3)).toEqual(['approve', 'approve', 'report'])
				expect(plannedApprovalOrder.map(address => address.toLowerCase())).toEqual([WETH_ADDRESS, REP_ADDRESS].map(address => address.toLowerCase()))
			}

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
			expect(createResult2.reportId).toBe(2n)

			const page = await loadOpenOracleReportSummaries(uiReadClient, 0, 1)
			expect(page.reportCount).toBe(2n)
			expect(page.reports).toHaveLength(1)
			const newestReport = page.reports[0]
			if (newestReport === undefined) throw new Error('Expected a newest report summary')
			expect(newestReport.reportId).toBe(2n)
			expect(getOpenOracleReportProgress(newestReport, { currentTime: newestReport.reportTimestamp })).toBe('awaiting-dispute-window')
			// Summaries carry lifecycle timing so browsing can show when a report is ready to settle.
			expect(newestReport.disputeDelay).toBe(10n)
			expect(newestReport.settlementTime).toBe(60n)

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
		).rejects.toThrow('Multiplier must be at most 655.35×.')
		expect(preparedCount).toBe(0)
	})

	test('dispute submission helper computes token contributions across both swap directions', () => {
		const cases = [
			{ disputeNewAmount2Input: '80', disputeTokenToSwap: 'token1' as const, expectedToken1Contribution: 315n, expectedToken2Contribution: 30n },
			{ disputeNewAmount2Input: '120', disputeTokenToSwap: 'token2' as const, expectedToken1Contribution: 100n, expectedToken2Contribution: 177n },
		]

		for (const testCase of cases) {
			const preview = createDisputeSubmissionPreview({
				disputeNewAmount2Input: testCase.disputeNewAmount2Input,
			})

			expect(preview.expectedNewAmount1).toBe(200n)
			expect(preview.swapTokenKey).toBe(testCase.disputeTokenToSwap)
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
				token1Balance: testCase.token1Balance,
				token2Balance: testCase.token2Balance,
			})
			const thirdPartyPreview = createDisputeSubmissionPreview({
				accountAddress: getAddress(addressString(TEST_ADDRESSES[2])),
				approvedToken1Amount: testCase.token1Balance,
				approvedToken2Amount: testCase.token2Balance,
				disputeNewAmount2Input: testCase.disputeNewAmount2Input,
				token1Balance: testCase.token1Balance,
				token2Balance: testCase.token2Balance,
			})

			expect(selfDisputePreview.token1ContributionAmount).toBe(testCase.expectedToken1Contribution)
			expect(selfDisputePreview.token2ContributionAmount).toBe(testCase.expectedToken2Contribution)
			expect(selfDisputePreview.canSubmit).toBe(true)
			expect(thirdPartyPreview.canSubmit).toBe(false)
		}
	})

	test('dispute submission helper skips fees before the escalation halt when fees apply only at halt', () => {
		const baseReport = createDisputeSubmissionPreviewReport()
		const beforeHaltToken1 = createDisputeSubmissionPreview({ reportDetails: { ...baseReport, feesOnlyAtHalt: true } })
		expect(beforeHaltToken1.token1ContributionAmount).toBe(300n)
		expect(beforeHaltToken1.canSubmit).toBe(true)
		const beforeHaltToken2 = createDisputeSubmissionPreview({ disputeNewAmount2Input: '120', reportDetails: { ...baseReport, feesOnlyAtHalt: true } })
		expect(beforeHaltToken2.token2ContributionAmount).toBe(170n)
		// A lower proposed price keeps the base token as the swapped token, so the halt fees are charged in it.
		const atHalt = createDisputeSubmissionPreview({ disputeNewAmount2Input: '40', reportDetails: { ...baseReport, escalationHalt: 100n, feesOnlyAtHalt: true } })
		expect(atHalt.expectedNewAmount1).toBe(101n)
		expect(atHalt.token1ContributionAmount).toBe(216n)
	})

	test('dispute submission helper accepts any base amount up to the halt with flexible escalation', () => {
		const flexibleReport = { ...createDisputeSubmissionPreviewReport(), escalationHalt: 300n, flexibleEscalation: true, multiplier: 200n }
		const flexible = createDisputeSubmissionPreview({ disputeNewAmount1Input: '250', reportDetails: flexibleReport })
		expect(flexible.expectedNewAmount1).toBe(200n)
		expect(flexible.canSubmit).toBe(true)
		expect(flexible.token1ContributionAmount).toBe(365n)
		expect(createDisputeSubmissionPreview({ disputeNewAmount1Input: '301', reportDetails: flexibleReport }).inputBlockMessage?.message).toBe('New REP amount must be between 200 and 300 for this dispute.')
		expect(createDisputeSubmissionPreview({ disputeNewAmount1Input: '199', reportDetails: flexibleReport }).inputBlockMessage?.message).toBe('New REP amount must be between 200 and 300 for this dispute.')
		// Without flexible escalation the report fixes the base amount, so a typed amount is ignored rather than rejected.
		const fixed = createDisputeSubmissionPreview({ disputeNewAmount1Input: '250', reportDetails: { ...flexibleReport, flexibleEscalation: false } })
		expect(fixed.inputBlockMessage).toBeUndefined()
		expect(fixed.maximumNewAmount1).toBeUndefined()
		expect(fixed.newAmount1).toBe(200n)
	})

	test('dispute submission blockers name the report tokens', () => {
		const flexibleReport = { ...createDisputeSubmissionPreviewReport(), escalationHalt: 300n, flexibleEscalation: true, multiplier: 200n }
		expect(createDisputeSubmissionPreview({ disputeNewAmount1Input: '', reportDetails: flexibleReport }).blockMessage?.message).toBe('Enter a valid new REP amount.')
	})

	test('dispute submission derives the swapped token from the proposed price', () => {
		const lowerPrice = createDisputeSubmissionPreview()
		expect(lowerPrice.swapTokenKey).toBe('token1')
		expect(lowerPrice.canSubmit).toBe(true)
		const higherPrice = createDisputeSubmissionPreview({ disputeNewAmount2Input: '120' })
		expect(higherPrice.swapTokenKey).toBe('token2')
		expect(createDisputeSubmissionPreview({ disputeNewAmount2Input: '' }).swapTokenKey).toBeUndefined()
	})

	test('create guard checks the wallet for exactly the settler reward', () => {
		const guardInput = { isOnActiveAppChain: true, walletBalanceAttoEth: 10n ** 18n, walletConnected: true }
		expect(getOpenOracleCreateGuardMessage({ ...guardInput, settlerRewardInput: '0.1' })).toBeUndefined()
		expect(getOpenOracleCreateGuardMessage({ ...guardInput, settlerRewardInput: '1.5' })).toBe('Need 0.5\u00a0more\u00a0ETH in this wallet to create the selected standalone OpenOracle report.')
		expect(getOpenOracleCreateGuardMessage({ ...guardInput, settlerRewardInput: 'abc' })).toBe('Enter a valid settler reward.')
	})

	test('open oracle fee and multiplier formatters render human values', () => {
		expect(formatOpenOracleFeePercentage(10_000n)).toBe('0.1%')
		expect(formatOpenOracleFeePercentage(BigInt(Number.MAX_SAFE_INTEGER) * 100_000n + 12_345n)).toBe('9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991.12345%')
		expect(formatOpenOracleMultiplier(140n)).toBe('1.4×')
		expect(formatOpenOracleMultiplier(BigInt(Number.MAX_SAFE_INTEGER) * 100n + 1n)).toBe('9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0991.01×')
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
				feePercentage: '0.001',
				multiplier: '1',
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
			feePercentage: '1',
			multiplier: '1',
			protocolFee: '1',
			settlementTime: '60',
			settlerRewardEthAmount: '1',
			token1Address,
			token2Address: WETH_ADDRESS,
		}

		expect(getOpenOracleCreateValidation({ form: { ...baseForm, token2Address: token1Address } }).message).toBe('Base and quote tokens must use different addresses.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, settlementTime: '9' } }).message).toBe('Settlement delay must be greater than dispute delay.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, feePercentage: '60', protocolFee: '50.00001' } }).message).toBe('Dispute fee plus protocol fee must not exceed 100%.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '0.99' } }).message).toBe('Multiplier must be at least 1×.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '2' } }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '1.5' } }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '1.505' } }).message).toBe('Enter a valid multiplier, such as 1.5.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: '1 000 000 000' } }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: '1000000000' }, token1Decimals: 18 }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount } }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: highPrecisionToken1Amount, escalationHalt: highPrecisionToken1Amount }, token1Decimals: 36 }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: '.' } }).message).toBe('Enter a valid base token amount.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: '-.' } }).message).toBe('Enter a valid base token amount.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, escalationHalt: '.' } }).message).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, escalationHalt: '-.' } }).message).toBe('Enter a valid escalation halt.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '655.35' } }).message).toBeUndefined()
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, multiplier: '655.36' } }).message).toBe('Multiplier must be at most 655.35×.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, disputeDelay: (1n << 24n).toString() } }).message).toBe('Dispute delay exceeds the contract maximum.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, settlementTime: (1n << 48n).toString() } }).message).toBe('Settlement delay exceeds the contract maximum.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, exactToken1Report: (1n << 128n).toString() }, token1Decimals: 18 }).message).toBe('Base token amount exceeds the contract maximum.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, escalationHalt: (1n << 128n).toString() }, token1Decimals: 18 }).message).toBe('Escalation halt exceeds the contract maximum.')
		expect(getOpenOracleCreateValidation({ form: { ...baseForm, settlerRewardEthAmount: (1n << 96n).toString() } }).message).toBe('Settler reward exceeds the contract maximum.')
	})

	test('open oracle create parser accepts high-decimal token1 amounts once token decimals are known', () => {
		const parsed = parseOpenOracleCreateFormSubmission({
			form: {
				...getDefaultOpenOracleCreateFormState(),
				disputeDelay: '10',
				escalationHalt: '0.000000000000000000000000000000000001',
				exactToken1Report: '0.000000000000000000000000000000000001',
				initialToken2Amount: '1',
				feePercentage: '1',
				multiplier: '1',
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

	test('open oracle create parser validates fee percentages as user-facing decimals', () => {
		const validForm = {
			...getDefaultOpenOracleCreateFormState(),
			disputeDelay: '10',
			exactToken1Report: '1',
			initialToken2Amount: '1',
			feePercentage: '1',
			multiplier: '1',
			protocolFee: '0.001',
			settlementTime: '60',
			settlerRewardEthAmount: '1',
			token1Address: addressString(GENESIS_REPUTATION_TOKEN),
			token2Address: WETH_ADDRESS,
		}
		const parse = (protocolFee: string) => parseOpenOracleCreateFormSubmission({ form: { ...validForm, protocolFee }, token1Decimals: 18, token2Decimals: 18 })
		expect(parse('0.001').protocolFee).toBe(100)
		expect(parse('1').protocolFee).toBe(100_000)
		expect(() => parse('')).toThrow('Enter a valid protocol fee.')
		expect(() => parse('-0.1')).toThrow('Protocol fee must be non-negative')
		expect(() => parse('0.000001')).toThrow('Enter a valid protocol fee.')
	})

	test('open oracle create parser throws invariant validation messages before preparing a write', () => {
		expect(() =>
			parseOpenOracleCreateFormSubmission({
				form: {
					...getDefaultOpenOracleCreateFormState(),
					disputeDelay: '10',
					exactToken1Report: '1',
					initialToken2Amount: '1',
					feePercentage: '60',
					multiplier: '1',
					protocolFee: '50.00001',
					settlementTime: '60',
					settlerRewardEthAmount: '1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
				token2Decimals: 18,
			}),
		).toThrow('Dispute fee plus protocol fee must not exceed 100%.')
		expect(() =>
			parseOpenOracleCreateFormSubmission({
				form: {
					...getDefaultOpenOracleCreateFormState(),
					disputeDelay: '10',
					exactToken1Report: '1',
					initialToken2Amount: '1',
					feePercentage: '1',
					multiplier: '655.36',
					protocolFee: '1',
					settlementTime: '60',
					settlerRewardEthAmount: '1',
					token1Address: addressString(GENESIS_REPUTATION_TOKEN),
					token2Address: WETH_ADDRESS,
				},
				token1Decimals: 18,
				token2Decimals: 18,
			}),
		).toThrow('Multiplier must be at most 655.35×.')
	})

	test('selected report action mode follows the report lifecycle', () => {
		expect(() => getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentReporter: zeroAddress, reportTimestamp: 0n }))).toThrow('OpenOracle report is missing its initial report.')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 110n }))).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 110n, disputeOccurred: true }))).toBe('dispute')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 161n }))).toBe('settle')
		expect(getOpenOracleSelectedReportActionMode(createOpenOracleLifecycleReport({ currentTime: 161n, isDistributed: true }))).toBe('read-only')
	})

	test('reserves submission time or blocks without opening settlement early', () => {
		for (const timeType of [true, false]) {
			const reserve = timeType ? 60n : 2n
			for (const remaining of [0n, 1n, reserve, reserve + 1n]) {
				const report = createOpenOracleLifecycleReport({
					timeType,
					reportTimestamp: 100n,
					settlementTime: 1_200n,
					currentTime: timeType ? 1_300n - remaining : 0n,
					currentBlockNumber: timeType ? 0n : 1_300n - remaining,
				})
				expect(getOpenOracleDisputeAvailability(report).canAct).toBe(remaining > reserve)
				expect(getOpenOracleSettleAvailability(report).canAct).toBe(remaining === 0n)
			}
		}
	})

	test('dispute and settle availability follow time-based report lifecycle', () => {
		const beforeDisputeDelay = createOpenOracleLifecycleReport({ currentTime: 109n })
		expect(getOpenOracleDisputeAvailability(beforeDisputeDelay)).toEqual({
			canAct: false,
			message: 'This report is not ready to dispute.',
		})
		expect(getOpenOracleSettleAvailability(beforeDisputeDelay)).toEqual({
			canAct: false,
			message: 'This report can be settled in 51s if no disputes occur.',
		})

		const insideDisputeWindow = createOpenOracleLifecycleReport({ currentTime: 159n, settlementTime: 120n })
		expect(getOpenOracleDisputeAvailability(insideDisputeWindow)).toEqual({
			canAct: true,
			message: undefined,
		})
		expect(getOpenOracleSettleAvailability(insideDisputeWindow)).toEqual({
			canAct: false,
			message: 'This report can be settled in 1m 1s if no disputes occur.',
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
			{ currentBlockNumber: 157n, disputeCanAct: true, settleCanAct: false },
			{ currentBlockNumber: 158n, disputeCanAct: false, settleCanAct: false },
			{ currentBlockNumber: 159n, disputeCanAct: false, settleCanAct: false },
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
			message: 'This report is invalid because its initial report is missing.',
		})
		expect(getOpenOracleSettleAvailability(noInitialReport)).toEqual({
			canAct: false,
			message: 'This report is invalid because its initial report is missing.',
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
		const gasFailure = 'Transaction failed after using its full gas limit. Open the transaction details before retrying.'
		expect(formatOpenOracleSettleWriteErrorMessage(new Error(gasFailure))).toBe(gasFailure)
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error(gasFailure))).toBe(gasFailure)
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: 0x98bdb2e0'))).toBe('Settlement did not leave enough gas for this report’s settlement callback. Retry settling and keep the gas limit the wallet suggests; do not lower it.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: SettleTooEarly()'))).toBe('This report is not ready to settle.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: 0x3edf6050'))).toBe('This report is not ready to settle.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: settlement callback failed'))).toBe('Transaction failed while settling the report. Reason: settlement callback failed.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: AlreadySettled()'))).toBe('This report is already settled.')
		expect(formatOpenOracleSettleWriteErrorMessage(new Error('execution reverted: NoReportYet()'))).toBe('This report is invalid because its initial report is missing.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute too early'))).toBe('This report is not ready to dispute.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: dispute period expired'))).toBe('Dispute window closed. Settle report instead.')
		expect(formatOpenOracleDisputeWriteErrorMessage(new Error('execution reverted: report settled'))).toBe('This report is already settled.')
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

describe('OpenOracle dispute WETH wrap step', () => {
	const wethAddress = getAddress(WETH_ADDRESS)

	test('applies only when a report token is WETH and is sized to the WETH the wallet lacks', () => {
		const required = createDisputeSubmissionPreview().token2ContributionAmount
		if (required === undefined || required === 0n) throw new Error('Expected the dispute to pay WETH')
		expect(createDisputeSubmissionPreview().wethWrap).toBeUndefined()
		expect(createDisputeSubmissionPreview({ walletEthBalanceAttoEth: 0n, wethAddress }).wethWrap).toEqual({ amountAttoEth: 0n, blockMessage: { kind: 'visible', message: 'Not needed. Your WETH covers this dispute.' } })

		const short = createDisputeSubmissionPreview({ token2Balance: 0n, walletEthBalanceAttoEth: required, wethAddress })
		expect(short.wethWrap).toEqual({ amountAttoEth: required, blockMessage: undefined })
		expect(short.blockMessage?.message).toBe(`Wrap ${formatCeilingAmountDisplay(required)} ETH to WETH first.`)

		const ethShort = createDisputeSubmissionPreview({ token2Balance: 0n, walletEthBalanceAttoEth: required - 1n, wethAddress })
		expect(ethShort.wethWrap?.blockMessage?.message).toStartWith('Insufficient ETH to wrap.')
		expect(ethShort.blockMessage?.message).toStartWith('Insufficient WETH balance for this dispute.')
	})

	test('stays disabled with a reason until the amounts and balances are known', () => {
		expect(createDisputeSubmissionPreview({ disputeNewAmount2Input: '', walletEthBalanceAttoEth: 0n, wethAddress }).wethWrap?.blockMessage).toEqual({ kind: 'visible', message: 'Enter valid dispute amounts before wrapping ETH.' })
		expect(createDisputeSubmissionPreview({ token2Balance: undefined, walletEthBalanceAttoEth: 0n, wethAddress }).wethWrap?.blockMessage).toEqual({ kind: 'hidden-loading', message: 'Loading current WETH balance…' })
		expect(createDisputeSubmissionPreview({ token2Balance: 0n, walletEthBalanceAttoEth: undefined, wethAddress }).wethWrap?.blockMessage).toEqual({ kind: 'hidden-loading', message: 'Loading ETH balance…' })
	})
})
