import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, getAddress, keccak256, type Address, type Hex, zeroAddress } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { ensureInfraDeployed, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { getOpenOracleExtraData, getOpenOracleReportMeta, getOpenOracleReportStatus, openOracleSettle, wrapWeth } from '../testSupport/simulator/utils/contracts/peripherals'
import { approveToken, getERC20Balance, getETHBalance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ensureDefined } from '../testSupport/simulator/utils/testUtils'
import {
	peripherals_openOracle_OpenOracle_OpenOracle,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleReentrantCallback,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver,
	test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken,
} from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const EXACT_TOKEN1_REPORT = 1_000n
const FEE_PERCENTAGE = 100_000
const PROTOCOL_FEE = 50_000
const MULTIPLIER = 120
const ESCALATION_HALT = 1_500n
const DISPUTE_DELAY = 10n
const SETTLEMENT_TIME = 100n
const MAX_UINT256 = (1n << 256n) - 1n

type ReportParameters = {
	token1: Address
	token2: Address
	exactToken1Report?: bigint
	feePercentage?: number
	protocolFee?: number
	multiplier?: number
	escalationHalt?: bigint
	disputeDelay?: number
	settlementTime?: number
	trackDisputes?: boolean
	callbackContract?: Address
	callbackGasLimit?: number
	protocolFeeRecipient?: Address
	reporterReward?: bigint
	settlerReward?: bigint
}

type DisputeRecord = {
	amount1: bigint
	amount2: bigint
	tokenToSwap: Address
	reportTimestamp: bigint
}

describe('OpenOracle dispute economics', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let creator: WriteClient
	let initialReporter: WriteClient
	let firstDisputer: WriteClient
	let secondDisputer: WriteClient
	let settler: WriteClient
	let openOracle: Address

	const clientFor = (index: number) => createWriteClient(mockWindow, ensureDefined(TEST_ADDRESSES[index], `missing test account ${index.toString()}`), 0)

	const deployContract = async (client: WriteClient, deploymentData: Hex): Promise<Address> => {
		const hash = await client.sendTransaction({ data: deploymentData })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (typeof receipt.contractAddress !== 'string') throw new Error('deployment address missing')
		return receipt.contractAddress
	}

	const createReport = async (client: WriteClient, parameters: ReportParameters) => {
		const reportId = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		const reporterReward = parameters.reporterReward ?? 0n
		const settlerReward = parameters.settlerReward ?? 0n
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'createReportInstance',
				args: [
					{
						callbackContract: parameters.callbackContract ?? zeroAddress,
						callbackGasLimit: parameters.callbackGasLimit ?? 0,
						disputeDelay: parameters.disputeDelay ?? Number(DISPUTE_DELAY),
						escalationHalt: parameters.escalationHalt ?? ESCALATION_HALT,
						exactToken1Report: parameters.exactToken1Report ?? EXACT_TOKEN1_REPORT,
						feePercentage: parameters.feePercentage ?? FEE_PERCENTAGE,
						multiplier: parameters.multiplier ?? MULTIPLIER,
						protocolFee: parameters.protocolFee ?? PROTOCOL_FEE,
						protocolFeeRecipient: parameters.protocolFeeRecipient ?? client.account.address,
						settlementTime: parameters.settlementTime ?? Number(SETTLEMENT_TIME),
						settlerReward,
						timeType: true,
						token1Address: parameters.token1,
						token2Address: parameters.token2,
						trackDisputes: parameters.trackDisputes ?? true,
					},
				],
				value: reporterReward + settlerReward,
			}),
		)
		return reportId
	}

	const submitInitialReport = async (client: WriteClient, reportId: bigint, amount1: bigint, amount2: bigint, reporter = client.account.address) => {
		const { stateHash } = await getOpenOracleExtraData(client, reportId)
		return await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'submitInitialReport',
				args: [reportId, amount1, amount2, stateHash, reporter],
			}),
		)
	}

	const dispute = async (client: WriteClient, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, amount2Expected: bigint, stateHash: Hex, recipient = client.account.address) =>
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'disputeAndSwap',
				args: [reportId, tokenToSwap, newAmount1, newAmount2, recipient, amount2Expected, stateHash],
			}),
		)

	const getProtocolFee = async (recipient: Address, token: Address) =>
		await creator.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'protocolFees',
			args: [recipient, token],
		})

	const getAccruedETH = async (recipient: Address) =>
		await creator.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'accruedProtocolFees',
			args: [recipient],
		})

	const getDisputeRecord = async (reportId: bigint, index: bigint): Promise<DisputeRecord> => {
		const result = await creator.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'disputeHistory',
			args: [reportId, index],
		})
		const [amount1, amount2, tokenToSwap, reportTimestamp] = result
		return { amount1, amount2, tokenToSwap, reportTimestamp }
	}

	const getTokenBalance = async (token: Address, owner: Address) => await getERC20Balance(creator, token, owner)
	const assertCustomError = async (execute: () => Promise<unknown>, errorName: string) => {
		let rejection: unknown
		try {
			await execute()
		} catch (error) {
			rejection = error
		}
		if (!(rejection instanceof Error)) throw new Error(`Expected ${errorName} custom error`)
		const selector = keccak256(`${errorName}()`).slice(0, 10).toLowerCase()
		const errorMessage = rejection.message.toLowerCase()
		assert.ok(errorMessage.includes(errorName.toLowerCase()) || errorMessage.includes(selector), `Expected ${errorName} (${selector}), received: ${rejection.message}`)
	}

	const getTokenTotal = async (token: Address, owners: readonly Address[]) => {
		const balances = await Promise.all(owners.map(owner => getTokenBalance(token, owner)))
		return balances.reduce((sum, balance) => sum + balance, 0n)
	}

	const approveAndFundStandardTokens = async (clients: readonly WriteClient[], wethAmount: bigint) => {
		for (const client of clients) {
			await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
			await approveToken(client, WETH_ADDRESS, openOracle)
			await wrapWeth(client, wethAmount)
		}
	}

	const approveTestToken = async (client: WriteClient, token: Address) =>
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token,
				functionName: 'approve',
				args: [openOracle, MAX_UINT256],
			}),
		)

	const mintTestToken = async (token: Address, recipient: Address, amount: bigint) =>
		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token,
				functionName: 'mint',
				args: [recipient, amount],
			}),
		)

	const approveNoReturnToken = async (client: WriteClient, token: Address) =>
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.abi,
				address: token,
				functionName: 'approve',
				args: [openOracle, MAX_UINT256],
			}),
		)

	const mintNoReturnToken = async (token: Address, recipient: Address, amount: bigint) =>
		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.abi,
				address: token,
				functionName: 'mint',
				args: [recipient, amount],
			}),
		)

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		creator = clientFor(0)
		await setupTestAccounts(mockWindow)
		await ensureInfraDeployed(creator)
		openOracle = getInfraContractAddresses().openOracle
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		creator = clientFor(0)
		initialReporter = clientFor(1)
		firstDisputer = clientFor(2)
		secondDisputer = clientFor(3)
		settler = clientFor(4)
		openOracle = getInfraContractAddresses().openOracle
	})

	test('repeated disputes in both swap directions conserve balances, accrue fees, track history, and reset settlement', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		const actors = [creator.account.address, initialReporter.account.address, firstDisputer.account.address, secondDisputer.account.address, settler.account.address, openOracle]
		await approveAndFundStandardTokens([initialReporter, firstDisputer, secondDisputer], 10_000n)
		const token1TotalBefore = await getTokenTotal(token1, actors)
		const token2TotalBefore = await getTokenTotal(token2, actors)
		const reportId = await createReport(creator, { token1, token2 })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)

		const initialStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 1_000n)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 1_000n)
		assert.strictEqual(initialStatus.currentReporter, initialReporter.account.address)
		assert.strictEqual((await getOpenOracleExtraData(creator, reportId)).numReports, 1)

		const firstFee = 10n
		const firstProtocolFee = 5n
		const firstReporterToken1Before = await getTokenBalance(token1, initialReporter.account.address)
		const firstDisputerToken1Before = await getTokenBalance(token1, firstDisputer.account.address)
		const firstDisputerToken2Before = await getTokenBalance(token2, firstDisputer.account.address)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		await mockWindow.setTime(initialStatus.reportTimestamp + DISPUTE_DELAY - 1n)
		const firstDisputeHash = await dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash)
		const firstDisputeReceipt = await firstDisputer.waitForTransactionReceipt({ hash: firstDisputeHash })
		const firstDisputeLog = firstDisputeReceipt.logs
			.map(log => {
				try {
					return decodeEventLog({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, data: log.data, topics: log.topics })
				} catch (error) {
					assert.ok(error instanceof Error, 'log decode failures should be errors')
					return undefined
				}
			})
			.find(log => log?.eventName === 'ReportDisputed')
		if (firstDisputeLog?.eventName !== 'ReportDisputed') throw new Error('missing first ReportDisputed event')

		const firstStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(firstDisputeLog.args.reportId, reportId)
		assert.strictEqual(firstDisputeLog.args.disputer, firstDisputer.account.address)
		assert.strictEqual(firstDisputeLog.args.tokenToSwap, token1)
		assert.strictEqual(firstStatus.reportTimestamp, initialStatus.reportTimestamp + DISPUTE_DELAY)
		assert.strictEqual(firstStatus.currentReporter, firstDisputer.account.address)
		assert.strictEqual((await getTokenBalance(token1, initialReporter.account.address)) - firstReporterToken1Before, 2_000n + firstFee)
		assert.strictEqual(firstDisputerToken1Before - (await getTokenBalance(token1, firstDisputer.account.address)), 1_200n + 1_000n + firstFee + firstProtocolFee)
		assert.strictEqual((await getTokenBalance(token2, firstDisputer.account.address)) - firstDisputerToken2Before, 200n)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 1_200n + firstProtocolFee)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 800n)
		assert.strictEqual(await getProtocolFee(creator.account.address, token1), firstProtocolFee)

		const secondFee = 8n
		const secondProtocolFee = 4n
		const firstDisputerToken2BeforeSecondDispute = await getTokenBalance(token2, firstDisputer.account.address)
		const secondDisputerToken1Before = await getTokenBalance(token1, secondDisputer.account.address)
		const secondDisputerToken2Before = await getTokenBalance(token2, secondDisputer.account.address)
		await mockWindow.setTime(firstStatus.reportTimestamp + DISPUTE_DELAY - 1n)
		await dispute(secondDisputer, reportId, token2, 1_440n, 1_600n, 800n, stateHash)

		const secondStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(secondStatus.reportTimestamp, firstStatus.reportTimestamp + DISPUTE_DELAY)
		assert.strictEqual(secondStatus.currentReporter, secondDisputer.account.address)
		assert.strictEqual((await getTokenBalance(token2, firstDisputer.account.address)) - firstDisputerToken2BeforeSecondDispute, 1_600n + secondFee)
		assert.strictEqual(secondDisputerToken1Before - (await getTokenBalance(token1, secondDisputer.account.address)), 240n)
		assert.strictEqual(secondDisputerToken2Before - (await getTokenBalance(token2, secondDisputer.account.address)), 1_600n + 800n + secondFee + secondProtocolFee)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 1_440n + firstProtocolFee)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 1_600n + secondProtocolFee)
		assert.strictEqual(await getProtocolFee(creator.account.address, token2), secondProtocolFee)

		const extraData = await getOpenOracleExtraData(creator, reportId)
		assert.strictEqual(extraData.numReports, 3)
		assert.deepStrictEqual(await getDisputeRecord(reportId, 0n), {
			amount1: 1_000n,
			amount2: 1_000n,
			tokenToSwap: zeroAddress,
			reportTimestamp: initialStatus.reportTimestamp,
		})
		assert.deepStrictEqual(await getDisputeRecord(reportId, 1n), {
			amount1: 1_200n,
			amount2: 800n,
			tokenToSwap: token1,
			reportTimestamp: firstStatus.reportTimestamp,
		})
		assert.deepStrictEqual(await getDisputeRecord(reportId, 2n), {
			amount1: 1_440n,
			amount2: 1_600n,
			tokenToSwap: token2,
			reportTimestamp: secondStatus.reportTimestamp,
		})

		await mockWindow.setTime(secondStatus.reportTimestamp + SETTLEMENT_TIME - 2n)
		await assertCustomError(() => openOracleSettle(settler, reportId), 'SettleTooEarly')
		const currentReporterToken1BeforeSettlement = await getTokenBalance(token1, secondDisputer.account.address)
		const currentReporterToken2BeforeSettlement = await getTokenBalance(token2, secondDisputer.account.address)
		await openOracleSettle(settler, reportId)
		const settledStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(settledStatus.settlementTimestamp, secondStatus.reportTimestamp + SETTLEMENT_TIME)
		assert.strictEqual((await getTokenBalance(token1, secondDisputer.account.address)) - currentReporterToken1BeforeSettlement, 1_440n)
		assert.strictEqual((await getTokenBalance(token2, secondDisputer.account.address)) - currentReporterToken2BeforeSettlement, 1_600n)
		assert.strictEqual(await getTokenBalance(token1, openOracle), firstProtocolFee)
		assert.strictEqual(await getTokenBalance(token2, openOracle), secondProtocolFee)
		const settledSnapshot = {
			oracleToken1: await getTokenBalance(token1, openOracle),
			oracleToken2: await getTokenBalance(token2, openOracle),
			reporterToken1: await getTokenBalance(token1, secondDisputer.account.address),
			reporterToken2: await getTokenBalance(token2, secondDisputer.account.address),
			status: await getOpenOracleReportStatus(creator, reportId),
		}
		await assertCustomError(() => openOracleSettle(settler, reportId), 'AlreadySettled')
		assert.deepStrictEqual(
			{
				oracleToken1: await getTokenBalance(token1, openOracle),
				oracleToken2: await getTokenBalance(token2, openOracle),
				reporterToken1: await getTokenBalance(token1, secondDisputer.account.address),
				reporterToken2: await getTokenBalance(token2, secondDisputer.account.address),
				status: await getOpenOracleReportStatus(creator, reportId),
			},
			settledSnapshot,
		)

		const feeRecipientToken1Before = await getTokenBalance(token1, creator.account.address)
		const feeRecipientToken2Before = await getTokenBalance(token2, creator.account.address)
		for (const token of [token1, token2]) {
			await writeContractAndWait(creator, () =>
				creator.writeContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'getProtocolFees',
					args: [token],
				}),
			)
		}
		assert.strictEqual((await getTokenBalance(token1, creator.account.address)) - feeRecipientToken1Before, firstProtocolFee)
		assert.strictEqual((await getTokenBalance(token2, creator.account.address)) - feeRecipientToken2Before, secondProtocolFee)
		assert.strictEqual(await getProtocolFee(creator.account.address, token1), 0n)
		assert.strictEqual(await getProtocolFee(creator.account.address, token2), 0n)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 0n)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 0n)
		assert.strictEqual(await getTokenTotal(token1, actors), token1TotalBefore)
		assert.strictEqual(await getTokenTotal(token2, actors), token2TotalBefore)
	})

	test('invalid and stale disputes revert with the complete report accounting unchanged', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		await approveAndFundStandardTokens([initialReporter, firstDisputer], 10_000n)
		const reportId = await createReport(creator, { token1, token2 })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)
		const initialStatus = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		const invalidStateHash = `0x${'01'.padStart(64, '0')}` as Hex

		const readAccountingSnapshot = async () => ({
			extraData: await getOpenOracleExtraData(creator, reportId),
			firstHistory: await getDisputeRecord(reportId, 1n),
			oracleToken1: await getTokenBalance(token1, openOracle),
			oracleToken2: await getTokenBalance(token2, openOracle),
			protocolToken1: await getProtocolFee(creator.account.address, token1),
			protocolToken2: await getProtocolFee(creator.account.address, token2),
			reporterToken1: await getTokenBalance(token1, initialReporter.account.address),
			reporterToken2: await getTokenBalance(token2, initialReporter.account.address),
			status: await getOpenOracleReportStatus(creator, reportId),
		})
		const assertRevertUnchanged = async (execute: () => Promise<unknown>, expectedErrorName: string) => {
			const before = await readAccountingSnapshot()
			await assertCustomError(execute, expectedErrorName)
			assert.deepStrictEqual(await readAccountingSnapshot(), before)
		}

		await mockWindow.setTime(initialStatus.reportTimestamp + DISPUTE_DELAY - 2n)
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash), 'DisputeTooEarly')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, invalidStateHash), 'InvalidStateHash')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 800n, 999n, stateHash), 'InvalidAmount2Expected')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, settler.account.address, 1_200n, 800n, 1_000n, stateHash), 'InvalidTokenToSwap')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 1_200n, 1_000n, stateHash), 'NewPriceInsideFeeBoundary')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_199n, 800n, 1_000n, stateHash), 'InvalidAmount1')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 0n, 1_000n, stateHash), 'AmountsCannotBeZero')
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash, zeroAddress), 'AddressCannotBeZero')

		await mockWindow.setTime(initialStatus.reportTimestamp + SETTLEMENT_TIME)
		await assertRevertUnchanged(() => dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash), 'DisputeTooLate')
	})

	test('pre-halt multiplier flooring keeps a one-unit token1 report unchanged', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		await approveAndFundStandardTokens([initialReporter, firstDisputer], 100n)
		const reportId = await createReport(creator, {
			token1,
			token2,
			exactToken1Report: 1n,
			multiplier: 115,
			escalationHalt: 100n,
		})
		await submitInitialReport(initialReporter, reportId, 1n, 10n)
		const initialStatus = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash

		await mockWindow.setTime(initialStatus.reportTimestamp + DISPUTE_DELAY - 1n)
		await dispute(firstDisputer, reportId, token1, 1n, 8n, 10n, stateHash)

		const disputedStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(disputedStatus.currentAmount1, 1n, 'floor(1 * 115 / 100) should keep the pre-halt token1 amount at one')
		assert.strictEqual(disputedStatus.currentAmount2, 8n, 'the dispute should still replace the token2 amount')
	})

	test('legacy no-return ERC20s fund, dispute in both directions, settle, and withdraw fees conservatively', async () => {
		const token1 = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.evm.bytecode.object}`,
				args: ['Legacy One', 'LONE'],
			}),
		)
		const token2 = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleNoReturnToken.evm.bytecode.object}`,
				args: ['Legacy Two', 'LTWO'],
			}),
		)
		for (const token of [token1, token2]) {
			for (const actor of [initialReporter, firstDisputer, secondDisputer]) {
				await mintNoReturnToken(token, actor.account.address, 10_000n)
				await approveNoReturnToken(actor, token)
			}
		}

		const owners = [creator.account.address, initialReporter.account.address, firstDisputer.account.address, secondDisputer.account.address, openOracle]
		const token1Total = await getTokenTotal(token1, owners)
		const token2Total = await getTokenTotal(token2, owners)
		const assertConserved = async (label: string) => {
			assert.strictEqual(await getTokenTotal(token1, owners), token1Total, `${label}: token1 should be conserved`)
			assert.strictEqual(await getTokenTotal(token2, owners), token2Total, `${label}: token2 should be conserved`)
		}

		const reportId = await createReport(creator, { token1, token2 })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)
		await assertConserved('initial no-return funding')

		const initialStatus = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		await mockWindow.setTime(initialStatus.reportTimestamp + DISPUTE_DELAY - 1n)
		await dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash)
		await assertConserved('token1 no-return dispute')

		const firstStatus = await getOpenOracleReportStatus(creator, reportId)
		await mockWindow.setTime(firstStatus.reportTimestamp + DISPUTE_DELAY - 1n)
		await dispute(secondDisputer, reportId, token2, 1_440n, 1_600n, 800n, stateHash)
		await assertConserved('token2 no-return dispute')
		assert.strictEqual(await getProtocolFee(creator.account.address, token1), 5n)
		assert.strictEqual(await getProtocolFee(creator.account.address, token2), 4n)
		assert.strictEqual((await getOpenOracleExtraData(creator, reportId)).numReports, 3)
		assert.strictEqual((await getOpenOracleReportStatus(creator, reportId)).currentReporter, secondDisputer.account.address)

		const secondStatus = await getOpenOracleReportStatus(creator, reportId)
		await mockWindow.setTime(secondStatus.reportTimestamp + SETTLEMENT_TIME - 1n)
		await openOracleSettle(settler, reportId)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 5n)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 4n)
		await assertConserved('no-return settlement payout')

		for (const token of [token1, token2]) {
			await writeContractAndWait(creator, () =>
				creator.writeContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'getProtocolFees',
					args: [token],
				}),
			)
		}
		assert.strictEqual(await getProtocolFee(creator.account.address, token1), 0n)
		assert.strictEqual(await getProtocolFee(creator.account.address, token2), 0n)
		assert.strictEqual(await getTokenBalance(token1, openOracle), 0n)
		assert.strictEqual(await getTokenBalance(token2, openOracle), 0n)
		await assertConserved('no-return fee withdrawal')
	})

	test('failed token payouts accrue a retryable claim and failed dispute pulls preserve state', async () => {
		const token1 = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.evm.bytecode.object}`,
				args: ['Token One', 'ONE'],
			}),
		)
		const token2 = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.evm.bytecode.object}`,
				args: ['Token Two', 'TWO'],
			}),
		)
		for (const token of [token1, token2]) {
			await mintTestToken(token, initialReporter.account.address, 10_000n)
			await mintTestToken(token, firstDisputer.account.address, 10_000n)
			await approveTestToken(initialReporter, token)
			await approveTestToken(firstDisputer, token)
		}
		const reportId = await createReport(creator, { token1, token2, feePercentage: 0, protocolFee: 0 })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)
		const status = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		await mockWindow.setTime(status.reportTimestamp + DISPUTE_DELAY - 1n)

		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token1,
				functionName: 'setTransferFailures',
				args: [false, true],
			}),
		)
		const statusBeforeFailedPull = await getOpenOracleReportStatus(creator, reportId)
		const oracleToken1BeforeFailedPull = await getTokenBalance(token1, openOracle)
		await assert.rejects(dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash), /0x5274afe7|token returned false|SafeERC20/i)
		assert.deepStrictEqual(await getOpenOracleReportStatus(creator, reportId), statusBeforeFailedPull)
		assert.strictEqual(await getTokenBalance(token1, openOracle), oracleToken1BeforeFailedPull)

		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token1,
				functionName: 'setTransferFailures',
				args: [false, false],
			}),
		)
		await dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash)
		const disputedStatus = await getOpenOracleReportStatus(creator, reportId)
		await mockWindow.setTime(disputedStatus.reportTimestamp + SETTLEMENT_TIME - 1n)
		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token1,
				functionName: 'setTransferFailures',
				args: [true, false],
			}),
		)
		const reporterToken1BeforeSettlement = await getTokenBalance(token1, firstDisputer.account.address)
		await openOracleSettle(settler, reportId)
		assert.strictEqual(await getProtocolFee(firstDisputer.account.address, token1), 1_200n)
		assert.strictEqual(await getTokenBalance(token1, firstDisputer.account.address), reporterToken1BeforeSettlement)

		await writeContractAndWait(firstDisputer, () =>
			firstDisputer.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'getProtocolFees',
				args: [token1],
			}),
		)
		assert.strictEqual(await getProtocolFee(firstDisputer.account.address, token1), 1_200n)
		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleTestToken.abi,
				address: token1,
				functionName: 'setTransferFailures',
				args: [false, false],
			}),
		)
		await writeContractAndWait(firstDisputer, () =>
			firstDisputer.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'getProtocolFees',
				args: [token1],
			}),
		)
		assert.strictEqual(await getProtocolFee(firstDisputer.account.address, token1), 0n)
		assert.strictEqual((await getTokenBalance(token1, firstDisputer.account.address)) - reporterToken1BeforeSettlement, 1_200n)
	})

	test('settlement contains callback reentrancy and preserves rejected ETH for retry', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		const rejectingReceiver = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver.evm.bytecode.object}`,
			}),
		)
		const callback = await deployContract(
			creator,
			encodeDeployData({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleReentrantCallback.abi,
				bytecode: `0x${test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleReentrantCallback.evm.bytecode.object}`,
				args: [openOracle],
			}),
		)
		await approveAndFundStandardTokens([initialReporter], 2_000n)
		const reporterReward = 1_000n
		const settlerReward = 500n
		const reportId = await createReport(creator, {
			callbackContract: callback,
			callbackGasLimit: 200_000,
			feePercentage: 0,
			protocolFee: 0,
			reporterReward,
			settlerReward,
			token1,
			token2,
		})
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n, rejectingReceiver)
		const status = await getOpenOracleReportStatus(creator, reportId)
		await mockWindow.setTime(status.reportTimestamp + SETTLEMENT_TIME - 1n)
		const settlerETHBefore = await getETHBalance(settler, settler.account.address)
		await openOracleSettle(settler, reportId)

		assert.strictEqual(
			await creator.readContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleReentrantCallback.abi,
				address: callback,
				functionName: 'attempted',
				args: [],
			}),
			true,
		)
		assert.strictEqual(
			await creator.readContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleReentrantCallback.abi,
				address: callback,
				functionName: 'reentrantCallSucceeded',
				args: [],
			}),
			false,
		)
		assert.strictEqual(await getAccruedETH(rejectingReceiver), reporterReward)
		assert.strictEqual((await getETHBalance(settler, settler.account.address)) - settlerETHBefore, settlerReward)

		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver.abi,
				address: rejectingReceiver,
				functionName: 'setRejectETH',
				args: [false],
			}),
		)
		const receiverETHBeforeClaim = await getETHBalance(creator, rejectingReceiver)
		await writeContractAndWait(creator, () =>
			creator.writeContract({
				abi: test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver.abi,
				address: rejectingReceiver,
				functionName: 'claim',
				args: [openOracle],
			}),
		)
		assert.strictEqual(await getAccruedETH(rejectingReceiver), 0n)
		assert.strictEqual((await getETHBalance(creator, rejectingReceiver)) - receiverETHBeforeClaim, reporterReward)
	})

	test('escalation halt requires exactly one additional token1 unit', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		await approveAndFundStandardTokens([initialReporter, firstDisputer], 10_000n)
		const reportId = await createReport(creator, { token1, token2, escalationHalt: EXACT_TOKEN1_REPORT })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)
		const status = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		await mockWindow.setTime(status.reportTimestamp + DISPUTE_DELAY - 1n)
		await assertCustomError(() => dispute(firstDisputer, reportId, token1, 1_002n, 800n, 1_000n, stateHash), 'EscalationHalted')
		await dispute(firstDisputer, reportId, token1, 1_001n, 800n, 1_000n, stateHash)
		const disputedStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(disputedStatus.currentAmount1, 1_001n)
		assert.strictEqual(disputedStatus.currentReporter, firstDisputer.account.address)
	})

	test('settlement-boundary disputes are accepted and reset the clock', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		const token2: Address = WETH_ADDRESS
		await approveAndFundStandardTokens([initialReporter, firstDisputer], 10_000n)
		const reportId = await createReport(creator, { token1, token2 })
		await submitInitialReport(initialReporter, reportId, 1_000n, 1_000n)
		const status = await getOpenOracleReportStatus(creator, reportId)
		const stateHash = (await getOpenOracleExtraData(creator, reportId)).stateHash
		await mockWindow.setTime(status.reportTimestamp + SETTLEMENT_TIME - 1n)
		await dispute(firstDisputer, reportId, token1, 1_200n, 800n, 1_000n, stateHash)
		const disputedStatus = await getOpenOracleReportStatus(creator, reportId)
		assert.strictEqual(disputedStatus.reportTimestamp, status.reportTimestamp + SETTLEMENT_TIME)
		await assertCustomError(() => openOracleSettle(settler, reportId), 'SettleTooEarly')
		assert.strictEqual((await getOpenOracleReportMeta(creator, reportId)).settlementTime, SETTLEMENT_TIME)
	})
})
