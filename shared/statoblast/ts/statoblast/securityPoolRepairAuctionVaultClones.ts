import { concatHex, getAddress, getCreate2Address, isAddress, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

/**
 * Every auction vault is a minimal proxy (EIP-1167) to one shared implementation, followed by the vault's four immutable
 * bindings: controlling owner, initial capital ledger, auction controller and bid identifier. The forwarder only jumps to a
 * fixed offset inside its own 45 bytes, so the trailing bindings never affect it; the implementation reads them from the clone's code.
 */
const FORWARDER_PREFIX = '0x363d3d373d3d3d363d73'
const FORWARDER_SUFFIX = '0x5af43d82803e903d91602b57fd5bf3'
const CREATION_PREFIX = '0x3d61'
const CREATION_SUFFIX = '0x80600b3d3981f3'
const RUNTIME_LENGTH = 45 + 92

export type AuctionVaultBindings = { implementation: Address; owner: Address; capital: Address; auction: Address; bidId: bigint }

function address(value: Address, label: string): Hex {
	if (!isAddress(value)) throw new Error(`${label} must be an address.`)
	return `0x${getAddress(value).slice(2).toLowerCase()}`
}
function word(value: bigint, label: string) {
	if (typeof value !== 'bigint' || value < 0n || value >= 1n << 256n) throw new Error(`${label} must fit uint256.`)
	return toHex(value, { size: 32 })
}

/** @public The exact code a vault clone carries; external verifiers and fixtures reproduce it from the bindings. */
export function auctionVaultRuntimeCode(bindings: AuctionVaultBindings): Hex {
	return concatHex([FORWARDER_PREFIX, address(bindings.implementation, 'Vault implementation'), FORWARDER_SUFFIX, address(bindings.owner, 'Vault owner'), address(bindings.capital, 'Vault capital'), address(bindings.auction, 'Vault auction'), word(bindings.bidId, 'Vault bid')])
}
/** @public The CREATE2 init code the auction uses; external tooling derives vault addresses from it. */
export function auctionVaultCreationCode(bindings: AuctionVaultBindings): Hex {
	const runtime = auctionVaultRuntimeCode(bindings)
	return concatHex([CREATION_PREFIX, toHex(RUNTIME_LENGTH, { size: 2 }), CREATION_SUFFIX, runtime])
}
/** The auction creates each clone with CREATE2 and the bid identifier as salt. */
export function predictAuctionVaultAddress(bindings: AuctionVaultBindings): Address {
	return getCreate2Address({ from: getAddress(bindings.auction), salt: word(bindings.bidId, 'Vault bid'), bytecode: auctionVaultCreationCode(bindings) })
}
/** Decode a deployed account's code as a vault clone, or return undefined for any other code. */
export function decodeAuctionVaultBindings(code: Hex | undefined): AuctionVaultBindings | undefined {
	if (code === undefined || code.length !== 2 + RUNTIME_LENGTH * 2) return undefined
	const lower = code.toLowerCase()
	const implementation = `0x${lower.slice(22, 62)}`
	const suffix = `0x${lower.slice(62, 92)}`
	if (!lower.startsWith(FORWARDER_PREFIX) || suffix !== FORWARDER_SUFFIX || !isAddress(implementation)) return undefined
	const owner = `0x${lower.slice(92, 132)}`
	const capital = `0x${lower.slice(132, 172)}`
	const auction = `0x${lower.slice(172, 212)}`
	if (!isAddress(owner) || !isAddress(capital) || !isAddress(auction)) return undefined
	return { implementation: getAddress(implementation), owner: getAddress(owner), capital: getAddress(capital), auction: getAddress(auction), bidId: BigInt(`0x${lower.slice(212, 276)}`) }
}
/** Accept only the exact clone the auction would have created for these bindings. */
export function verifyAuctionVaultCode(code: Hex | undefined, bindings: AuctionVaultBindings, label = 'auction vault') {
	if (code === undefined || code.toLowerCase() !== auctionVaultRuntimeCode(bindings).toLowerCase()) throw new Error(`Unrecognized ${label} runtime code.`)
}
