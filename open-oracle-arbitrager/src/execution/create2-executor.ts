import { concatHex, createPublicClient, createWalletClient, getCreate2Address, http, keccak256, privateKeyToAccount, type Address, type Chain, type Hash, type Hex } from '#ethereum'
import { executorArtifact } from '#contracts/artifacts.generated'

export const deterministicDeploymentProxy = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address
export const deterministicDeploymentProxyCode = '0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3' as Hex

export type ExecutorDeploymentPlan = {
	address: Address
	bytecode: Hex
	calldata: Hex
	salt: Hex
}

export function executorDeploymentPlan(saltValue: unknown): ExecutorDeploymentPlan {
	if (typeof saltValue !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(saltValue)) throw new Error('CREATE2 salt must be a 32-byte 0x-prefixed value')
	const salt = saltValue as Hex
	const bytecode = `0x${executorArtifact.evm.bytecode.object}` as Hex
	return {
		address: getCreate2Address({ bytecode, from: deterministicDeploymentProxy, salt }),
		bytecode,
		calldata: concatHex([salt, bytecode]),
		salt,
	}
}

export async function deployExecutorCreate2(parameters: { chain: Chain; privateKey: Hex; rpcUrl: string; salt: unknown }) {
	const plan = executorDeploymentPlan(parameters.salt)
	const publicClient = createPublicClient({ chain: parameters.chain, transport: http(parameters.rpcUrl) })
	const chainId = await publicClient.getChainId()
	if (chainId !== parameters.chain.id) throw new Error(`RPC chain mismatch: expected ${parameters.chain.id.toString()}, received ${chainId.toString()}`)
	const proxyCode = await publicClient.getCode({ address: deterministicDeploymentProxy })
	if (proxyCode?.toLowerCase() !== deterministicDeploymentProxyCode.toLowerCase()) throw new Error('Canonical CREATE2 deployment proxy is missing or has unexpected bytecode')
	const expectedRuntimeCodeHash = keccak256(`0x${executorArtifact.evm.deployedBytecode.object}`)
	const existingCode = await publicClient.getCode({ address: plan.address })
	if (existingCode !== undefined && existingCode !== '0x') {
		if (keccak256(existingCode).toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) throw new Error(`Predicted executor address ${plan.address} already contains different bytecode`)
		return { address: plan.address, alreadyDeployed: true, transactionHash: undefined }
	}
	const account = privateKeyToAccount(parameters.privateKey)
	const wallet = createWalletClient({ account, chain: parameters.chain, transport: http(parameters.rpcUrl) })
	const transactionHash = await wallet.sendTransaction({ data: plan.calldata, to: deterministicDeploymentProxy })
	const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
	if (receipt.status !== 'success') throw new Error(`CREATE2 executor deployment reverted: ${receipt.transactionHash}`)
	const deployedCode = await publicClient.getCode({ address: plan.address })
	if (deployedCode === undefined || deployedCode === '0x' || keccak256(deployedCode).toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) {
		throw new Error('CREATE2 deployment did not produce the expected executor runtime bytecode')
	}
	return { address: plan.address, alreadyDeployed: false, transactionHash: transactionHash as Hash }
}
