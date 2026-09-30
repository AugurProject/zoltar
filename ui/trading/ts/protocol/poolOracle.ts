import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { loadOracleManagerDetails } from '@zoltar/ui-statoblast-shared/protocol/oracleCoordinator.js'

export async function loadTradingPoolOracle(pool: Address) {
	const client = createConnectedReadClient()
	const managerAddress = getAddress(await client.readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer' }))
	const details = await loadOracleManagerDetails(client, managerAddress)
	return { managerAddress, details }
}
