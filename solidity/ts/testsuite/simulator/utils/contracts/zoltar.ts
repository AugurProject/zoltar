import { mainnet } from "viem/chains"
import { ReputationToken_ReputationToken, Zoltar_Zoltar } from "../../../../types/contractArtifact.js"
import { ReadClient, WriteClient } from "../viem.js"
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from "../constants.js"
import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes } from "viem"
import { addressString, bytes32String } from "../bigint.js"
import { ensureProxyDeployerDeployed } from "../utilities.js"

export function getZoltarAddress() {
	const bytecode: `0x${ string }` = `0x${ Zoltar_Zoltar.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isZoltarDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ Zoltar_Zoltar.evm.deployedBytecode.object }`
	const address = getZoltarAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export const deployZoltarTransaction = () => {
	const bytecode: `0x${ string }` = `0x${ Zoltar_Zoltar.evm.bytecode.object }`
	return { to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const
}

export const ensureZoltarDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isZoltarDeployed(client)) return
	const hash = await client.sendTransaction(deployZoltarTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const getUniverseData = async (client: ReadClient, universeId: bigint) => {
	const universeData = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universes',
		address: getZoltarAddress(),
		args: [universeId]
	})
	const [forkTime, reputationToken, parentUniverseId, forkingOutcomeIndex] = universeData
	return { forkTime, reputationToken, parentUniverseId, forkingOutcomeIndex: BigInt(forkingOutcomeIndex) }
}

export const getUniverseForkData = async (client: ReadClient, universeId: bigint) => {
	const universeForkData = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universeForkData',
		address: getZoltarAddress(),
		args: [universeId]
	})
	const categories = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getForkingQuestionCategories',
		address: getZoltarAddress(),
		args: [universeId]
	})
	const [forkingQuestionExtraInfo, forkedBy, forkerRepDeposit] = universeForkData
	return { forkingQuestionExtraInfo, forkedBy, forkerRepDeposit, categories }
}

export const forkUniverse = async (client: WriteClient, universeId: bigint, extraInfo: string, questionCategories: readonly [string, string, string, string]) => {
	return await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		address: getZoltarAddress(),
		args: [universeId, extraInfo, questionCategories]
	})
}

export const splitRep = async (client: WriteClient, universeId: bigint, outcomeIndexes: bigint[]) => {
	return await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitRep',
		address: getZoltarAddress(),
		args: [universeId, outcomeIndexes.map((index) => Number(index))]
	})
}

export const deployChild = async (client: WriteClient, universeId: bigint, outcomeIndex: bigint) => {
	return await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		address: getZoltarAddress(),
		args: [universeId, Number(outcomeIndex)]
	})
}

export const getOutcomeName = async (client: ReadClient, universeId: bigint) => {
	return await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getOutcomeName',
		address: getZoltarAddress(),
		args: [universeId]
	})
}

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: `0x${ string }`) {
	return await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: []
	})
}

export const forkerClaimRep = async (client: WriteClient, universeId: bigint, outcomeIndices: bigint[]) => {
	return await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkerClaimRep',
		address: getZoltarAddress(),
		args: [universeId, outcomeIndices.map((x) => Number(x))]
	})
}

export function getRepTokenAddress(universeId: bigint): `0x${ string }` {
	if (universeId === 0n) return getAddress(addressString(GENESIS_REPUTATION_TOKEN))
	const initCode = encodeDeployData({
		abi: ReputationToken_ReputationToken.abi,
		bytecode: `0x${ ReputationToken_ReputationToken.evm.bytecode.object }`,
		args: [getZoltarAddress()]
	})
	return getCreate2Address({ from: getZoltarAddress(), salt: bytes32String(universeId), bytecodeHash: keccak256(initCode) })
}

