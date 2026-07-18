import { beforeAll, beforeEach, describe, setDefaultTimeout, test } from 'bun:test'
import { bytesToHex, encodeFunctionData, getAddress, hexToBytes, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'
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
import { peripherals_openOracle_OpenOracle_OpenOracle } from '../types/contractArtifact'

setDefaultTimeout(TEST_TIMEOUT_MS)

const AMOUNT1 = 1_000n
const AMOUNT2 = 1_000n
const DISPUTE_DELAY = 10n
const SETTLEMENT_TIME = 100n
const MULTIPLIER = 120n
const FEE_PERCENTAGE = 100_000n
const PROTOCOL_FEE = 50_000n
const FLAGS = OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_STORE_PRICE

describe('OpenOracle 0.2.0 report lifecycle', () => {
	const { getAnvilWindowEthereum, setBaselineSnapshot } = useIsolatedAnvilNode()
	let mockWindow: AnvilWindowEthereum
	let reporter: WriteClient
	let disputer: WriteClient
	let settler: WriteClient
	let openOracle: Address

	const clientFor = (index: number) => createWriteClient(mockWindow, ensureDefined(TEST_ADDRESSES[index], `missing test account ${index.toString()}`), 0)

	const assertCustomError = async (execute: () => Promise<unknown>, errorName: string) => {
		let rejection: unknown
		try {
			await execute()
		} catch (error) {
			rejection = error
		}
		if (!(rejection instanceof Error)) throw new Error(`Expected ${errorName} custom error`)
		const selector = keccak256(`${errorName}()`).slice(0, 10).toLowerCase()
		assert.ok(rejection.message.toLowerCase().includes(errorName.toLowerCase()) || rejection.message.toLowerCase().includes(selector), `Expected ${errorName} (${selector}), received: ${rejection.message}`)
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

	const createReport = async (client: WriteClient) => {
		const reportId = await client.readContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			address: openOracle,
			functionName: 'nextReportId',
			args: [],
		})
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'report',
				args: [getReportParameters(client), false, false, getTimingBoundaries()],
				value: 1_000n,
			}),
		)
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

	const disputeReport = async (client: WriteClient, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, preimage?: Awaited<ReturnType<typeof loadOpenOracleEventState>>['latest']) => {
		const resolvedPreimage = preimage ?? (await loadOpenOracleEventState(client, reportId)).latest
		return await writeContractAndWait(client, () =>
			client.writeContract({
				abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
				address: openOracle,
				functionName: 'dispute',
				args: [reportId, tokenToSwap, newAmount1, newAmount2, client.account.address, false, false, getOpenOracleGameTuple(resolvedPreimage.game), getOpenOracleHelperTuple(resolvedPreimage.helper), [0n, 0n, 0n, 0n]],
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
