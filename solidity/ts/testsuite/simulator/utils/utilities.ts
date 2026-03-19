import 'viem/window'
import { encodeAbiParameters, keccak256 } from 'viem'
import { ReadClient, WriteClient } from './viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS, TEST_ADDRESSES } from './constants'
import { addressString } from './bigint'
import { Address } from 'viem'
import { ABIS } from '../../../abi/abis'
import { AnvilWindowEthereum } from '../AnvilWindowEthereum'
import { QuestionOutcome } from '../types/types'
import { ReputationToken_ReputationToken, peripherals_WETH9_WETH9 } from '../../../types/contractArtifact'
const TOKEN_AMOUNT_TO_MINT = 100000000n * 10n ** 18n

function hexToBytes(value: string) {
	const result = new Uint8Array((value.length - 2) / 2)
	for (let i = 0; i < result.length; ++i) {
		result[i] = Number.parseInt(value.slice(i * 2 + 2, i * 2 + 4), 16)
	}
	return result
}

const mintETH = async (AnvilWindowEthereum: AnvilWindowEthereum, mintAmounts: { address: Address; amount: bigint }[]) => {
	const stateOverrides = mintAmounts.reduce(
		(acc, current) => {
			acc[current.address] = { balance: current.amount }
			return acc
		},
		{} as { [key: string]: { [key: string]: bigint } },
	)
	await AnvilWindowEthereum.addStateOverrides(stateOverrides)
}

const mintERC20 = async (AnvilWindowEthereum: AnvilWindowEthereum, erc20Address: Address, mintAmounts: { address: Address; amount: bigint }[], balanceSlot: bigint = 2n) => {
	const overrides = mintAmounts.map(mintAmount => {
		const encodedKeySlotHash = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [mintAmount.address, balanceSlot]))
		return { key: encodedKeySlotHash, value: mintAmount.amount }
	})
	const stateSets = overrides.reduce(
		(acc, current) => {
			acc[current.key] = current.value
			return acc
		},
		{} as { [key: string]: bigint },
	)
	await AnvilWindowEthereum.addStateOverrides({ [erc20Address]: { stateDiff: stateSets } })
}

export const approveToken = async (client: WriteClient, tokenAddress: Address, spenderAddress: Address) => {
	const amount = 1000000000000000000000000000000n
	return await client.writeContract({
		abi: ABIS.mainnet.erc20,
		functionName: 'approve',
		address: tokenAddress,
		args: [spenderAddress, amount],
	})
}

export const getERC20Balance = async (client: ReadClient, tokenAddress: Address, ownerAddress: Address) => await client.readContract({
	abi: ABIS.mainnet.erc20,
	functionName: 'balanceOf',
	address: tokenAddress,
	args: [ownerAddress],
})

export const getETHBalance = async (client: ReadClient, address: Address) => await client.getBalance({ address })

export const setupTestAccounts = async (AnvilWindowEthereum: AnvilWindowEthereum) => {
	// Impersonate test accounts so they can send transactions without private keys
	for (const address of TEST_ADDRESSES) {
		await AnvilWindowEthereum.impersonateAccount(addressString(address))
	}

	const accountValues = TEST_ADDRESSES.map(address => ({ address: addressString(address), amount: TOKEN_AMOUNT_TO_MINT }))
	await mintETH(AnvilWindowEthereum, accountValues)
	// For OpenZeppelin ERC20, _balances mapping is at slot 0 (first state variable)
	await mintERC20(AnvilWindowEthereum, addressString(GENESIS_REPUTATION_TOKEN), accountValues, 0n)

	// Deploy the ReputationToken contract at the genesis address
	const bytecodeHex = ReputationToken_ReputationToken.evm.deployedBytecode.object
	const bytes = hexToBytes(bytecodeHex.startsWith('0x') ? bytecodeHex : `0x${ bytecodeHex }`)
	if (!bytes) throw new Error('Failed to convert bytecode to bytes')
	await AnvilWindowEthereum.addStateOverrides({
		[addressString(GENESIS_REPUTATION_TOKEN)]: {
			code: bytes,
		},
	})

	// Deploy the ProxyDeployer contract at its known address to avoid raw transaction
	const proxyDeployerBytecode = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3'
	await AnvilWindowEthereum.addStateOverrides({
		[addressString(PROXY_DEPLOYER_ADDRESS)]: {
			code: hexToBytes(proxyDeployerBytecode),
		},
	})

	// Set total theoretical supply for REP token.
	// In the storage layout of ReputationToken (which inherits from ERC20), the variable
	// `totalTheoreticalSupply` is at slot 5 (after _balances slot0, _allowances slot1, _totalSupply slot2, _name slot3, _symbol slot4).
	const totalTheoreticalSupply = BigInt(TEST_ADDRESSES.length) * TOKEN_AMOUNT_TO_MINT
	const slot5 = `0x${ 5n.toString(16).padStart(64, '0') }`
	await AnvilWindowEthereum.addStateOverrides({
		[addressString(GENESIS_REPUTATION_TOKEN)]: {
			stateDiff: {
				[slot5]: totalTheoreticalSupply,
			},
		},
	})

	// Deploy WETH9 at its expected address
	const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
	const wethBytecodeHex = peripherals_WETH9_WETH9.evm.deployedBytecode.object
	const wethBytes = hexToBytes(wethBytecodeHex.startsWith('0x') ? wethBytecodeHex : `0x${ wethBytecodeHex }`)
	if (!wethBytes) throw new Error('Failed to convert WETH bytecode to bytes')
	await AnvilWindowEthereum.addStateOverrides({
		[wethAddress]: {
			code: wethBytes,
		},
	})
}

export async function ensureProxyDeployerDeployed(client: WriteClient): Promise<void> {
	const deployerBytecode = await client.getCode({ address: addressString(PROXY_DEPLOYER_ADDRESS) })
	if (deployerBytecode === '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3') return
	const ethSendHash = await client.sendTransaction({ to: '0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1', amount: 10000000000000000n })
	await client.waitForTransactionReceipt({ hash: ethSendHash })
	const deployHash = await client.sendRawTransaction({ serializedTransaction: '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' })
	await client.waitForTransactionReceipt({ hash: deployHash })
}

export const contractExists = async (client: ReadClient, contract: `0x${ string }`) => (await client.getCode({ address: contract })) !== undefined

const uint248BitMask = (1n << 248n) - 1n
export function getChildUniverseId(parentUniverseId: bigint, outcome: bigint | QuestionOutcome): bigint {
	return BigInt(keccak256(encodeAbiParameters([{ type: 'uint248' }, { type: 'uint8' }], [parentUniverseId, Number(outcome)]))) & uint248BitMask
}
