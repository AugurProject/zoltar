import type { Abi, Address, Hash, Hex } from './ethereum.ts'

export type ManifestContract = readonly [address: Address, label: string, kind: string]

export type NetworkConfig = {
	readonly id: string
	readonly name: string
	readonly chainId: number
	readonly rpcUrls: readonly string[]
	readonly startBlock: bigint
	readonly explorerBaseUrl: string
	readonly nativeSymbol: string
	readonly confirmationDepth: bigint
	readonly contracts: readonly ManifestContract[]
}

export type ContractMetadata = {
	readonly address: Address
	readonly label: string
	readonly kind: string
	readonly provenance: string
	readonly discoveryBlock?: bigint
	readonly discoveryTxHash?: Hash
}

export type TokenMetadata = {
	readonly address: Address
	readonly name?: string
	readonly symbol?: string
	readonly decimals?: number
	readonly readError?: string
	readonly readBlock: bigint
}

export type AbiCatalogEntry = {
	readonly source: string
	readonly abi: Abi
}

export type SerializedArguments = Record<string, unknown>

type ArgumentSchema = {
	readonly index: number
	readonly name: string
	readonly type: string
	readonly indexed?: boolean
}

export type DecodedRecord = {
	readonly name?: string
	readonly signature?: string
	readonly arguments?: SerializedArguments
	readonly displayArguments?: SerializedArguments
	readonly argumentSchema?: readonly ArgumentSchema[]
	readonly referencedAddresses?: readonly Address[]
	readonly status: 'decoded' | 'unknown' | 'failed'
	readonly error?: string
	readonly summary: string
}

export type StoredLog = {
	readonly transactionHash: Hash
	readonly blockHash: Hash
	readonly blockNumber: bigint
	readonly transactionIndex: number
	readonly logIndex: number
	readonly address: Address
	readonly topics: readonly Hex[]
	readonly data: Hex
	readonly decoded: DecodedRecord
}
