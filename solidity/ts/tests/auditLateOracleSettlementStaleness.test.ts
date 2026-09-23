import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { describe, test } from 'bun:test'
import assert from '../testSupport/simulator/utils/assert'
import type { WriteClient } from '../testSupport/simulator/utils/clients'
import { backingUnitsToAttoRep, getSecurityVault } from '../testSupport/simulator/utils/contracts/securityPool'
import {
	OperationType,
	getIsPriceValid,
	getLastPrice,
	getOpenOracleReportMeta,
	getOpenOracleReportStatus,
	getPendingReportId,
	getPendingSettlementOperationCount,
	getRequestPriceCostAttoEth,
	openOracleSettle,
	requestPriceIfNeededAndStageOperationWithInitialReportPrice,
	requestPriceWithValue,
} from '../testSupport/simulator/utils/contracts/statoblast'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../types/contractArtifact'
import { isIgnorableLogDecodeError } from './logDecodeErrors'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'

const PRICE_VALID_FOR_SECONDS = 5n * 60n
const OPERATION_VALID_FOR_SECONDS = 5n * 60n

type Fixture = ReturnType<typeof useStatoblastVaultAccountingFixture>
type TransactionReceiptLogs = Awaited<ReturnType<WriteClient['waitForTransactionReceipt']>>['logs']

const decodeCoordinatorLogs = (logs: TransactionReceiptLogs) =>
	logs.flatMap(log => {
		try {
			return [decodeEventLog({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics })]
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			return []
		}
	})

const readLastSettlementTimestamp = async (fixture: Fixture) =>
	await fixture.client.readContract({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		address: fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer,
		functionName: 'lastSettlementTimestamp',
		args: [],
	})

const getVaultRep = async (fixture: Fixture) => {
	const securityPool = fixture.securityPoolAddresses.securityPool
	const vault = await getSecurityVault(fixture.client, securityPool, fixture.client.account.address)
	return await backingUnitsToAttoRep(fixture.client, securityPool, vault.repBackingUnits)
}

// Stages a REP withdrawal that opens a report, then returns the report's settlement eligibility time.
const stageWithdrawalBehindPendingReport = async (fixture: Fixture, withdrawAttoRep: bigint) => {
	const { client, reportedRepEthPrice, securityPoolAddresses } = fixture
	const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
	const bountyAttoEth = await getRequestPriceCostAttoEth(client, coordinator)
	await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, coordinator, OperationType.WithdrawRep, client.account.address, withdrawAttoRep, OPERATION_VALID_FOR_SECONDS, reportedRepEthPrice, bountyAttoEth)
	const reportId = await getPendingReportId(client, coordinator)
	assert.ok(reportId > 0n, 'staging should open a coordinator report')
	assert.strictEqual(await getPendingSettlementOperationCount(client, coordinator), 1n, 'withdrawal should wait for the pending report')
	const [reportMeta, reportStatus] = await Promise.all([getOpenOracleReportMeta(client, reportId), getOpenOracleReportStatus(client, reportId)])
	return { reportId, settleableAt: reportStatus.reportTimestamp + BigInt(reportMeta.settlementTime) }
}

const settle = async (fixture: Fixture, reportId: bigint) => {
	const hash = await openOracleSettle(fixture.client, reportId)
	const receipt = await fixture.client.waitForTransactionReceipt({ hash })
	return decodeCoordinatorLogs(receipt.logs)
}

describe('Audit PoC: late OpenOracle settlement installs a stale price as fresh', () => {
	const fixture = useStatoblastVaultAccountingFixture()

	test('a report settled after its freshness window is rejected and cannot execute attached or new operations', async () => {
		const { client, mockWindow, reportedRepEthPrice, securityPoolAddresses } = fixture
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const withdrawAttoRep = 10n ** 18n
		const repBefore = await getVaultRep(fixture)
		const { reportId, settleableAt } = await stageWithdrawalBehindPendingReport(fixture, withdrawAttoRep)

		// The final report is frozen once disputes close, but the sponsor withholds settlement for a day.
		await mockWindow.setTime(settleableAt + 24n * 60n * 60n)
		const logs = await settle(fixture, reportId)

		assert.strictEqual(await getIsPriceValid(client, coordinator), false, 'a day-old report must not become a fresh coordinator price')
		assert.strictEqual(await getLastPrice(client, coordinator), 0n, 'a stale report must not replace the cached price')
		assert.strictEqual(await readLastSettlementTimestamp(fixture), 0n, 'a stale report must not refresh the settlement timestamp')
		const rejection = logs.find(log => log.eventName === 'PriceReportRejected')
		assert.ok(rejection !== undefined && rejection.args.reason === 'Report stale', 'late settlement should be rejected as stale')
		const execution = logs.find(log => log.eventName === 'ExecutedStagedOperation')
		assert.ok(execution !== undefined && !execution.args.success && execution.args.errorMessage === 'Report stale', 'the attached withdrawal should terminally fail')
		assert.strictEqual(await getVaultRep(fixture), repBefore, 'the stale report must not release REP')
		assert.strictEqual(await getPendingReportId(client, coordinator), 0n, 'rejection must clear the pending report')
		assert.strictEqual(await getPendingSettlementOperationCount(client, coordinator), 0n, 'rejection must clear the pending batch')

		// A follow-up price-gated operation cannot run against the stale report; it must request a new price.
		const bountyAttoEth = await getRequestPriceCostAttoEth(client, coordinator)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, coordinator, OperationType.WithdrawRep, client.account.address, withdrawAttoRep, OPERATION_VALID_FOR_SECONDS, reportedRepEthPrice, bountyAttoEth)
		assert.strictEqual(await getVaultRep(fixture), repBefore, 'a follow-up withdrawal must not execute immediately')
		assert.ok((await getPendingReportId(client, coordinator)) > reportId, 'liveness: a new report can be requested after the stale rejection')
	})

	test('a slightly late settlement is accepted but its freshness runs from settlement eligibility', async () => {
		const { client, mockWindow, reportedRepEthPrice, securityPoolAddresses } = fixture
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const withdrawAttoRep = 10n ** 18n
		const repBefore = await getVaultRep(fixture)
		const { reportId, settleableAt } = await stageWithdrawalBehindPendingReport(fixture, withdrawAttoRep)
		const lateBySeconds = PRICE_VALID_FOR_SECONDS - 60n

		await mockWindow.setTime(settleableAt + lateBySeconds)
		const logs = await settle(fixture, reportId)

		assert.ok(
			logs.some(log => log.eventName === 'PriceReported'),
			'a settlement inside the freshness window should be accepted',
		)
		assert.ok(
			logs.some(log => log.eventName === 'ExecutedStagedOperation' && log.args.success),
			'the attached withdrawal should execute',
		)
		assert.strictEqual(await getVaultRep(fixture), repBefore - withdrawAttoRep, 'the withdrawal should release REP')
		assert.strictEqual(await readLastSettlementTimestamp(fixture), settleableAt, 'freshness should be anchored to settlement eligibility')
		assert.ok((await getLastPrice(client, coordinator)) > 0n, 'accepted report should set the cached price')

		await mockWindow.setTime(settleableAt + PRICE_VALID_FOR_SECONDS - 1n)
		assert.strictEqual(await getIsPriceValid(client, coordinator), true, 'price stays valid until eligibility plus the freshness window')
		await mockWindow.setTime(settleableAt + PRICE_VALID_FOR_SECONDS)
		assert.strictEqual(await getIsPriceValid(client, coordinator), false, 'late settlement must not extend freshness past eligibility plus the window')

		const bountyAttoEth = await getRequestPriceCostAttoEth(client, coordinator)
		await requestPriceWithValue(client, coordinator, bountyAttoEth, reportedRepEthPrice)
		assert.ok((await getPendingReportId(client, coordinator)) > reportId, 'a new report can be requested once the anchored window closes')
	})
})
