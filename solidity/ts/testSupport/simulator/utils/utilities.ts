import { encodeAbiParameters, encodeDeployData, getAddress, keccak256, toHex } from '@zoltar/core-shared/evm/ethereum'
import { createWriteClient, type ReadClient, type WriteClient, writeContractAndWait } from './clients'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS, TEST_ADDRESSES } from './constants'
import { addressString } from './bigint'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../storage'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ABIS } from '../../../abi/abis'
import type { AnvilWindowEthereum } from '../AnvilWindowEthereum'
import type { QuestionOutcome } from '../types/types'
import { GenesisReputationToken_GenesisReputationToken, statoblast_WETH9_WETH9 } from '../../../types/contractArtifact'
export { sortStringArrayByKeccak } from '@zoltar/core-shared/serialization/sortStringArrayByKeccak'
import { PROXY_DEPLOYER_RUNTIME_CODE } from '@zoltar/core-shared/deployment/deploymentAddresses'
const TOTAL_REP_SUPPLY_ATTO_REP = 11_000_000n * 10n ** 18n
const ETH_AMOUNT_TO_MINT = 10n ** 30n
const DEFAULT_APPROVAL_AMOUNT = (1n << 256n) - 1n

function hexToBytes(value: string) {
	const result = new Uint8Array((value.length - 2) / 2)
	for (let i = 0; i < result.length; ++i) {
		result[i] = Number.parseInt(value.slice(i * 2 + 2, i * 2 + 4), 16)
	}
	return result
}

function shortStringStorageValue(value: string) {
	const valueHex = toHex(value).slice(2)
	const byteLength = valueHex.length / 2
	if (byteLength > 31) throw new Error('Token metadata exceeds Solidity short-string storage')
	return BigInt(`0x${valueHex.padEnd(62, '0')}${(byteLength * 2).toString(16).padStart(2, '0')}`)
}

export function requireArray(value: unknown, context: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`${context} must be an array`)
	return value
}

export function requireBigInt(value: unknown, context: string): bigint {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value)
	throw new Error(`${context} must be an integer`)
}

export function requireBoolean(value: unknown, context: string): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'bigint') return value !== 0n
	if (typeof value === 'number') return value !== 0
	throw new Error(`${context} must be a boolean`)
}

export function requireAddress(value: unknown, context: string): Address {
	if (typeof value !== 'string') throw new Error(`${context} must be an address`)
	return getAddress(value)
}

const mintETH = async (anvilWindowEthereum: AnvilWindowEthereum, mintAmounts: { address: Address; amount: bigint }[]) => {
	const stateOverrides: Record<string, { balance: bigint }> = {}
	for (const current of mintAmounts) {
		stateOverrides[current.address] = { balance: current.amount }
	}
	await anvilWindowEthereum.addStateOverrides(stateOverrides)
}

const mintERC20 = async (anvilWindowEthereum: AnvilWindowEthereum, erc20Address: Address, mintAmounts: { address: Address; amount: bigint }[], balanceSlot: bigint = 2n) => {
	const overrides = mintAmounts.map(mintAmount => {
		const encodedKeySlotHash = formatStorageSlot(getAddressMappingStorageSlot(mintAmount.address, balanceSlot))
		return { key: encodedKeySlotHash, value: mintAmount.amount }
	})
	const stateSets: Record<string, bigint> = {}
	for (const current of overrides) {
		stateSets[current.key] = current.value
	}
	await anvilWindowEthereum.addStateOverrides({ [erc20Address]: { stateDiff: stateSets } })
}

export const approveToken = async (client: WriteClient, tokenAddress: Address, spenderAddress: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ABIS.mainnet.erc20,
			functionName: 'approve',
			address: tokenAddress,
			args: [spenderAddress, DEFAULT_APPROVAL_AMOUNT],
		}),
	)

export const getERC20Balance = async (client: ReadClient, tokenAddress: Address, ownerAddress: Address): Promise<bigint> =>
	requireBigInt(
		await client.readContract({
			abi: ABIS.mainnet.erc20,
			functionName: 'balanceOf',
			address: tokenAddress,
			args: [ownerAddress],
		}),
		'ERC20 balance',
	)

export const getETHBalance = async (client: ReadClient, address: Address): Promise<bigint> => requireBigInt(await client.getBalance({ address }), 'ETH balance')

/** Changes the isolated genesis fixture's immutable supply without changing ERC-20 balances. */
export async function overrideGenesisTheoreticalSupply(mockWindow: AnvilWindowEthereum, client: ReadClient, token: Address, supply: bigint) {
	const code = await client.getCode({ address: token })
	if (code === undefined || code === '0x') throw new Error('Genesis fixture code is missing')
	const references = Object.values(GenesisReputationToken_GenesisReputationToken.evm.deployedBytecode.immutableReferences)
	if (references.length !== 1) throw new Error('Unexpected genesis fixture immutable layout')
	const runtime = hexToBytes(code)
	const value = hexToBytes(toHex(supply, { size: 32 }))
	for (const reference of references.flat()) {
		if (reference.length !== value.length) throw new Error('Unexpected genesis supply immutable size')
		runtime.set(value, reference.start)
	}
	await mockWindow.addStateOverrides({ [token]: { code: runtime } })
}

export const setupTestAccounts = async (anvilWindowEthereum: AnvilWindowEthereum) => {
	// Impersonate test accounts so they can send transactions without private keys
	for (const address of TEST_ADDRESSES) {
		await anvilWindowEthereum.impersonateAccount(addressString(address))
	}

	const ethValues = TEST_ADDRESSES.map(address => ({ address: addressString(address), amount: ETH_AMOUNT_TO_MINT }))
	const baseTokenAmount = TOTAL_REP_SUPPLY_ATTO_REP / BigInt(TEST_ADDRESSES.length)
	const tokenRemainder = TOTAL_REP_SUPPLY_ATTO_REP - baseTokenAmount * BigInt(TEST_ADDRESSES.length)
	const tokenValues = TEST_ADDRESSES.map((address, index) => ({ address: addressString(address), amount: baseTokenAmount + (index === 0 ? tokenRemainder : 0n) }))
	const seededTotalRep = tokenValues.reduce((total, allocation) => total + allocation.amount, 0n)
	if (seededTotalRep !== TOTAL_REP_SUPPLY_ATTO_REP) throw new Error('Seeded REP balances must equal the configured total supply')
	await mintETH(anvilWindowEthereum, ethValues)
	// For OpenZeppelin ERC20, _balances mapping is at slot 0 (first state variable)
	await mintERC20(anvilWindowEthereum, addressString(GENESIS_REPUTATION_TOKEN), tokenValues, 0n)

	// Run the approval-only genesis token constructor to bake its immutable supply into the runtime.
	// A dedicated deployer leaves the test accounts' nonces and ETH balances unchanged.
	const genesisDeployer = 0xfeedn
	const genesisDeployerAddress = addressString(genesisDeployer)
	await anvilWindowEthereum.impersonateAccount(genesisDeployerAddress)
	await mintETH(anvilWindowEthereum, [{ address: genesisDeployerAddress, amount: ETH_AMOUNT_TO_MINT }])
	const deploymentClient = createWriteClient(anvilWindowEthereum, genesisDeployer)
	const hash = await deploymentClient.sendTransaction({
		data: encodeDeployData({
			abi: GenesisReputationToken_GenesisReputationToken.abi,
			bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
			args: [tokenValues.map(value => value.address), tokenValues.map(value => value.amount)],
		}),
	})
	const receipt = await deploymentClient.waitForTransactionReceipt({ hash })
	if (receipt.contractAddress === undefined || receipt.contractAddress === null) throw new Error('Genesis REP fixture deployment failed')
	const runtime = await deploymentClient.getCode({ address: receipt.contractAddress })
	if (runtime === undefined || runtime === '0x') throw new Error('Genesis REP fixture runtime is missing')
	await anvilWindowEthereum.addStateOverrides({
		[addressString(GENESIS_REPUTATION_TOKEN)]: {
			code: hexToBytes(runtime),
			stateDiff: {
				[formatStorageSlot(2n)]: TOTAL_REP_SUPPLY_ATTO_REP,
				[formatStorageSlot(3n)]: shortStringStorageValue('Reputation'),
				[formatStorageSlot(4n)]: shortStringStorageValue('REP'),
			},
		},
	})

	// Deploy the ProxyDeployer contract at its known address to avoid raw transaction
	const proxyDeployerBytecode = PROXY_DEPLOYER_RUNTIME_CODE
	await anvilWindowEthereum.addStateOverrides({
		[addressString(PROXY_DEPLOYER_ADDRESS)]: {
			code: hexToBytes(proxyDeployerBytecode),
		},
	})

	// Deploy WETH9 at its expected address
	const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
	const wethBytecodeHex = statoblast_WETH9_WETH9.evm.deployedBytecode.object
	const wethBytes = hexToBytes(wethBytecodeHex.startsWith('0x') ? wethBytecodeHex : `0x${wethBytecodeHex}`)
	if (!wethBytes) throw new Error('Failed to convert WETH bytecode to bytes')
	await anvilWindowEthereum.addStateOverrides({
		[wethAddress]: {
			code: wethBytes,
			stateDiff: {
				[formatStorageSlot(0n)]: shortStringStorageValue('Wrapped Ether'),
				[formatStorageSlot(1n)]: shortStringStorageValue('WETH'),
				[formatStorageSlot(2n)]: 18n,
			},
		},
	})
}

export async function ensureProxyDeployerDeployed(client: WriteClient): Promise<void> {
	const deployerBytecode = await client.getCode({ address: addressString(PROXY_DEPLOYER_ADDRESS) })
	if (deployerBytecode === PROXY_DEPLOYER_RUNTIME_CODE) return
	const ethSendHash = await client.sendTransaction({ to: '0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1', amount: 10000000000000000n })
	await client.waitForTransactionReceipt({ hash: ethSendHash })
	const deployHash = await client.sendRawTransaction({
		serializedTransaction: '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222',
	})
	await client.waitForTransactionReceipt({ hash: deployHash })
}

export const contractExists = async (client: ReadClient, contract: Address) => (await client.getCode({ address: contract })) !== undefined

const uint248BitMask = (1n << 248n) - 1n
export function getChildUniverseId(parentUniverseId: bigint, outcome: bigint | QuestionOutcome): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint256' }], [parentUniverseId, BigInt(outcome)]))) & uint248BitMask
}
