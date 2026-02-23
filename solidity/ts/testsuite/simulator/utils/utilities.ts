import 'viem/window'
import { encodeAbiParameters, keccak256 } from 'viem'
import { ReadClient, WriteClient } from './viem.js'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS, TEST_ADDRESSES } from './constants.js'
import { addressString } from './bigint.js'
import { Address } from 'viem'
import { ABIS } from '../../../abi/abis.js'
import { MockWindowEthereum } from '../MockWindowEthereum.js'
import { QuestionOutcome } from '../types/types.js'
import { mainnet } from 'viem/chains'

export const TOKEN_AMOUNT_TO_MINT = 100000000n * 10n ** 18n

export async function sleep(milliseconds: number) {
	await new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function jsonStringify(value: unknown, space?: string | number | undefined): string {
    return JSON.stringify(value, (_, value) => {
		if (typeof value === 'bigint') return `0x${value.toString(16)}n`
		if (value instanceof Uint8Array) return `b'${Array.from(value).map(x => x.toString(16).padStart(2, '0')).join('')}'`
		// cast works around https://github.com/uhyo/better-typescript-lib/issues/36
		return value as JSONValueF<unknown>
    }, space)
}

export function jsonParse(text: string): unknown {
	return JSON.parse(text, (_key: string, value: unknown) => {
		if (typeof value !== 'string') return value
		if (/^0x[a-fA-F0-9]+n$/.test(value)) return BigInt(value.slice(0, -1))
		const bytesMatch = /^b'(:<hex>[a-fA-F0-9])+'$/.exec(value)
		if (bytesMatch && 'groups' in bytesMatch && bytesMatch.groups && 'hex' in bytesMatch.groups && bytesMatch.groups['hex'].length % 2 === 0) return hexToBytes(`0x${bytesMatch.groups['hex']}`)
		return value
	})
}

export function ensureError(caught: unknown) {
	return (caught instanceof Error) ? caught
		: typeof caught === 'string' ? new Error(caught)
		: typeof caught === 'object' && caught !== null && 'message' in caught && typeof caught.message === 'string' ? new Error(caught.message)
		: new Error(`Unknown error occurred.\n${jsonStringify(caught)}`)
}

function hexToBytes(value: string) {
	const result = new Uint8Array((value.length - 2) / 2)
	for (let i = 0; i < result.length; ++i) {
		result[i] = Number.parseInt(value.slice(i * 2 + 2, i * 2 + 4), 16)
	}
	return result
}

export function dataString(data: Uint8Array | null) {
	if (data === null) return ''
	return Array.from(data).map(x => x.toString(16).padStart(2, '0')).join('')
}

export function dataStringWith0xStart(data: Uint8Array | null): `0x${ string }` {
	if (data === null) return '0x'
	return `0x${ dataString(data) }`
}

export function decodeEthereumNameServiceString(ens: string): string {
	const parts = ens.split('.')
	const encodedData: string[] = []
	encodedData.push('0x')

	function stringToHex(str: string): string {
		return Array.from(str).map((char) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')
	}
	parts.forEach((part) => {
		const encodedPart = stringToHex(part)
		const byteCount = (encodedPart.length / 2).toString(16).padStart(2, '0')
		encodedData.push(byteCount + encodedPart)
	})

	encodedData.push('00')
	return encodedData.join('')
}

export function assertNever(value: never): never {
	throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`)
}

export function isSameAddress(address1: `0x${ string }` | undefined, address2: `0x${ string }` | undefined) {
	if (address1 === undefined && address2 === undefined) return true
	if (address1 === undefined || address2 === undefined) return false
	return address1.toLowerCase() === address2.toLowerCase()
}

export const splitEnsStringToSubdomainPath = (input: string): string[] => {
	const parts = input.split('.')
	const result: string[] = []

	for (let i = 0; i < parts.length; i++) {
		const joined = parts.slice(i).join('.')
		result.push(joined)
	}
	result.pop() // eth element
	return result.reverse()
}

export const splitDomainToSubDomainAndParent = (domain: string): [string, string] => {
	const index = domain.indexOf('.')
	if (index === -1) throw new Error('not proper domain')
	return [domain.slice(0, index), domain.slice(index + 1)]
}

export function bigIntToNumber(value: bigint): number {
	if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
		return Number(value)
	}
	throw new Error(`Value: "${ value }" is out of bounds to be a Number.`)
}

export const requestAccounts = async () => {
	if (window.ethereum === undefined) throw new Error('no window.ethereum injected')
	const reply = await window.ethereum.request({ method: 'eth_requestAccounts', params: undefined })
	return reply[0]
}

export const getAccounts = async () => {
	if (window.ethereum === undefined) throw new Error('no window.ethereum injected')
	const reply = await window.ethereum.request({ method: 'eth_accounts', params: undefined })
	return reply[0]
}

export const mintETH = async (mockWindowEthereum: MockWindowEthereum, mintAmounts: { address: Address, amount: bigint }[]) => {
	const stateOverrides = mintAmounts.reduce((acc, current) => {
		acc[current.address] = { balance: current.amount }
		return acc
	}, {} as { [key: string]: {[key: string]: bigint }} )
	await mockWindowEthereum.addStateOverrides(stateOverrides)
}

export const mintERC20 = async (mockWindowEthereum: MockWindowEthereum, erc20Address: Address, mintAmounts: { address: Address, amount: bigint }[], balanceSlot: bigint = 2n) => {
	const overrides = mintAmounts.map((mintAmount) => {
		const encodedKeySlotHash = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [mintAmount.address, balanceSlot]))
		return { key: encodedKeySlotHash, value: mintAmount.amount }
	})
	const stateSets = overrides.reduce((acc, current) => {
		acc[current.key] = current.value
		return acc
	}, {} as { [key: string]: bigint } )
	await mockWindowEthereum.addStateOverrides({ [erc20Address]: { stateDiff: stateSets }})
}

export const approveToken = async (client: WriteClient, tokenAddress: Address, spenderAddress: Address) => {
	const amount = 1000000000000000000000000000000n
	return await client.writeContract({
		chain: mainnet,
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		address: tokenAddress,
		args: [spenderAddress, amount]
	})
}

export const setERC1155Approval = async (client: WriteClient, tokenAddress: Address, operatorAddress: Address, approved: boolean) => {
	return await client.writeContract({
		chain: mainnet,
		abi: ABIS.mainnet.erc1155,
		functionName: 'setApprovalForAll',
		address: tokenAddress,
		args: [operatorAddress, approved]
	})
}

export const getERC20Balance = async (client: ReadClient, tokenAddress: Address, ownerAddress: Address) => {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'balanceOf',
		address: tokenAddress,
		args: [ownerAddress]
	})
}

export const getERC20Supply = async (client: ReadClient, tokenAddress: Address) => {
	return await client.readContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'totalSupply',
		address: tokenAddress,
		args: []
	})
}

export const transferERC20 = async (client: WriteClient, tokenAddress: Address, to: Address, amount: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: ABIS.mainnet.erc20,
		functionName: 'transfer',
		address: tokenAddress,
		args: [to, amount]
	})
}

export const transferERC1155 = async (client: WriteClient, tokenAddress: Address, from: Address, to: Address, id: bigint, amount: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: ABIS.mainnet.erc1155,
		functionName: 'safeTransferFrom',
		address: tokenAddress,
		args: [from, to, id, amount]
	})
}

export const getETHBalance = async (client: ReadClient, address: Address) => {
	return await client.getBalance({address})
}

export const setupTestAccounts = async (mockWindowEthereum: MockWindowEthereum) => {
	const accountValues = TEST_ADDRESSES.map((address) => ({ address: addressString(address), amount: TOKEN_AMOUNT_TO_MINT}))
	await mintETH(mockWindowEthereum, accountValues)
	await mintERC20(mockWindowEthereum, addressString(GENESIS_REPUTATION_TOKEN), accountValues, 1n)
}

export async function ensureProxyDeployerDeployed(client: WriteClient): Promise<void> {
	const deployerBytecode = await client.getCode({ address: addressString(PROXY_DEPLOYER_ADDRESS)})
	if (deployerBytecode === '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3') return
	const ethSendHash = await client.sendTransaction({ to: '0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1', amount: 10000000000000000n, chain: mainnet })
	await client.waitForTransactionReceipt({ hash: ethSendHash })
	const deployHash = await client.sendRawTransaction({ serializedTransaction: '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' })
	await client.waitForTransactionReceipt({ hash: deployHash })
}

export const contractExists = async (client: ReadClient, contract: `0x${ string }`) => await client.getCode({ address: contract }) !== undefined

export const isUnknownAddress = (maybeAddress: unknown): maybeAddress is `0x${ string }` => typeof maybeAddress === 'string' && /^0x[a-fA-F0-9]{40}$/.test(maybeAddress)

const uint248BitMask = (1n << 248n) - 1n
export function getChildUniverseId(parentUniverseId: bigint, outcome: bigint | QuestionOutcome): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint8' }], [parentUniverseId, Number(outcome)]))) & uint248BitMask
}
