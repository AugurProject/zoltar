import { type Address, getAddress } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges } from '@zoltar/bot-shared/monitoring/block-sync'

type VaultChangeLog = Readonly<{ args?: unknown }>

export type VaultChangeSource = (range: Readonly<{ fromBlock: bigint; toBlock: bigint }>) => Promise<readonly VaultChangeLog[]>

export async function loadChangedVaultAddresses(fromBlock: bigint, toBlock: bigint, sources: readonly VaultChangeSource[], globalDisputeStakeSources: readonly VaultChangeSource[] = [], disputeStakedVaults: readonly Address[] = []) {
	const [logsBySource, globalLogsBySource] = await Promise.all([
		Promise.all(sources.map(async source => await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, MAXIMUM_VAULT_CHANGE_LOG_RANGE, source))),
		Promise.all(globalDisputeStakeSources.map(async source => await fetchLogsWithAdaptiveRanges({ nextBlock: fromBlock }, toBlock, MAXIMUM_VAULT_CHANGE_LOG_RANGE, source))),
	])
	const addresses = new Map<string, Address>()
	for (const log of logsBySource.flat()) {
		if (typeof log.args !== 'object' || log.args === null) throw new Error('Vault change event is missing its arguments')
		const vault = Reflect.get(log.args, 'vault')
		if (typeof vault !== 'string') throw new Error('Vault change event is missing its vault address')
		const address = getAddress(vault)
		addresses.set(address.toLowerCase(), address)
	}
	if (globalLogsBySource.some(logs => logs.length > 0)) {
		for (const vault of disputeStakedVaults) addresses.set(vault.toLowerCase(), vault)
	}
	return [...addresses.values()]
}

const MAXIMUM_VAULT_CHANGE_LOG_RANGE = 10_000n
