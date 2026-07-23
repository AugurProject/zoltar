import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { bytesToHex, encodeAbiParameters, encodeDeployData, encodeFunctionData, getAddress, hexToBytes, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_STORE_PRICE, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES } from '@zoltar/shared/openOracle'
import assert from '../testSupport/simulator/utils/assert'
import { AnvilWindowEthereum } from '../testSupport/simulator/AnvilWindowEthereum'
import { TEST_TIMEOUT_MS, useIsolatedAnvilNode } from '../testSupport/simulator/useIsolatedAnvilNode'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { ensureInfraDeployed, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployPeripherals'
import { getOpenOracleExtraData, getOpenOracleReportStatus, loadOpenOracleEventState, openOracleSettle, wrapWeth } from '../testSupport/simulator/utils/contracts/peripherals'
import { approveToken, getERC20Balance, setupTestAccounts } from '../testSupport/simulator/utils/utilities'
import { ensureDefined } from '../testSupport/simulator/utils/testUtils'
import { peripherals_openOracle_OpenOracle_OpenOracle, test_peripherals_FalseReturningERC20_FalseReturningERC20, test_peripherals_OpenOracleAdversarialHarnesses_OpenOracleRejectingETHReceiver as rejectingEthReceiverArtifact } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const AMOUNT1 = 1_000n
const AMOUNT2 = 1_000n
const DISPUTE_DELAY = 10n
const SETTLEMENT_TIME = 100n
const MULTIPLIER = 120n
const FEE_PERCENTAGE = 100_000n
const PROTOCOL_FEE = 50_000n
const FLAGS = OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_STORE_PRICE
const ZERO_ADDRESS = getAddress('0x0000000000000000000000000000000000000000')

describe('OpenOracle 0.2.0 report lifecycle', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let reporter: WriteClient
	let disputer: WriteClient
	let settler: WriteClient
	let openOracle: Address

	const clientFor = (index: number) => createWriteClient(mockWindow, ensureDefined(TEST_ADDRESSES[index], `missing test account ${index.toString()}`), 0)

	const assertCustomError = async (execute: () => Promise<unknown>, errorName: string, errorSignature = `${errorName}()`, encodedArguments?: Hex) => {
		let rejection: unknown
		try {
			await execute()
		} catch (error) {
			rejection = error
		}
		if (!(rejection instanceof Error)) throw new Error(`Expected ${errorName} custom error`)
		const selector = keccak256(errorSignature).slice(0, 10).toLowerCase()
		assert.ok(rejection.message.toLowerCase().includes(errorName.toLowerCase()) || rejection.message.toLowerCase().includes(selector), `Expected ${errorName} (${selector}), received: ${rejection.message}`)
		if (encodedArguments !== undefined) {
			const expectedArguments = encodedArguments.slice(2).toLowerCase()
			assert.ok(rejection.message.toLowerCase().includes(expectedArguments), `Expected ${errorName} arguments ${expectedArguments}, received: ${rejection.message}`)
		}
	}

	const prepareReporter = async (client: WriteClient, wethAmount = 10_000n) => {
		await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), openOracle)
		await approveToken(client, WETH_ADDRESS, openOracle)
		await wrapWeth(client, wethAmount)
	}

	const getReportParameters = (client: WriteClient) => ({
		callbackContract: getAddress('0x0000000000000000000000000000000000000000'),
		callbackGasLimit: 0,
		currentAmount1: AMOUNT1,
		currentAmount2: AMOUNT2,
		currentReporter: client.account.address,
		disputeDelay: Number(DISPUTE_DELAY),
		escalationHalt: 1_500n,
		feePercentage: Number(FEE_PERCENTAGE),
		flags: Number(FLAGS),
		lastReportOppoTime: 0,
		multiplier: Number(MULTIPLIER),
		numReports: 0,
		protocolFee: Number(PROTOCOL_FEE),
		protocolFeeRecipient: reporter.account.address,
		reportTimestamp: 0,
		settlementTime: Number(SETTLEMENT_TIME),
		settlementTimestamp: 0,
		settlerReward: 1_000n,
		token1: getAddress(addressString(GENESIS_REPUTATION_TOKEN)),
		token2: getAddress(WETH_ADDRESS),
	})

	const getTimingBoundaries = () => ({ blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 0n, blockTimestampBound: 0n })

	const executeOpenOracleCall = async (client: WriteClient, data: Hex, value = 0n) => await writeContractAndWait(client, () => client.sendTransaction({ to: openOracle, data, value }))

	const deployFalseReturningToken = async () => {
		const hash = await reporter.sendTransaction({
			data: encodeDeployData({
				abi: test_peripherals_FalseReturningERC20_FalseReturningERC20.abi,
				bytecode: `0x${test_peripherals_FalseReturningERC20_FalseReturningERC20.evm.bytecode.object}`,
			}),
		})
		const receipt = await reporter.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === null || contractAddress === undefined) throw new Error('false-returning token deployment address is unavailable')
		return contractAddress
	}

	const deployRejectingEthReceiver = async () => {
		const hash = await reporter.sendTransaction({
			data: encodeDeployData({
				abi: rejectingEthReceiverArtifact.abi,
				bytecode: `0x${rejectingEthReceiverArtifact.evm.bytecode.object}`,
			}),
		})
		const receipt = await reporter.waitForTransactionReceipt({ hash })
		const contractAddress = receipt.contractAddress
		if (contractAddress === null || contractAddress === undefined) throw new Error('rejecting ETH receiver deployment address is unavailable')
		return contractAddress
	}

	const submitReport = async (
		client: WriteClient,
		params = getReportParameters(client),
		options: {
			readonly timing?: ReturnType<typeof getTimingBoundaries>
			readonly tryInternalBalance1?: boolean
			readonly tryInternalBalance2?: boolean
			readonly value?: bigint
		} = {},
	) =>
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'report',
				args: [params, options.tryInternalBalance1 ?? false, options.tryInternalBalance2 ?? false, options.timing ?? getTimingBoundaries()],
				value: options.value ?? 1_000n,
			}),
		)

	const createReport = async (client: WriteClient) => {
		const reportId = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await submitReport(client)
		return reportId
	}

	const getHeldBalance = async (holder: Address, token: Address) =>
		await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'tokenHolder',
			args: [holder, token],
		})

	const dirtyCalldataByte = (data: Hex, byteOffsetAfterSelector: number) => {
		const bytes = hexToBytes(data)
		const index = 4 + byteOffsetAfterSelector
		if (index >= bytes.length) throw new Error(`Dirty calldata byte ${index.toString()} is out of bounds`)
		bytes[index] = 1
		return bytesToHex(bytes)
	}

	const assertRawCallReverts = async (client: WriteClient, data: Hex, value = 0n) => {
		await assert.rejects(client.call({ account: client.account, data, gas: 5_000_000n, to: openOracle, value }), /revert/i)
	}

	const disputeReport = async (
		client: WriteClient,
		reportId: bigint,
		tokenToSwap: Address,
		newAmount1: bigint,
		newAmount2: bigint,
		preimage?: Awaited<ReturnType<typeof loadOpenOracleEventState>>['latest'],
		options: {
			readonly disputer?: Address
			readonly timing?: ReturnType<typeof getTimingBoundaries>
			readonly tryInternalBalance1?: boolean
			readonly tryInternalBalance2?: boolean
			readonly value?: bigint
		} = {},
	) => {
		const resolvedPreimage = preimage ?? (await loadOpenOracleEventState(client, reportId)).latest
		return await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'dispute',
				args: [
					reportId,
					tokenToSwap,
					newAmount1,
					newAmount2,
					options.disputer ?? client.account.address,
					options.tryInternalBalance1 ?? false,
					options.tryInternalBalance2 ?? false,
					getOpenOracleGameTuple(resolvedPreimage.game),
					getOpenOracleHelperTuple(resolvedPreimage.helper),
					options.timing ?? getTimingBoundaries(),
				],
				value: options.value ?? 0n,
			}),
		)
	}

	beforeAll(async () => {
		mockWindow = getAnvilWindowEthereum()
		const deployer = clientFor(0)
		await setupTestAccounts(mockWindow)
		await ensureInfraDeployed(deployer)
		openOracle = getInfraContractAddresses().openOracle
		await setBaselineSnapshot()
	})

	beforeEach(() => {
		mockWindow = getAnvilWindowEthereum()
		reporter = clientFor(1)
		disputer = clientFor(2)
		settler = clientFor(3)
		openOracle = getInfraContractAddresses().openOracle
	})

	test('report validates every reachable custom-error parameter guard', async () => {
		const validParams = getReportParameters(reporter)
		const invalidParameterCases = [
			{ error: 'InvalidMode', params: { ...validParams, flags: 255 } },
			{ error: 'InvalidAmount1', params: { ...validParams, currentAmount1: 0n } },
			{ error: 'TokensCannotBeSame', params: { ...validParams, token2: validParams.token1 } },
			{ error: 'SettleVsDisputeDelayTiming', params: { ...validParams, settlementTime: validParams.disputeDelay } },
			{ error: 'FeesTooHigh', params: { ...validParams, feePercentage: 9_950_001 } },
			{ error: 'MultiplierTooLow', params: { ...validParams, multiplier: 99 } },
			{ error: 'InvalidAmount2', params: { ...validParams, currentAmount2: 0n } },
			{ error: 'AddressCannotBeZero', params: { ...validParams, currentReporter: ZERO_ADDRESS } },
			{ error: 'TimestampsMustBeZero', params: { ...validParams, settlementTimestamp: 1 } },
			{ error: 'NumReportsMustBeZero', params: { ...validParams, numReports: 1 } },
			{ error: 'TimestampsMustBeZero', params: { ...validParams, reportTimestamp: 1 } },
			{ error: 'TimestampsMustBeZero', params: { ...validParams, lastReportOppoTime: 1 } },
		]
		for (const { error, params } of invalidParameterCases) {
			await assertCustomError(() => submitReport(reporter, params), error)
		}

		await assertCustomError(() => submitReport(reporter, validParams, { value: 1_001n }), 'NeitherTokenIsETH')
		await assertCustomError(
			() =>
				submitReport(reporter, validParams, {
					timing: { blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 1n, blockTimestampBound: 0n },
				}),
			'InvalidTiming',
		)
		const currentBlock = await reporter.getBlock()
		const currentBlockNumber = ensureDefined(currentBlock.number, 'current block number is unavailable')
		await assertCustomError(
			() =>
				submitReport(reporter, validParams, {
					timing: {
						blockNumber: currentBlockNumber + 10_000n,
						blockNumberBound: 0n,
						blockTimestamp: currentBlock.timestamp,
						blockTimestampBound: 10_000n,
					},
				}),
			'InvalidTiming',
		)

		await prepareReporter(reporter)
		const nextReportIdBefore = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		const reportFundingBefore = {
			disputeRecord: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'disputeHistory',
				args: [nextReportIdBefore, 0n],
			}),
			gameHash: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'oracleGame',
				args: [nextReportIdBefore],
			}),
			oracleEth: await reporter.getBalance({ address: openOracle }),
			reporterRep: await getERC20Balance(reporter, validParams.token1, reporter.account.address),
			reporterWeth: await getERC20Balance(reporter, validParams.token2, reporter.account.address),
			heldRep: await getHeldBalance(reporter.account.address, validParams.token1),
			heldWeth: await getHeldBalance(reporter.account.address, validParams.token2),
		}
		await assertCustomError(() => submitReport(reporter, validParams, { value: 999n }), 'MsgValueTooLow')
		assert.strictEqual(
			await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'nextReportId',
				args: [],
			}),
			nextReportIdBefore,
			'underfunded report must not consume a report ID',
		)
		assert.deepStrictEqual(
			{
				disputeRecord: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'disputeHistory',
					args: [nextReportIdBefore, 0n],
				}),
				gameHash: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'oracleGame',
					args: [nextReportIdBefore],
				}),
				oracleEth: await reporter.getBalance({ address: openOracle }),
				reporterRep: await getERC20Balance(reporter, validParams.token1, reporter.account.address),
				reporterWeth: await getERC20Balance(reporter, validParams.token2, reporter.account.address),
				heldRep: await getHeldBalance(reporter.account.address, validParams.token1),
				heldWeth: await getHeldBalance(reporter.account.address, validParams.token2),
			},
			reportFundingBefore,
			'underfunded report must not transfer or credit collateral',
		)
	})

	test('dispute validates every reachable custom-error transition guard', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest

		await assertCustomError(() => disputeReport(disputer, reportId, token1, 1_200n, 900n, state), 'DisputeTooEarly')
		await mockWindow.setTime(state.game.reportTimestamp + DISPUTE_DELAY - 1n)

		const invalidDisputeCases = [
			{ error: 'InvalidAmount1', execute: () => disputeReport(disputer, reportId, token1, 1_201n, 900n, state) },
			{ error: 'AmountsCannotBeZero', execute: () => disputeReport(disputer, reportId, token1, 1_200n, 0n, state) },
			{ error: 'InvalidTokenToSwap', execute: () => disputeReport(disputer, reportId, ZERO_ADDRESS, 1_200n, 900n, state) },
			{
				error: 'AddressCannotBeZero',
				execute: () => disputeReport(disputer, reportId, token1, 1_200n, 900n, state, { disputer: ZERO_ADDRESS }),
			},
			{
				error: 'NeitherTokenIsETH',
				execute: () => disputeReport(disputer, reportId, token1, 1_200n, 900n, state, { value: 1n }),
			},
			{
				error: 'InvalidTiming',
				execute: () =>
					disputeReport(disputer, reportId, token1, 1_200n, 900n, state, {
						timing: { blockNumber: 0n, blockNumberBound: 0n, blockTimestamp: 1n, blockTimestampBound: 0n },
					}),
			},
		]
		for (const { error, execute } of invalidDisputeCases) {
			await assertCustomError(execute, error)
		}

		const haltedReportId = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await submitReport(reporter, { ...getReportParameters(reporter), escalationHalt: AMOUNT1 })
		const haltedState = (await loadOpenOracleEventState(reporter, haltedReportId)).latest
		await mockWindow.setTime(haltedState.game.reportTimestamp + DISPUTE_DELAY - 1n)
		await assertCustomError(() => disputeReport(disputer, haltedReportId, token1, 1_002n, 900n, haltedState), 'EscalationHalted')

		const ethReportId = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await submitReport(reporter, { ...getReportParameters(reporter), token1: ZERO_ADDRESS }, { value: 2_000n })
		const ethState = (await loadOpenOracleEventState(reporter, ethReportId)).latest
		await mockWindow.setTime(ethState.game.reportTimestamp + DISPUTE_DELAY - 1n)
		const ethDisputeStateBefore = {
			disputerHeldToken1: await getHeldBalance(disputer.account.address, ethState.game.token1),
			disputerHeldToken2: await getHeldBalance(disputer.account.address, ethState.game.token2),
			disputeRecord: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'disputeHistory',
				args: [ethReportId, BigInt(ethState.game.numReports)],
			}),
			gameHash: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'oracleGame',
				args: [ethReportId],
			}),
			oracleEth: await reporter.getBalance({ address: openOracle }),
			previousReporterAndProtocolFeeCredit: await getHeldBalance(ethState.game.currentReporter, ethState.game.token1),
			disputerHeldEth: await getHeldBalance(disputer.account.address, ZERO_ADDRESS),
		}
		await assertCustomError(() => disputeReport(disputer, ethReportId, ZERO_ADDRESS, 1_200n, 1_000n, ethState), 'MsgValueTooLow')
		assert.deepStrictEqual(
			{
				disputerHeldToken1: await getHeldBalance(disputer.account.address, ethState.game.token1),
				disputerHeldToken2: await getHeldBalance(disputer.account.address, ethState.game.token2),
				disputeRecord: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'disputeHistory',
					args: [ethReportId, BigInt(ethState.game.numReports)],
				}),
				gameHash: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'oracleGame',
					args: [ethReportId],
				}),
				oracleEth: await reporter.getBalance({ address: openOracle }),
				previousReporterAndProtocolFeeCredit: await getHeldBalance(ethState.game.currentReporter, ethState.game.token1),
				disputerHeldEth: await getHeldBalance(disputer.account.address, ZERO_ADDRESS),
			},
			ethDisputeStateBefore,
			'underfunded ETH dispute must preserve the report and all escrow accounting',
		)
	})

	test('balance, allowance, deposit, and withdrawal APIs expose their custom errors', async () => {
		const oracleAbi = peripherals_openOracle_OpenOracle_OpenOracle.abi
		const intent = `0x${'00'.repeat(32)}` satisfies Hex
		const basePermit = {
			permitted: { token: WETH_ADDRESS, amount: 1n },
			nonce: 0n,
			deadline: 2n ** 256n - 1n,
		}

		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'deposit',
						args: [WETH_ADDRESS, 1n, ZERO_ADDRESS],
					}),
				),
			'AddressCannotBeZero',
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'deposit',
						args: [WETH_ADDRESS, 0n, reporter.account.address],
					}),
					1n,
				),
			'InvalidMsgValue',
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'deposit',
						args: [ZERO_ADDRESS, 2n, reporter.account.address],
					}),
					1n,
				),
			'InvalidMsgValue',
		)

		const permitCases = [
			{
				error: 'InvalidToken',
				permit: { ...basePermit, permitted: { ...basePermit.permitted, token: ZERO_ADDRESS } },
				amount: 1n,
			},
			{
				error: 'InvalidToken',
				permit: { ...basePermit, permitted: { ...basePermit.permitted, token: reporter.account.address } },
				amount: 1n,
			},
			{
				error: 'Permit2AmountMismatch',
				permit: { ...basePermit, permitted: { ...basePermit.permitted, amount: 2n } },
				amount: 1n,
			},
		]
		for (const { amount, error, permit } of permitCases) {
			await assertCustomError(
				() =>
					executeOpenOracleCall(
						reporter,
						encodeFunctionData({
							abi: oracleAbi,
							functionName: 'depositFromPermit2',
							args: [amount, reporter.account.address, reporter.account.address, intent, permit, '0x'],
						}),
					),
				error,
			)
		}

		const zeroAddressCalls = [
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'withdrawTo',
				args: [WETH_ADDRESS, 1n, ZERO_ADDRESS],
			}),
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'depositFromPermit2',
				args: [1n, ZERO_ADDRESS, reporter.account.address, intent, basePermit, '0x'],
			}),
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'internalTransferFrom',
				args: [reporter.account.address, ZERO_ADDRESS, WETH_ADDRESS, 1n],
			}),
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'pushOrCredit',
				args: [WETH_ADDRESS, ZERO_ADDRESS, 1n],
			}),
		]
		for (const data of zeroAddressCalls) {
			await assertCustomError(() => executeOpenOracleCall(reporter, data), 'AddressCannotBeZero')
		}

		const falseReturningToken = await deployFalseReturningToken()
		const falseTokenStateBefore = {
			held: await getHeldBalance(reporter.account.address, falseReturningToken),
			oracleBalance: await getERC20Balance(reporter, falseReturningToken, openOracle),
			reporterBalance: await getERC20Balance(reporter, falseReturningToken, reporter.account.address),
		}
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'deposit',
						args: [falseReturningToken, 1n, reporter.account.address],
					}),
				),
			'SafeERC20FailedOperation',
			'SafeERC20FailedOperation(address)',
			encodeAbiParameters([{ type: 'address' }], [falseReturningToken]),
		)
		assert.deepStrictEqual(
			{
				held: await getHeldBalance(reporter.account.address, falseReturningToken),
				oracleBalance: await getERC20Balance(reporter, falseReturningToken, openOracle),
				reporterBalance: await getERC20Balance(reporter, falseReturningToken, reporter.account.address),
			},
			falseTokenStateBefore,
			'failed ERC20 deposit must not credit internal balances or move tokens',
		)

		await assertCustomError(
			() =>
				executeOpenOracleCall(
					disputer,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'internalTransferFrom',
						args: [reporter.account.address, settler.account.address, ZERO_ADDRESS, 1n],
					}),
				),
			'InsufficientInternalAllowance',
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					disputer,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'internalTransferFrom',
						args: [disputer.account.address, settler.account.address, ZERO_ADDRESS, 1n],
					}),
				),
			'InsufficientInternalBalance',
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					disputer,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'pushOrCredit',
						args: [ZERO_ADDRESS, settler.account.address, 1n],
					}),
				),
			'InsufficientInternalBalance',
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'approveInternal',
						args: [ZERO_ADDRESS, WETH_ADDRESS, 1n],
					}),
				),
			'AddressCannotBeZero',
		)
		await executeOpenOracleCall(
			reporter,
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'approveInternal',
				args: [disputer.account.address, WETH_ADDRESS, 1n],
			}),
		)
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'approveInternal',
						args: [disputer.account.address, WETH_ADDRESS, 2n],
					}),
				),
			'NonZeroAllowance',
		)
		await assertCustomError(() => submitReport(disputer, { ...getReportParameters(reporter), currentReporter: reporter.account.address }, { tryInternalBalance1: true }), 'InsufficientInternalBalance')

		await executeOpenOracleCall(
			reporter,
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'deposit',
				args: [ZERO_ADDRESS, 10n, reporter.account.address],
			}),
			10n,
		)
		const failedWithdrawalStateBefore = {
			held: await getHeldBalance(reporter.account.address, ZERO_ADDRESS),
			oracleEth: await reporter.getBalance({ address: openOracle }),
		}
		await assertCustomError(
			() =>
				executeOpenOracleCall(
					reporter,
					encodeFunctionData({
						abi: oracleAbi,
						functionName: 'withdrawTo',
						args: [ZERO_ADDRESS, 5n, openOracle],
					}),
				),
			'EthTransferFailed',
		)
		assert.deepStrictEqual(
			{
				held: await getHeldBalance(reporter.account.address, ZERO_ADDRESS),
				oracleEth: await reporter.getBalance({ address: openOracle }),
			},
			failedWithdrawalStateBefore,
			'failed ETH withdrawal must restore the internal balance and contract collateral',
		)

		const rejectingReceiver = await deployRejectingEthReceiver()
		const pushedAmount = 5n
		const pushStateBefore = {
			oracleEth: await reporter.getBalance({ address: openOracle }),
			receiverEth: await reporter.getBalance({ address: rejectingReceiver }),
			receiverHeldEth: await getHeldBalance(rejectingReceiver, ZERO_ADDRESS),
			reporterHeldEth: await getHeldBalance(reporter.account.address, ZERO_ADDRESS),
		}
		await executeOpenOracleCall(
			reporter,
			encodeFunctionData({
				abi: oracleAbi,
				functionName: 'pushOrCredit',
				args: [ZERO_ADDRESS, rejectingReceiver, pushedAmount],
			}),
		)
		assert.deepStrictEqual(
			{
				oracleEth: await reporter.getBalance({ address: openOracle }),
				receiverEth: await reporter.getBalance({ address: rejectingReceiver }),
				receiverHeldEth: await getHeldBalance(rejectingReceiver, ZERO_ADDRESS),
				reporterHeldEth: await getHeldBalance(reporter.account.address, ZERO_ADDRESS),
			},
			{
				oracleEth: pushStateBefore.oracleEth,
				receiverEth: pushStateBefore.receiverEth,
				receiverHeldEth: pushedAmount + 1n,
				reporterHeldEth: pushStateBefore.reporterHeldEth - pushedAmount,
			},
			'rejected ETH push must preserve collateral and credit the recipient internally instead',
		)
	})

	test('settlement reports early, repeated, and underfunded callback gas errors', async () => {
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest

		await assertCustomError(() => openOracleSettle(settler, reportId), 'SettleTooEarly')
		await mockWindow.setTime(state.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		await openOracleSettle(settler, reportId)
		await assertCustomError(() => openOracleSettle(settler, reportId), 'AlreadySettled')

		const callbackReportId = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await submitReport(reporter, {
			...getReportParameters(reporter),
			callbackContract: reporter.account.address,
			callbackGasLimit: Number(2n ** 32n - 1n),
		})
		const callbackState = (await loadOpenOracleEventState(reporter, callbackReportId)).latest
		await mockWindow.setTime(callbackState.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		const invalidGasStateBefore = {
			finalizedGame: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'finalizedGame',
				args: [callbackReportId],
			}),
			gameHash: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'oracleGame',
				args: [callbackReportId],
			}),
			finalPrice: await reporter.readContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'finalPrice',
				args: [callbackReportId],
			}),
			reporterToken1: await getHeldBalance(callbackState.game.currentReporter, callbackState.game.token1),
			reporterToken2: await getHeldBalance(callbackState.game.currentReporter, callbackState.game.token2),
			settlerReward: await getHeldBalance(settler.account.address, ZERO_ADDRESS),
		}
		await assertCustomError(() => openOracleSettle(settler, callbackReportId), 'InvalidGasLimit')
		assert.deepStrictEqual(
			{
				finalizedGame: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'finalizedGame',
					args: [callbackReportId],
				}),
				gameHash: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'oracleGame',
					args: [callbackReportId],
				}),
				finalPrice: await reporter.readContract({
					abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
					address: openOracle,
					functionName: 'finalPrice',
					args: [callbackReportId],
				}),
				reporterToken1: await getHeldBalance(callbackState.game.currentReporter, callbackState.game.token1),
				reporterToken2: await getHeldBalance(callbackState.game.currentReporter, callbackState.game.token2),
				settlerReward: await getHeldBalance(settler.account.address, ZERO_ADDRESS),
			},
			invalidGasStateBefore,
			'invalid callback gas must roll back settlement hashes, prices, collateral credits, and rewards',
		)
	})

	test('atomic report events reconstruct the exact on-chain state preimage', async () => {
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const eventState = await loadOpenOracleEventState(reporter, reportId)
		const storedHash = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'oracleGame',
			args: [reportId],
		})

		assert.strictEqual(hashOpenOracleStatePreimage(eventState.latest), storedHash)
		assert.strictEqual(eventState.latest.game.currentAmount1, AMOUNT1)
		assert.strictEqual(eventState.latest.game.currentAmount2, AMOUNT2)
		assert.strictEqual(eventState.latest.game.currentReporter, reporter.account.address)
		assert.strictEqual(eventState.latest.game.numReports, 1n)
		assert.strictEqual((await getOpenOracleExtraData(reporter, reportId)).numReports, 1)
	})

	test('dirty report calldata reverts before creating a state hash', async () => {
		await prepareReporter(reporter)
		const reportId = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		const cleanData = encodeFunctionData({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'report',
			args: [getReportParameters(reporter), false, false, getTimingBoundaries()],
		})
		await assertRawCallReverts(reporter, dirtyCalldataByte(cleanData, 0x0f), 1_000n)

		assert.strictEqual(await reporter.readContract({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, address: openOracle, functionName: 'nextReportId', args: [] }), reportId)
		assert.strictEqual(await reporter.readContract({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, address: openOracle, functionName: 'oracleGame', args: [reportId] }), `0x${'00'.repeat(32)}`)
	})

	test('dirty dispute calldata cannot mutate the report state hash', async () => {
		await prepareReporter(reporter)
		await prepareReporter(disputer)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest
		const storedHash = hashOpenOracleStatePreimage(state)
		await mockWindow.setTime(state.game.reportTimestamp + DISPUTE_DELAY - 1n)
		const cleanData = encodeFunctionData({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'dispute',
			args: [reportId, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), 1_200n, 800n, disputer.account.address, false, false, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper), [0n, 0n, 0n, 0n]],
		})
		await assertRawCallReverts(disputer, dirtyCalldataByte(cleanData, 0x4f))

		assert.strictEqual(await reporter.readContract({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, address: openOracle, functionName: 'oracleGame', args: [reportId] }), storedHash)
	})

	test('dirty settle calldata cannot bypass state-hash verification', async () => {
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest
		const storedHash = hashOpenOracleStatePreimage(state)
		await mockWindow.setTime(state.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		const cleanData = encodeFunctionData({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			args: [reportId, getOpenOracleGameTuple(state.game), getOpenOracleHelperTuple(state.helper)],
		})
		await assertRawCallReverts(settler, dirtyCalldataByte(cleanData, 0x2f))

		assert.strictEqual(await reporter.readContract({ abi: peripherals_openOracle_OpenOracle_OpenOracle.abi, address: openOracle, functionName: 'oracleGame', args: [reportId] }), storedHash)
		assert.strictEqual((await getOpenOracleReportStatus(reporter, reportId)).settlementTimestamp, 0n)
	})

	test('dispute replaces the report, rejects stale preimages, and settles into withdrawable balances', async () => {
		await prepareReporter(reporter)
		await prepareReporter(disputer)
		const reportId = await createReport(reporter)
		const original = (await loadOpenOracleEventState(reporter, reportId)).latest
		await mockWindow.setTime(original.game.reportTimestamp + DISPUTE_DELAY - 1n)
		await disputeReport(disputer, reportId, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), 1_200n, 800n, original)

		const disputed = await loadOpenOracleEventState(reporter, reportId)
		assert.strictEqual(disputed.reportCount, 2)
		assert.strictEqual(disputed.latest.game.currentReporter, disputer.account.address)
		assert.strictEqual(disputed.latest.game.currentAmount1, 1_200n)
		assert.strictEqual(disputed.latest.game.currentAmount2, 800n)
		await assertCustomError(() => disputeReport(disputer, reportId, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), 1_440n, 900n, original), 'InvalidStateHash')

		await mockWindow.setTime(disputed.latest.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		await openOracleSettle(settler, reportId)
		const status = await getOpenOracleReportStatus(reporter, reportId)
		assert.ok(status.settlementTimestamp >= disputed.latest.game.reportTimestamp + SETTLEMENT_TIME)

		const heldToken1 = await reporter.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'tokenHolder',
			args: [disputer.account.address, getAddress(addressString(GENESIS_REPUTATION_TOKEN))],
		})
		assert.strictEqual(heldToken1, 1_201n)
		const balanceBefore = await getERC20Balance(reporter, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), disputer.account.address)
		await writeContractAndWait(disputer, () =>
			disputer.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'withdraw',
				args: [getAddress(addressString(GENESIS_REPUTATION_TOKEN)), 1_200n],
			}),
		)
		assert.strictEqual((await getERC20Balance(reporter, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), disputer.account.address)) - balanceBefore, 1_200n)
	})

	test('self-dispute against token1 preserves exact external and internal balances', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest
		const externalToken1Before = await getERC20Balance(reporter, token1, reporter.account.address)
		const externalToken2Before = await getERC20Balance(reporter, WETH_ADDRESS, reporter.account.address)
		await mockWindow.setTime(state.game.reportTimestamp + DISPUTE_DELAY - 1n)

		await disputeReport(reporter, reportId, token1, 1_200n, 800n, state)

		assert.strictEqual(await getERC20Balance(reporter, token1, reporter.account.address), externalToken1Before - 205n)
		assert.strictEqual(await getERC20Balance(reporter, WETH_ADDRESS, reporter.account.address), externalToken2Before)
		assert.strictEqual(await getHeldBalance(reporter.account.address, token1), 6n)
		assert.strictEqual(await getHeldBalance(reporter.account.address, WETH_ADDRESS), 201n)

		const disputed = (await loadOpenOracleEventState(reporter, reportId)).latest
		await mockWindow.setTime(disputed.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		await openOracleSettle(settler, reportId)
		assert.strictEqual(await getHeldBalance(reporter.account.address, token1), 1_206n)
		assert.strictEqual(await getHeldBalance(reporter.account.address, WETH_ADDRESS), 1_001n)
	})

	test('self-dispute against token2 preserves exact external and internal balances', async () => {
		const token1 = getAddress(addressString(GENESIS_REPUTATION_TOKEN))
		await prepareReporter(reporter)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest
		const externalToken1Before = await getERC20Balance(reporter, token1, reporter.account.address)
		const externalToken2Before = await getERC20Balance(reporter, WETH_ADDRESS, reporter.account.address)
		await mockWindow.setTime(state.game.reportTimestamp + DISPUTE_DELAY - 1n)

		await disputeReport(reporter, reportId, WETH_ADDRESS, 1_200n, 1_300n, state)

		assert.strictEqual(await getERC20Balance(reporter, token1, reporter.account.address), externalToken1Before - 200n)
		assert.strictEqual(await getERC20Balance(reporter, WETH_ADDRESS, reporter.account.address), externalToken2Before - 305n)
		assert.strictEqual(await getHeldBalance(reporter.account.address, token1), 1n)
		assert.strictEqual(await getHeldBalance(reporter.account.address, WETH_ADDRESS), 6n)

		const disputed = (await loadOpenOracleEventState(reporter, reportId)).latest
		await mockWindow.setTime(disputed.game.reportTimestamp + SETTLEMENT_TIME - 1n)
		await openOracleSettle(settler, reportId)
		assert.strictEqual(await getHeldBalance(reporter.account.address, token1), 1_201n)
		assert.strictEqual(await getHeldBalance(reporter.account.address, WETH_ADDRESS), 1_306n)
	})

	test('the exact settlement deadline belongs only to settlement', async () => {
		await prepareReporter(reporter)
		await prepareReporter(disputer)
		const reportId = await createReport(reporter)
		const state = (await loadOpenOracleEventState(reporter, reportId)).latest
		const deadline = state.game.reportTimestamp + SETTLEMENT_TIME
		const boundarySnapshot = await mockWindow.anvilSnapshot()
		await mockWindow.setTime(deadline - 1n)

		await assertCustomError(() => disputeReport(disputer, reportId, getAddress(addressString(GENESIS_REPUTATION_TOKEN)), 1_200n, 900n, state), 'DisputeTooLate')
		assert.strictEqual((await reporter.getBlock()).timestamp, deadline)

		await mockWindow.anvilRevert(boundarySnapshot)
		await mockWindow.setTime(deadline - 1n)
		await openOracleSettle(settler, reportId)
		assert.strictEqual((await getOpenOracleReportStatus(reporter, reportId)).settlementTimestamp, deadline)
		assert.strictEqual(await mockWindow.getTime(), deadline)
	})
})
