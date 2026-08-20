import { encodeAbiParameters, keccak256, zeroAddress } from '@zoltar/shared/ethereum'
import type { Address } from '@zoltar/shared/ethereum'
import { AnvilWindowEthereum } from '../../AnvilWindowEthereum'
import { addressString } from '../bigint'
import { getSecurityPoolAddresses } from './deployStatoblast'
import { GENESIS_REPUTATION_TOKEN } from '../constants'
import { approveToken, contractExists, getERC20Balance, requireAddress } from '../utilities'
import { WriteClient, writeContractAndWait } from '../clients'
import assert from '../assert'
import { getIsPriceValid, getLastPrice, getOpenOracleReportMeta, getOpenOracleReportStatus, getPendingReportId, getRequestPriceCostAttoEth, openOracleSettle, OperationType, requestPriceIfNeededAndStageOperationWithInitialReportPrice, requestPriceWithValue } from './statoblast'
import { QuestionOutcome } from '../../types/types'
import { forkZoltarWithOwnEscalationGame } from './securityPoolForker'
import { getTotalTheoreticalSupplyAttoRep } from './zoltar'
import { depositRepToVault, depositToEscalationGame, getRepToken, getSecurityVault, backingUnitsToAttoRep } from './securityPool'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../../../../types/contractArtifact'

const genesisUniverse = 0n
const statoblastSecurityMultiplierBps = 20_000n
const PRICE_PRECISION = 10n ** 18n
const DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS = 5n * 60n
const ORACLE_PRICE_VALID_FOR_SECONDS = 5n * 60n

export const approveAndDepositRepToVault = async (client: WriteClient, repDeposit: bigint, questionId: bigint, targetHealthFactorBps = 10_000n) => {
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, genesisUniverse, questionId, statoblastSecurityMultiplierBps).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRepToVault(client, securityPoolAddress, repDeposit, targetHealthFactorBps)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	assert.strictEqual(newBalance, startBalance + repDeposit, 'Did not deposit rep')
}

export const triggerOwnGameFork = async (client: WriteClient, securityPoolAddress: Address) => {
	const repToken = await getRepToken(client, securityPoolAddress)
	const forkThresholdAttoRep = (((await getTotalTheoreticalSupplyAttoRep(client, repToken)) / 20n) * 10_000n) / statoblastSecurityMultiplierBps
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	const attoRepAmount = await backingUnitsToAttoRep(client, securityPoolAddress, vault.repBackingUnits)
	assert.ok(attoRepAmount >= 2n * forkThresholdAttoRep, 'not enough rep in vault to fork')
	const minRepDeposit = 10n * 10n ** 18n
	const secondEscalationDeposit = attoRepAmount - 2n * forkThresholdAttoRep < minRepDeposit ? attoRepAmount - forkThresholdAttoRep : forkThresholdAttoRep
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.Yes, forkThresholdAttoRep)
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.No, secondEscalationDeposit)
	await forkZoltarWithOwnEscalationGame(client, securityPoolAddress)
}

export const handleOracleReporting = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, forceRepEthPriceTo: bigint) => {
	const pendingReportId = await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)
	if (pendingReportId === 0n) {
		// operation already executed
		return
	}
	assert.ok(pendingReportId > 0, 'Operation is not queued')

	const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
	const reportStatus = await getOpenOracleReportStatus(client, pendingReportId)
	const expectedAmount1 = reportMeta.exactToken1Report
	const expectedAmount2 = (expectedAmount1 * forceRepEthPriceTo + PRICE_PRECISION - 1n) / PRICE_PRECISION
	const expectedSettledPrice = (expectedAmount2 * PRICE_PRECISION) / expectedAmount1

	assert.strictEqual(reportStatus.currentAmount1, expectedAmount1, 'pending report should preserve the coordinator-selected token1 amount')
	assert.strictEqual(reportStatus.currentAmount2, expectedAmount2, 'pending report should already encode the forced price before settlement')
	assert.notStrictEqual(reportStatus.currentReporter, zeroAddress, 'pending report should already have an initial reporter')
	assert.strictEqual(reportStatus.currentReporter, priceOracleManagerAndOperatorQueuer, 'pending report should use the coordinator as the current reporter')
	assert.strictEqual(reportStatus.initialReporter, priceOracleManagerAndOperatorQueuer, 'pending report should preserve the coordinator as the initial reporter')
	assert.ok(reportStatus.reportTimestamp > 0n, 'pending report should already have a report timestamp')

	await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)

	await openOracleSettle(client, pendingReportId)
	assert.strictEqual(await getLastPrice(client, priceOracleManagerAndOperatorQueuer), expectedSettledPrice, 'settled coordinator price should match the encoded pending report price')
}

export const manipulatePriceOracleAndPerformOperation = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	if (operation === OperationType.PriceRefresh) {
		await manipulatePriceOracle(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
		assert.strictEqual(targetVault, client.account.address, 'capacity target must be the caller vault')
		const securityPool = requireAddress(
			await client.readContract({
				abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
				address: priceOracleManagerAndOperatorQueuer,
				functionName: 'securityPool',
				args: [],
			}),
			'Coordinator security pool',
		)
		await writeContractAndWait(client, () =>
			client.writeContract({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				address: securityPool,
				functionName: 'updateVaultFees',
				args: [targetVault],
			}),
		)
		const [vault, totalCapacityOwnershipAttoRep, poolAccounting] = await Promise.all([
			getSecurityVault(client, securityPool, targetVault),
			client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'totalCapacityOwnershipAttoRep', args: [] }),
			client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'getPoolAccountingSnapshot', args: [] }),
		])
		const vaultAttoRep = await backingUnitsToAttoRep(client, securityPool, vault.repBackingUnits)
		const lastDepositTargetHealthFactorBps = amount === 0n ? (1n << 256n) - 1n : (vaultAttoRep * 10_000n) / amount
		// Legacy scenarios used an oracle-gated absolute-capacity setter as setup. Capacity is now
		// created only by deposit-time target factors, so preserve those scenarios with an explicit
		// Anvil fixture override while production and focused tests exercise the new deposit path.
		const mappingSlot = (slot: bigint) => BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [targetVault, slot])))
		const storageHex = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}` as `0x${string}`
		await mockWindow.addStateOverrides({
			[securityPool]: {
				stateDiff: {
					[storageHex(1n)]: totalCapacityOwnershipAttoRep - vault.capacityOwnershipAttoRep + amount,
					[storageHex(12n)]: poolAccounting.feeEligibleCapacityOwnershipAttoRep - vault.capacityOwnershipAttoRep + amount,
					[storageHex(mappingSlot(16n) + 1n)]: amount,
					[storageHex(mappingSlot(25n))]: lastDepositTargetHealthFactorBps,
				},
			},
		})
		return
	}
	const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracleManagerAndOperatorQueuer)
	await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS, forceRepEthPriceTo, costAttoEth)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async (client: WriteClient, mockWindow: AnvilWindowEthereum, priceOracleManagerAndOperatorQueuer: Address, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	if (await getIsPriceValid(client, priceOracleManagerAndOperatorQueuer)) {
		await mockWindow.advanceTime(ORACLE_PRICE_VALID_FOR_SECONDS + 1n)
	}
	const costAttoEth = await getRequestPriceCostAttoEth(client, priceOracleManagerAndOperatorQueuer)
	await requestPriceWithValue(client, priceOracleManagerAndOperatorQueuer, costAttoEth, forceRepEthPriceTo)
	await handleOracleReporting(client, mockWindow, priceOracleManagerAndOperatorQueuer, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, capacityOwnershipAttoRep: bigint, repClaim: bigint, statoblastSecurityMultiplierBps: bigint) => capacityOwnershipAttoRep * lastPrice * statoblastSecurityMultiplierBps > repClaim * PRICE_PRECISION * 10_000n
