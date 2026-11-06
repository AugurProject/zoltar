import { describe, test } from 'bun:test'
import { getCreateAddress, encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../testSupport/deployContract'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { applyLibraries, getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../types/contractArtifact'
import { useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'
import {
	calculateOracleMinimumWethReportAttoEth,
	DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS,
	DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
	ORACLE_DISPUTE_DELAY,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	ORACLE_MULTIPLIER,
	ORACLE_PROTOCOL_FEE,
	ORACLE_REPORT_GAS,
	ORACLE_SETTLEMENT_GAS,
	ORACLE_SETTLEMENT_TIME,
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
	ORACLE_TIME_TYPE,
	ORACLE_TRACK_DISPUTES,
} from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, number, bigint, bigint, bigint, bigint, number, number, number, number, number, boolean, boolean, Address, bigint, bigint, bigint]

function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
	return encodeDeployData({
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		bytecode: applyLibraries(statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object),
		args: [...args, getCreateAddress({ from: getInfraContractAddresses().priceCoordinatorDeploymentWorker, nonce: 3n })],
	})
}

describe('Portfolio oracle configuration guards', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	const getOracleCoordinatorConstructorArgs = (): OracleCoordinatorConstructorArgs => [
		getInfraContractAddresses().openOracle,
		addressString(GENESIS_REPUTATION_TOKEN),
		WETH_ADDRESS,
		ORACLE_REPORT_GAS,
		ORACLE_SETTLEMENT_GAS,
		ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
		DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
		ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
		OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
		ORACLE_SETTLEMENT_TIME,
		ORACLE_DISPUTE_DELAY,
		ORACLE_PROTOCOL_FEE,
		ORACLE_FEE_PERCENTAGE,
		ORACLE_MULTIPLIER,
		ORACLE_TIME_TYPE,
		ORACLE_TRACK_DISPUTES,
		zeroAddress,
		ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
		ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
		ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	]

	test('coordinator constructor rejects a priority fee that would exhaust OpenOracle report limits', async () => {
		const client = fixture.owner()
		const maximumArgs = getOracleCoordinatorConstructorArgs()
		maximumArgs[6] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS
		const maximumCoordinator = await deployContract(client, encodeOracleCoordinatorDeployData(maximumArgs))
		assert.strictEqual(await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: maximumCoordinator, functionName: 'initialReportPriorityFeeAttoEthPerGas' }), MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS)

		const invalidArgs = getOracleCoordinatorConstructorArgs()
		invalidArgs[6] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n
		await assert.rejects(async () => await deployContract(client, encodeOracleCoordinatorDeployData(invalidArgs)), /initial report priority fee exceeds openoracle limits/i)
	})

	test('coordinator constructor requires a timestamp clock with dispute tracking', async () => {
		const client = fixture.owner()
		// Price freshness is measured from the final report timestamp, so block-number games are unsupported.
		const blockClockArgs = getOracleCoordinatorConstructorArgs()
		blockClockArgs[14] = false
		await assert.rejects(async () => await deployContract(client, encodeOracleCoordinatorDeployData(blockClockArgs)), /Oracle must track disputes on a timestamp clock/)
		const untrackedArgs = getOracleCoordinatorConstructorArgs()
		untrackedArgs[15] = false
		await assert.rejects(async () => await deployContract(client, encodeOracleCoordinatorDeployData(untrackedArgs)), /Oracle must track disputes on a timestamp clock/)
	})

	test('coordinator constructor rejects unsafe oracle risk parameters', async () => {
		const client = fixture.owner()
		const baseArgs = getOracleCoordinatorConstructorArgs()
		const zeroPriorityArgs = getOracleCoordinatorConstructorArgs()
		zeroPriorityArgs[6] = 0n
		const untrackedArgs = getOracleCoordinatorConstructorArgs()
		untrackedArgs[15] = false
		const zeroRequestGasArgs = getOracleCoordinatorConstructorArgs()
		zeroRequestGasArgs[3] = 0n
		zeroRequestGasArgs[4] = 0
		const buildArgsWithSizingParameters = (gasUnitsForOneDispute: bigint, targetPriceErrorForDispute: bigint, openOracleSecurityMultiplierBps: bigint, protocolFee: number, feePercentage: number): OracleCoordinatorConstructorArgs => [
			baseArgs[0],
			baseArgs[1],
			baseArgs[2],
			baseArgs[3],
			baseArgs[4],
			gasUnitsForOneDispute,
			baseArgs[6],
			targetPriceErrorForDispute,
			openOracleSecurityMultiplierBps,
			baseArgs[9],
			baseArgs[10],
			protocolFee,
			feePercentage,
			baseArgs[13],
			baseArgs[14],
			baseArgs[15],
			baseArgs[16],
			baseArgs[17],
			baseArgs[18],
			baseArgs[19],
		]
		const buildArgsWithRiskParameters = (escalationHaltMultiplierBps: bigint, maxSettlementBaseFeeMultiplierBps: bigint, minLiquidationPriceDistanceBps: bigint): OracleCoordinatorConstructorArgs => [
			baseArgs[0],
			baseArgs[1],
			baseArgs[2],
			baseArgs[3],
			baseArgs[4],
			baseArgs[5],
			baseArgs[6],
			baseArgs[7],
			baseArgs[8],
			baseArgs[9],
			baseArgs[10],
			baseArgs[11],
			baseArgs[12],
			baseArgs[13],
			baseArgs[14],
			baseArgs[15],
			baseArgs[16],
			escalationHaltMultiplierBps,
			maxSettlementBaseFeeMultiplierBps,
			minLiquidationPriceDistanceBps,
		]
		const invalidRiskParameterCases: Array<{
			args: OracleCoordinatorConstructorArgs
			message: RegExp
		}> = [
			{
				args: zeroPriorityArgs,
				message: /initial priority fee zero/i,
			},
			{
				args: untrackedArgs,
				message: /revert/i,
			},
			{
				args: buildArgsWithSizingParameters(0n, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /dispute gas units zero/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, 9999n, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /open oracle security multiplier must be at least one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, 10000001n, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /target price error cannot exceed one hundred percent/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, 490000, 10000),
				message: /oracle fees must be below the target price error/i,
			},
			{
				args: buildArgsWithSizingParameters(ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE, (2n ** 256n - 1n) / (10000000n + ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE) + 1n, ORACLE_PROTOCOL_FEE, ORACLE_FEE_PERCENTAGE),
				message: /open oracle security multiplier is too large/i,
			},
			{
				args: buildArgsWithRiskParameters(0n, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /escalation multiplier zero/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, 9999n, ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS),
				message: /max settlement base fee multiplier must be at least one hundred percent/i,
			},
			{
				args: buildArgsWithRiskParameters(ORACLE_ESCALATION_HALT_MULTIPLIER_BPS, ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS, 10001n),
				message: /minimum liquidation price distance cannot exceed one hundred percent/i,
			},
			{
				args: zeroRequestGasArgs,
				message: /request gas units zero/i,
			},
		]

		for (const invalidCase of invalidRiskParameterCases) {
			await assert.rejects(async () => await deployContract(client, encodeOracleCoordinatorDeployData(invalidCase.args)), invalidCase.message)
		}
	})

	test('shared feeds use their configured dispute sizing and priority fee at the numeric boundary', async () => {
		const client = fixture.owner()
		for (const priority of [DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS]) {
			const args = getOracleCoordinatorConstructorArgs()
			args[6] = priority
			args[7] = 1_000_000n
			args[8] = 30_000n
			const coordinator = await deployContract(client, encodeOracleCoordinatorDeployData(args))
			const feed = await deployContract(client, encodeDeployData({ abi: feedArtifact.abi, bytecode: applyLibraries(feedArtifact.evm.bytecode.object), args: [coordinator, getInfraContractAddresses().securityPoolFactory, fixture.portfolio, fixture.base.genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN)] }))
			for (const baseFee of [0n, 30n * 10n ** 9n]) {
				await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFee.toString(16)}`] })
				await fixture.base.mockWindow.request({ method: 'evm_mine', params: [] })
				const minimum = await client.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })
				assert.strictEqual(minimum, calculateOracleMinimumWethReportAttoEth({ ...DEFAULT_ORACLE_MINIMUM_WETH_REPORT_PARAMETERS, baseFeeAttoEthPerGas: baseFee, initialReportPriorityFeeAttoEthPerGas: priority, targetPriceErrorForDispute: args[7], openOracleSecurityMultiplierBps: args[8] }))
				assert.ok(minimum <= (1n << 128n) - 1n)
			}
			await fixture.base.mockWindow.setNextBlockBaseFeePerGasToZero()
		}
	})
})
