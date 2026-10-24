import { isAddress, parseAbi, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'

const abi = parseAbi(['function portfolioCustody() view returns (address)', 'function linearFeeRateAttoEthPerSecond() view returns (uint96)', 'function linearFeeEndTime() view returns (uint48)'])

export function linearFeeReadContracts(address: Address) {
	return [
		{ abi, address, functionName: 'portfolioCustody' },
		{ abi, address, functionName: 'linearFeeRateAttoEthPerSecond' },
		{ abi, address, functionName: 'linearFeeEndTime' },
	] as const
}

export function decodeLinearFeeState(custody: unknown, rateAttoEthPerSecond: unknown, endTime: unknown): LinearFeeState | undefined {
	if (
		typeof custody !== 'string' ||
		!isAddress(custody) ||
		typeof rateAttoEthPerSecond !== 'bigint' ||
		rateAttoEthPerSecond < 0n ||
		rateAttoEthPerSecond >= 1n << 96n ||
		(typeof endTime !== 'bigint' && typeof endTime !== 'number') ||
		(typeof endTime === 'number' && !Number.isSafeInteger(endTime)) ||
		BigInt(endTime) < 0n ||
		BigInt(endTime) >= 1n << 48n
	)
		throw new Error('Invalid portfolio fee stream metadata.')
	return custody === zeroAddress ? undefined : { rateAttoEthPerSecond, endTime: BigInt(endTime) }
}

export async function loadLinearFeeState(client: Pick<ReadClient, 'readContract'>, pool: Address, blockNumber: bigint) {
	const [custody, rate, end] = await Promise.all([
		client.readContract({ abi, address: pool, blockNumber, functionName: 'portfolioCustody' }),
		client.readContract({ abi, address: pool, blockNumber, functionName: 'linearFeeRateAttoEthPerSecond' }),
		client.readContract({ abi, address: pool, blockNumber, functionName: 'linearFeeEndTime' }),
	])
	return decodeLinearFeeState(custody, rate, end)
}
