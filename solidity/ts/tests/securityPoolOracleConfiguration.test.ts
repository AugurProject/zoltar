import { describe, test } from 'bun:test'
import { encodeDeployData, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import { deployContract } from '../testSupport/deployContract'
import assert from '../testSupport/simulator/utils/assert'
import { addressString } from '../testSupport/simulator/utils/bigint'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { GENESIS_REPUTATION_TOKEN, WETH_ADDRESS } from '../testSupport/simulator/utils/constants'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import {
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed,
	statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedDeploymentWorker as feedWorkerArtifact,
	statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedFactory as configArtifact,
} from '../types/contractArtifact'
import { useSecurityPoolFixture } from './statoblast/securityPoolFixture'
import {
	DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
	ORACLE_DISPUTE_DELAY,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	ORACLE_MULTIPLIER,
	ORACLE_PROTOCOL_FEE,
	ORACLE_SETTLEMENT_TIME,
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
type OracleCoordinatorConstructorArgs = [Address, Address, Address, bigint, bigint, number, number, number, number, number, Address, bigint, bigint, bigint]

describe('Security pool oracle configuration guards', () => {
	const fixture = useSecurityPoolFixture()
	const getOracleCoordinatorConstructorArgs = (): OracleCoordinatorConstructorArgs => [
		getInfraContractAddresses().openOracle,
		addressString(GENESIS_REPUTATION_TOKEN),
		WETH_ADDRESS,
		DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS,
		ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
		ORACLE_SETTLEMENT_TIME,
		ORACLE_DISPUTE_DELAY,
		ORACLE_PROTOCOL_FEE,
		ORACLE_FEE_PERCENTAGE,
		ORACLE_MULTIPLIER,
		zeroAddress,
		ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
		ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
		ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	]

	async function encodeOracleCoordinatorDeployData(args: OracleCoordinatorConstructorArgs) {
		const infrastructure = getInfraContractAddresses()
		const configuration = await deployContract(
			fixture.owner(),
			encodeDeployData({
				abi: configArtifact.abi,
				bytecode: `0x${configArtifact.evm.bytecode.object}`,
				args: [args[2], args[4], args[5], args[6], args[7], args[8], args[9], args[10], args[11], args[12], args[13], infrastructure.sharedPoolPriceFeedDeploymentWorker],
			}),
		)
		return encodeDeployData({ abi: feedArtifact.abi, bytecode: `0x${feedArtifact.evm.bytecode.object}`, args: [configuration, args[0], args[3], infrastructure.securityPoolFactory, fixture.securityPool] })
	}

	test('coordinator constructor rejects a priority fee that would exhaust OpenOracle report limits', async () => {
		const client = fixture.owner()
		const maximumArgs = getOracleCoordinatorConstructorArgs()
		maximumArgs[3] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS
		const maximumCoordinator = await deployContract(client, await encodeOracleCoordinatorDeployData(maximumArgs))
		assert.strictEqual(await client.readContract({ abi: statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, address: maximumCoordinator, functionName: 'initialReportPriorityFeeAttoEthPerGas' }), MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS)

		const invalidArgs = getOracleCoordinatorConstructorArgs()
		invalidArgs[3] = MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS + 1n
		await assert.rejects(async () => await deployContract(client, await encodeOracleCoordinatorDeployData(invalidArgs)), /initial report priority fee exceeds openoracle limits/i)
	})

	test('coordinator constructor rejects active timing and risk parameters that cannot produce safe reports', async () => {
		const cases: readonly { change: (args: OracleCoordinatorConstructorArgs) => void; message: RegExp }[] = [
			{
				change: args => {
					args[3] = 0n
				},
				message: /initial priority fee zero/i,
			},
			{
				change: args => {
					args[4] = 10_000_000n
				},
				message: /Oracle uncertainty reaches one hundred percent/i,
			},
			{
				change: args => {
					args[4] = 10_000_001n
				},
				message: /Oracle uncertainty reaches one hundred percent/i,
			},
			{
				change: args => {
					args[5] = args[6]
				},
				message: /Settlement time must exceed dispute delay/,
			},
			{
				change: args => {
					args[6] = args[5] + 1
				},
				message: /Settlement time must exceed dispute delay/,
			},
			{
				change: args => {
					args[7] = 490_000
					args[8] = 10_000
				},
				message: /oracle fees must be below/i,
			},
			{
				change: args => {
					args[9] = 99
				},
				message: /dispute multiplier must be at least/i,
			},
			{
				change: args => {
					args[11] = 0n
				},
				message: /escalation multiplier zero/i,
			},
			{
				change: args => {
					args[12] = 9999n
				},
				message: /max settlement base fee multiplier/i,
			},
			{
				change: args => {
					args[13] = 10001n
				},
				message: /minimum liquidation price distance/i,
			},
		]
		for (const entry of cases) {
			const args = getOracleCoordinatorConstructorArgs()
			entry.change(args)
			await assert.rejects(deployContract(fixture.owner(), await encodeOracleCoordinatorDeployData(args)), entry.message)
		}
		const minimumArgs = getOracleCoordinatorConstructorArgs()
		minimumArgs[9] = 100
		const coordinator = await deployContract(fixture.owner(), await encodeOracleCoordinatorDeployData(minimumArgs))
		assert.strictEqual(await fixture.owner().readContract({ abi: statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, address: coordinator, functionName: 'multiplier' }), 100n)
	})

	test('shared feeds retain a positive collateral floor even with zero base fee (#595)', async () => {
		const client = fixture.owner()
		const infrastructure = getInfraContractAddresses()
		const worker = { abi: feedWorkerArtifact.abi, address: infrastructure.sharedPoolPriceFeedDeploymentWorker } as const
		for (const priority of [DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS, MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS]) {
			const args = getOracleCoordinatorConstructorArgs()
			args[3] = priority
			args[4] = 1_000_000n
			const coordinator = await deployContract(client, await encodeOracleCoordinatorDeployData(args))
			const implementation = coordinator
			const cloneRequest = { ...worker, functionName: 'deployClone', args: [implementation, fixture.base.genesisUniverse, addressString(GENESIS_REPUTATION_TOKEN), zeroHash] } as const
			const { result: feed } = await client.simulateContract(cloneRequest)
			await writeContractAndWait(client, () => client.writeContract(cloneRequest))
			for (const baseFee of [0n, 30n * 10n ** 9n]) {
				await fixture.base.mockWindow.request({ method: 'anvil_setNextBlockBaseFeePerGas', params: [`0x${baseFee.toString(16)}`] })
				await fixture.base.mockWindow.request({ method: 'evm_mine', params: [] })
				assert.strictEqual((await client.getBlock()).baseFeePerGas, baseFee)
				const minimum = await client.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumToken1ReportAttoEth' })
				assert.strictEqual(minimum, await client.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'minimumReportCollateral' }))
				assert.strictEqual(await client.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'timeType' }), true)
				assert.strictEqual(await client.readContract({ abi: feedArtifact.abi, address: feed, functionName: 'trackDisputes' }), true)
				assert.ok(minimum > 1n)
				assert.ok(minimum <= (1n << 128n) - 1n)
			}
			await fixture.base.mockWindow.setNextBlockBaseFeePerGasToZero()
		}
	})
})
