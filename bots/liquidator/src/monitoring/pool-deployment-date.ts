import { deploySecurityPoolEvent } from '@zoltar/bot-shared/contracts/abi'
import type { Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from './vault-positions.ts'

export async function loadPoolDeploymentDate(client: ReadClient, factory: Address, pool: Address, snapshotBlock: bigint) {
	const deploymentLogs = (fromBlock: bigint, toBlock: bigint) => client.getLogs({ address: factory, event: deploySecurityPoolEvent, args: { securityPool: pool }, fromBlock, toBlock })
	const logs = await (async () => {
		try {
			return await deploymentLogs(0n, snapshotBlock)
		} catch (error) {
			// Providers with log-range limits can instead query the first block containing this pool's code.
			// Historical-state failures propagate to the catalog's unavailable-date state.
			const code = await client.getCode({ address: pool, blockNumber: snapshotBlock })
			if (code === undefined || code === '0x') throw new Error('Pool code is unavailable at the catalog snapshot', { cause: error })
			let first = 0n
			let last = snapshotBlock
			while (first < last) {
				const middle = (first + last) / 2n
				const historicalCode = await client.getCode({ address: pool, blockNumber: middle })
				if (historicalCode === undefined || historicalCode === '0x') first = middle + 1n
				else last = middle
			}
			return await deploymentLogs(first, first)
		}
	})()
	const log = logs.find(candidate => candidate.blockNumber !== undefined && candidate.blockNumber <= snapshotBlock)
	if (log?.blockNumber === undefined || log.blockHash === undefined) return undefined
	const block = await client.getBlock({ blockNumber: log.blockNumber })
	if (block.hash?.toLowerCase() !== log.blockHash.toLowerCase()) throw new Error('Pool deployment block changed during discovery')
	return block.timestamp.toString()
}
