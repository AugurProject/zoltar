import { createPublicClient, createWalletClient, getAddress, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { GenesisReputationToken_GenesisReputationToken } from '../types/contractArtifact.js'
import { createViemChain, getNetworkConfig, getSupportedNetworkKeys, isMainnetNetworkKey, isSupportedNetworkKey, type SupportedNetworkKey } from '../../../shared/ts/networkConfig.js'

type ParsedArguments = {
	initialSupply: bigint
	networkKey: SupportedNetworkKey
	recipient: `0x${string}`
}

function parseArguments(argv: string[]): ParsedArguments {
	let networkKey: string | undefined
	let recipient: string | undefined
	let initialSupply: string | undefined

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		const next = argv[index + 1]
		if (argument === '--network') {
			networkKey = next
			index += 1
			continue
		}
		if (argument === '--recipient') {
			recipient = next
			index += 1
			continue
		}
		if (argument === '--initial-supply') {
			initialSupply = next
			index += 1
		}
	}

	if (networkKey === undefined || recipient === undefined || initialSupply === undefined) {
		throw new Error(`Usage: bun run solidity/ts/scripts/deployGenesisReputationToken.ts --network <${getSupportedNetworkKeys().join('|')}> --recipient 0x... --initial-supply <uint256>`)
	}
	if (!isSupportedNetworkKey(networkKey)) {
		throw new Error(`Unsupported network: ${networkKey}. Supported networks: ${getSupportedNetworkKeys().join(', ')}`)
	}

	return {
		initialSupply: BigInt(initialSupply),
		networkKey,
		recipient: getAddress(recipient),
	}
}

async function main() {
	const { initialSupply, networkKey, recipient } = parseArguments(process.argv.slice(2))
	if (isMainnetNetworkKey(networkKey)) {
		throw new Error('Ethereum mainnet uses the external REPv2 deployment at 0x221657776846890989a759BA2973e427DfF5C9bB. Do not deploy GenesisReputationToken on mainnet.')
	}

	const privateKey = process.env['PRIVATE_KEY']
	if (privateKey === undefined) {
		throw new Error('Set PRIVATE_KEY to the deployer private key before running this script.')
	}

	const networkConfig = getNetworkConfig(networkKey)
	const chain = createViemChain(networkKey)
	const rpcUrl = process.env['RPC_URL'] ?? networkConfig.defaultRpcUrl
	const account = privateKeyToAccount(privateKey as `0x${string}`)
	const publicClient = createPublicClient({
		chain,
		transport: http(rpcUrl),
	})
	const walletClient = createWalletClient({
		account,
		chain,
		transport: http(rpcUrl),
	})

	const hash = await walletClient.deployContract({
		abi: GenesisReputationToken_GenesisReputationToken.abi,
		args: [recipient, initialSupply],
		bytecode: `0x${GenesisReputationToken_GenesisReputationToken.evm.bytecode.object}`,
	})
	const receipt = await publicClient.waitForTransactionReceipt({ hash })
	if (receipt.contractAddress === undefined) {
		throw new Error('GenesisReputationToken deployment did not return a contract address.')
	}

	console.log(receipt.contractAddress)
}

void main().catch(error => {
	console.error(error instanceof Error ? error.message : String(error))
	process.exitCode = 1
})
