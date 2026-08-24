import type { Address, Hex } from '@zoltar/bot-shared/ethereum'

const VAULT_PAGE_SIZE = 100n

export type VaultStateIndex<Vault extends Readonly<{ address: Address }>> = {
	activeVaultCount: number
	activeVaults: Map<string, Vault>
	blockHash: Hex | undefined
	blockNumber: bigint | undefined
	knownVaultCount: bigint
}

export function createVaultStateIndex<Vault extends Readonly<{ address: Address }>>(): VaultStateIndex<Vault> {
	return {
		activeVaultCount: 0,
		activeVaults: new Map(),
		blockHash: undefined,
		blockNumber: undefined,
		knownVaultCount: 0n,
	}
}

type RefreshVaultStateIndexParameters<Vault extends Readonly<{ address: Address }>> = {
	block: Readonly<{ hash: Hex; number: bigint }>
	hasRep: (vault: Vault) => boolean
	knownVaultCount: bigint
	loadChangedVaultAddresses: (fromBlock: bigint, toBlock: bigint) => Promise<readonly Address[]>
	loadPositions: (vaults: readonly Address[]) => Promise<readonly Vault[]>
	loadRegistryRange: (start: bigint, count: bigint) => Promise<readonly Address[]>
	readCanonicalBlockHash: (blockNumber: bigint) => Promise<Hex | undefined>
}

async function registryAddresses<Vault extends Readonly<{ address: Address }>>(parameters: RefreshVaultStateIndexParameters<Vault>, registryStart: bigint, count: bigint) {
	const addresses: Address[] = []
	for (let offset = 0n; offset < count; offset += VAULT_PAGE_SIZE) {
		const pageCount = count - offset < VAULT_PAGE_SIZE ? count - offset : VAULT_PAGE_SIZE
		const page = await parameters.loadRegistryRange(registryStart + offset, pageCount)
		if (BigInt(page.length) !== pageCount) throw new Error('Security pool returned an incomplete vault registry range')
		addresses.push(...page)
	}
	return addresses
}

async function previousIndexIsCanonical<Vault extends Readonly<{ address: Address }>>(index: VaultStateIndex<Vault>, parameters: RefreshVaultStateIndexParameters<Vault>) {
	if (index.blockNumber === undefined || index.blockHash === undefined) return false
	if (parameters.block.number < index.blockNumber) return false
	if (parameters.block.number === index.blockNumber) return parameters.block.hash.toLowerCase() === index.blockHash.toLowerCase()
	return (await parameters.readCanonicalBlockHash(index.blockNumber))?.toLowerCase() === index.blockHash.toLowerCase()
}

export async function refreshVaultStateIndex<Vault extends Readonly<{ address: Address }>>(index: VaultStateIndex<Vault>, parameters: RefreshVaultStateIndexParameters<Vault>) {
	if (parameters.knownVaultCount < 0n) throw new Error('Security pool returned a negative vault count')
	const canonicalPreviousIndex = await previousIndexIsCanonical(index, parameters)
	const reset = !canonicalPreviousIndex || parameters.knownVaultCount < index.knownVaultCount
	const addresses = new Map<string, Address>()
	if (!reset) {
		for (const vault of index.activeVaults.values()) addresses.set(vault.address.toLowerCase(), vault.address)
	}
	const registryStart = reset ? 0n : index.knownVaultCount
	const registryCount = reset ? parameters.knownVaultCount : parameters.knownVaultCount - registryStart
	for (const address of await registryAddresses(parameters, registryStart, registryCount)) addresses.set(address.toLowerCase(), address)
	if (!reset && index.blockNumber !== undefined && parameters.block.number > index.blockNumber) {
		for (const address of await parameters.loadChangedVaultAddresses(index.blockNumber + 1n, parameters.block.number)) addresses.set(address.toLowerCase(), address)
	}
	const nextActiveVaults = new Map<string, Vault>()
	const refreshAddresses = [...addresses.values()]
	for (let start = 0; start < refreshAddresses.length; start += Number(VAULT_PAGE_SIZE)) {
		const page = refreshAddresses.slice(start, start + Number(VAULT_PAGE_SIZE))
		const positions = await parameters.loadPositions(page)
		const positionsByAddress = new Map(positions.map(position => [position.address.toLowerCase(), position]))
		for (const address of page) {
			const position = positionsByAddress.get(address.toLowerCase())
			if (position === undefined) throw new Error(`Security pool returned no vault state for ${address}`)
			if (parameters.hasRep(position)) nextActiveVaults.set(address.toLowerCase(), position)
		}
	}
	const currentBlockHash = await parameters.readCanonicalBlockHash(parameters.block.number)
	if (currentBlockHash?.toLowerCase() !== parameters.block.hash.toLowerCase()) throw new Error('Security pool vault snapshot changed during refresh')
	index.activeVaults = nextActiveVaults
	index.activeVaultCount = nextActiveVaults.size
	index.blockHash = parameters.block.hash
	index.blockNumber = parameters.block.number
	index.knownVaultCount = parameters.knownVaultCount
	return [...nextActiveVaults.values()]
}
