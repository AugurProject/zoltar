import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { ReadClient, WriteClient } from '../viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes } from 'viem'
import { addressString, bytes32String } from '../bigint'
import { ensureProxyDeployerDeployed } from '../utilities'

export function getZoltarAddress() {
	const bytecode: `0x${ string }` = `0x${ Zoltar_Zoltar.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export function getZoltarQuestionDataAddress(): `0x${ string }` {
	const bytecode: `0x${ string }` = `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isZoltarQuestionDataDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object }`
	const address = getZoltarQuestionDataAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarQuestionDataTransaction = () => {
	const bytecode: `0x${ string }` = `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`
	return { to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const
}

export const ensureZoltarQuestionDataDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isZoltarQuestionDataDeployed(client)) return
	const hash = await client.sendTransaction(deployZoltarQuestionDataTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const isZoltarDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ Zoltar_Zoltar.evm.deployedBytecode.object }`
	const address = getZoltarAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarTransaction = () => {
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
		args: [universeId],
	})
	const [forkTime, reputationToken, parentUniverseId, forkingOutcomeIndex] = universeData
	return { forkTime, reputationToken, parentUniverseId, forkingOutcomeIndex: BigInt(forkingOutcomeIndex) }
}

export const getUniverseForkData = async (client: ReadClient, universeId: bigint) => {
	const universeForkData = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universeForkData',
		address: getZoltarAddress(),
		args: [universeId],
	})
	const [forkedBy, forkerRepDeposit, questionId] = universeForkData
	return { forkedBy, forkerRepDeposit, questionId }
}

export const forkUniverse = async (client: WriteClient, universeId: bigint, questionId: bigint) =>
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		address: getZoltarAddress(),
		args: [universeId, questionId],
	})

export const splitRep = async (client: WriteClient, universeId: bigint, outcomeIndexes: number[]) =>
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitRep',
		address: getZoltarAddress(),
		args: [universeId, outcomeIndexes],
	})

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: `0x${ string }`) {
	return await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: [],
	})
}

export const forkerClaimRep = async (client: WriteClient, universeId: bigint, outcomeIndexes: number[]) =>
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkerClaimRep',
		address: getZoltarAddress(),
		args: [universeId, outcomeIndexes],
	})

export function getRepTokenAddress(universeId: bigint): `0x${ string }` {
	if (universeId === 0n) return getAddress(addressString(GENESIS_REPUTATION_TOKEN))
	const initCode = encodeDeployData({
		abi: ReputationToken_ReputationToken.abi,
		bytecode: `0x${ ReputationToken_ReputationToken.evm.bytecode.object }`,
		args: [getZoltarAddress()],
	})
	return getCreate2Address({ from: getZoltarAddress(), salt: bytes32String(universeId), bytecodeHash: keccak256(initCode) })
}

export const getZoltarForkThreshold = async (client: ReadClient, universeId: bigint) =>
	await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getForkThreshold',
		address: getZoltarAddress(),
		args: [universeId],
	})

export const createQuestion = async (client: WriteClient, questionData: any, outcomes: string[]): Promise<void> => {
	await client.writeContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'createQuestion',
		address: getZoltarQuestionDataAddress(),
		args: [questionData, outcomes],
	})
}
