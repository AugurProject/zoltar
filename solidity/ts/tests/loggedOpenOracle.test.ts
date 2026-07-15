import { beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { decodeEventLog, encodeDeployData, type Address, type Hex } from '@zoltar/shared/ethereum'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle, ReputationToken_ReputationToken, test_peripherals_FalseReturningERC20_FalseReturningERC20, test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const TOKEN_AMOUNT = 1_000n
const REPORTER_REWARD = 3n
const SETTLER_REWARD = 2n
const MAX_TOKEN_AMOUNT = 1_000_000n
const PAYER_ADDRESS = addressString(TEST_ADDRESSES[0])
const DISPUTER_ADDRESS = addressString(TEST_ADDRESSES[1])

describe('LoggedOpenOracle', () => {
	const { getAnvilWindowEthereum } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let payer: WriteClient
	let disputer: WriteClient
	let oracle: Address
	let token1: Address
	let token2: Address

	async function deploy(data: Hex) {
		const hash = await payer.sendTransaction({ data })
		const receipt = await payer.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) {
			throw new Error('contract deployment address missing')
		}
		return receipt.contractAddress
	}

	async function deployReputationToken() {
		const token = await deploy(
			encodeDeployData({
				abi: ReputationToken_ReputationToken.abi,
				bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
				args: [PAYER_ADDRESS],
			}),
		)
		await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: token,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'setMaxTheoreticalSupply',
				args: [MAX_TOKEN_AMOUNT * 4n],
			}),
		)
		for (const account of [PAYER_ADDRESS, DISPUTER_ADDRESS]) {
			await writeContractAndWait(payer, () =>
				payer.writeContract({
					address: token,
					abi: ReputationToken_ReputationToken.abi,
					functionName: 'mint',
					args: [account, MAX_TOKEN_AMOUNT],
				}),
			)
		}
		return token
	}

	async function approve(client: WriteClient, token: Address) {
		await writeContractAndWait(client, () =>
			client.writeContract({
				address: token,
				abi: ReputationToken_ReputationToken.abi,
				functionName: 'approve',
				args: [oracle, MAX_TOKEN_AMOUNT],
			}),
		)
	}

	async function createAndSubmitReport(reporter: Address, protocolFee: number = 0, reporterReward: bigint = REPORTER_REWARD, settlerReward: bigint = SETTLER_REWARD) {
		const reportId = await payer.readContract({
			address: oracle,
			abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
			functionName: 'nextReportId',
			args: [],
		})
		await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'createReportInstance',
				args: [token1, token2, TOKEN_AMOUNT, 0, 200, 1, 100_000n, 0, protocolFee, settlerReward],
				value: reporterReward + settlerReward,
			}),
		)
		const extraData = await payer.readContract({
			address: oracle,
			abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
			functionName: 'extraData',
			args: [reportId],
		})
		const stateHash = extraData[0]
		const hash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'submitInitialReport',
				args: [reportId, TOKEN_AMOUNT, TOKEN_AMOUNT, stateHash, reporter],
			}),
		)
		return { hash, reportId }
	}

	async function oracleEvents(hash: Hex) {
		const receipt = await payer.waitForTransactionReceipt({ hash })
		return receipt.logs
			.filter(log => log.address.toLowerCase() === oracle.toLowerCase())
			.map(log =>
				decodeEventLog({
					abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
					data: log.data,
					topics: log.topics,
				}),
			)
	}

	beforeEach(async () => {
		mockWindow = getAnvilWindowEthereum()
		payer = createWriteClient(mockWindow, TEST_ADDRESSES[0], 0)
		disputer = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		await setupTestAccounts(mockWindow)
		oracle = await deploy(
			encodeDeployData({
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				bytecode: `0x${peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.evm.bytecode.object}`,
			}),
		)
		token1 = await deployReputationToken()
		token2 = await deployReputationToken()
		for (const client of [payer, disputer]) {
			await approve(client, token1)
			await approve(client, token2)
		}
	})

	test('logs distinct payer, reporter, token payouts, and ETH rewards', async () => {
		const reporter = addressString(TEST_ADDRESSES[2])
		const submitted = await createAndSubmitReport(reporter)
		const submissionEvents = await oracleEvents(submitted.hash)
		const initialReport = submissionEvents.find(event => event.eventName === 'InitialReportSubmitted')
		if (initialReport?.eventName !== 'InitialReportSubmitted') throw new Error('initial report event missing')
		assert.strictEqual(initialReport.args.reporter, reporter)
		assert.strictEqual(initialReport.args.payer, PAYER_ADDRESS)

		await mockWindow.advanceTime(2n)
		const settleHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'settle',
				args: [submitted.reportId],
			}),
		)
		const settlementEvents = await oracleEvents(settleHash)
		const tokenPayouts = settlementEvents.filter(event => event.eventName === 'TokenPayoutResult')
		const ethPayouts = settlementEvents.filter(event => event.eventName === 'EthPayoutResult')
		assert.strictEqual(tokenPayouts.length, 2)
		assert.strictEqual(ethPayouts.length, 2)
		for (const event of tokenPayouts) {
			if (event.eventName !== 'TokenPayoutResult') throw new Error('unexpected token payout event')
			assert.strictEqual(event.args.recipient, reporter)
			assert.strictEqual(event.args.paid, true)
		}
		for (const event of ethPayouts) {
			if (event.eventName !== 'EthPayoutResult') throw new Error('unexpected ETH payout event')
			assert.strictEqual(event.args.paid, true)
		}

		const reporterClient = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const noOpHash = await writeContractAndWait(reporterClient, () =>
			reporterClient.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'getProtocolFees',
				args: [token1],
			}),
		)
		assert.strictEqual((await oracleEvents(noOpHash)).length, 0)
	})

	test('logs deferred token and ETH liabilities and only checkpoints successful withdrawals', async () => {
		const receiver = await deploy(
			encodeDeployData({
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				bytecode: `0x${test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.evm.bytecode.object}`,
			}),
		)
		const submitted = await createAndSubmitReport(receiver)
		await mockWindow.request({
			method: 'anvil_setCode',
			params: [token1, `0x${test_peripherals_FalseReturningERC20_FalseReturningERC20.evm.deployedBytecode.object}`],
		})
		await mockWindow.advanceTime(2n)
		const settleHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'settle',
				args: [oracle, submitted.reportId],
			}),
		)
		const settlementEvents = await oracleEvents(settleHash)
		const failedTokenPayout = settlementEvents.find(event => event.eventName === 'TokenPayoutResult' && !event.args.paid)
		if (failedTokenPayout?.eventName !== 'TokenPayoutResult') throw new Error('failed token payout event missing')
		assert.strictEqual(failedTokenPayout.args.token, token1)
		assert.strictEqual(failedTokenPayout.args.amount, TOKEN_AMOUNT)
		assert.strictEqual(settlementEvents.filter(event => event.eventName === 'EthPayoutResult' && !event.args.paid).length, 2)
		assert.strictEqual(
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'protocolFees',
				args: [receiver, token1],
			}),
			TOKEN_AMOUNT,
		)
		assert.strictEqual(
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'accruedProtocolFees',
				args: [receiver],
			}),
			REPORTER_REWARD + SETTLER_REWARD,
		)

		const failedTokenWithdrawalHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'withdrawTokenFees',
				args: [oracle, token1],
			}),
		)
		const failedTokenWithdrawalEvents = await oracleEvents(failedTokenWithdrawalHash)
		const failedTokenWithdrawal = failedTokenWithdrawalEvents.find(event => event.eventName === 'TokenPayoutResult' && !event.args.paid)
		if (failedTokenWithdrawal?.eventName !== 'TokenPayoutResult') throw new Error('failed token withdrawal event missing')
		assert.strictEqual(failedTokenWithdrawal.args.reason, 4n)
		assert.strictEqual(failedTokenWithdrawal.args.amount, TOKEN_AMOUNT)
		assert.ok(!failedTokenWithdrawalEvents.some(event => event.eventName === 'TokenFeesWithdrawn'))
		assert.strictEqual(
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'protocolFees',
				args: [receiver, token1],
			}),
			TOKEN_AMOUNT,
		)

		await mockWindow.request({
			method: 'anvil_setCode',
			params: [token1, `0x${ReputationToken_ReputationToken.evm.deployedBytecode.object}`],
		})
		const tokenWithdrawalHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'withdrawTokenFees',
				args: [oracle, token1],
			}),
		)
		assert.ok((await oracleEvents(tokenWithdrawalHash)).some(event => event.eventName === 'TokenFeesWithdrawn'))
		const repeatedTokenWithdrawalHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'withdrawTokenFees',
				args: [oracle, token1],
			}),
		)
		assert.strictEqual((await oracleEvents(repeatedTokenWithdrawalHash)).length, 0)

		await assert.rejects(
			writeContractAndWait(payer, () =>
				payer.writeContract({
					address: receiver,
					abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
					functionName: 'withdrawEthFees',
					args: [oracle],
				}),
			),
		)
		assert.strictEqual(
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'accruedProtocolFees',
				args: [receiver],
			}),
			REPORTER_REWARD + SETTLER_REWARD,
		)
		await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'setRejectEth',
				args: [false],
			}),
		)
		const ethWithdrawalHash = await writeContractAndWait(payer, () =>
			payer.writeContract({
				address: receiver,
				abi: test_peripherals_OraclePayoutReceiver_OraclePayoutReceiver.abi,
				functionName: 'withdrawEthFees',
				args: [oracle],
			}),
		)
		assert.ok((await oracleEvents(ethWithdrawalHash)).some(event => event.eventName === 'EthFeesWithdrawn'))
	})

	test('logs protocol-fee accrual for both dispute directions and dispute payer separately', async () => {
		const beneficiary = addressString(TEST_ADDRESSES[2])
		const token1Report = await createAndSubmitReport(PAYER_ADDRESS, 100_000, 0n, 0n)
		const token1StateHash = (
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'extraData',
				args: [token1Report.reportId],
			})
		)[0]
		const token1DisputeHash = await writeContractAndWait(disputer, () =>
			disputer.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'disputeAndSwap',
				args: [token1Report.reportId, token1, 2_000n, 1_000n, beneficiary, TOKEN_AMOUNT, token1StateHash],
			}),
		)
		const token2Report = await createAndSubmitReport(PAYER_ADDRESS, 100_000, 0n, 0n)
		const token2StateHash = (
			await payer.readContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'extraData',
				args: [token2Report.reportId],
			})
		)[0]
		const token2DisputeHash = await writeContractAndWait(disputer, () =>
			disputer.writeContract({
				address: oracle,
				abi: peripherals_openOracle_LoggedOpenOracle_LoggedOpenOracle.abi,
				functionName: 'disputeAndSwap',
				args: [token2Report.reportId, token2, 2_000n, 3_000n, beneficiary, TOKEN_AMOUNT, token2StateHash],
			}),
		)
		for (const [hash, token, reason] of [
			[token1DisputeHash, token1, 0n],
			[token2DisputeHash, token2, 1n],
		] as const) {
			const events = await oracleEvents(hash)
			const dispute = events.find(event => event.eventName === 'ReportDisputed')
			if (dispute?.eventName !== 'ReportDisputed') throw new Error('dispute event missing')
			assert.strictEqual(dispute.args.disputer, beneficiary)
			assert.strictEqual(dispute.args.payer, DISPUTER_ADDRESS)
			const accrued = events.find(event => event.eventName === 'ProtocolFeeAccrued')
			if (accrued?.eventName !== 'ProtocolFeeAccrued') throw new Error('protocol fee event missing')
			assert.strictEqual(accrued.args.recipient, PAYER_ADDRESS)
			assert.strictEqual(accrued.args.token, token)
			assert.strictEqual(accrued.args.amount, 10n)
			assert.strictEqual(accrued.args.reason, reason)
		}
	})
})
