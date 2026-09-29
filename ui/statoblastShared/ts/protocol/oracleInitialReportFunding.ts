import { calculateOracleMinimumWethReportAttoEth } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'

export async function readCoordinatorMinimumReport(client: Pick<ReadClient, 'getBlock' | 'readContract'>, managerAddress: Address) {
	const block = await client.getBlock()
	if (block.baseFeePerGas === undefined || block.number === undefined) throw new Error('The current block fee is unavailable. Retry the oracle quote.')
	const parameters = { address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, blockNumber: block.number }
	const [gasUnitsForOneDispute, initialReportPriorityFeeAttoEthPerGas, targetPriceErrorForDispute, openOracleSecurityMultiplierBps, protocolFee, feePercentage, securityPool] = await Promise.all([
		client.readContract({ ...parameters, functionName: 'gasUnitsForOneDispute' }),
		client.readContract({ ...parameters, functionName: 'initialReportPriorityFeeAttoEthPerGas' }),
		client.readContract({ ...parameters, functionName: 'targetPriceErrorForDispute' }),
		client.readContract({ ...parameters, functionName: 'openOracleSecurityMultiplierBps' }),
		client.readContract({ ...parameters, functionName: 'protocolFee' }),
		client.readContract({ ...parameters, functionName: 'feePercentage' }),
		client.readContract({ ...parameters, functionName: 'securityPool' }),
	])
	const openInterestAttoEth = securityPool === zeroAddress ? 0n : await client.readContract({ address: securityPool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'settlementCollateralAttoEth', blockNumber: block.number })
	// Fee-free eth_call can zero BASEFEE, while fee-bearing reads can require a
	// funded caller. Use the shared contract math with the pinned block header.
	return calculateOracleMinimumWethReportAttoEth({
		baseFeeAttoEthPerGas: block.baseFeePerGas,
		gasUnitsForOneDispute,
		initialReportPriorityFeeAttoEthPerGas,
		openInterestAttoEth,
		openOracleSecurityMultiplierBps,
		targetPriceErrorForDispute,
		openOracleProtocolFee: Number(protocolFee),
		openOracleReporterFee: Number(feePercentage),
	})
}
