import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { isObjectRecord } from '@zoltar/core-shared/validation/guards'
import type { ReadClient } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { deployment as copy } from '../../../copy/securityPoolTransactions.js'
import { readDeploymentRecoveryHead } from '../../../protocol/deploymentRecovery.js'

export function isDefiniteDeploymentRejection(error: unknown) {
	const seen = new Set<object>()
	while (isObjectRecord(error) && !seen.has(error)) {
		if (error['code'] === 4001 || error['code'] === '4001') return true
		seen.add(error)
		error = error['cause']
	}
	return false
}

export async function readDeploymentWalletState(client: Pick<ReadClient, 'getBlock' | 'getCode' | 'getTransactionCount'>, address: Address) {
	const code = await client.getCode({ address })
	if (code !== undefined && code !== '0x') throw new Error(copy.walletRecoveryUnsupported)
	const head = await readDeploymentRecoveryHead(client)
	if (head?.number === undefined || head.hash === undefined) return undefined
	const confirmed = await client.getTransactionCount({ address, blockNumber: head.number })
	const pending = await client.getTransactionCount({ address, blockTag: 'pending' })
	if ((await client.getBlock({ blockNumber: head.number }))?.hash !== head.hash) return undefined
	return { confirmed, idle: pending === confirmed }
}
