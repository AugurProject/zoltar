import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes } from 'viem'
import { addressString, bytes32String } from '../bigint'
import { ensureProxyDeployerDeployed } from '../utilities'

function getZoltarInitCode(zoltarQuestionDataAddress: `0x${ string }`): `0x${ string }` {
	return encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${ Zoltar_Zoltar.evm.bytecode.object }`,
		args: [zoltarQuestionDataAddress],
	})
}

export function getZoltarAddress(): `0x${ string }` {
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	const initCode = getZoltarInitCode(zoltarQuestionDataAddress)
	return getCreate2Address({
		from: addressString(PROXY_DEPLOYER_ADDRESS),
		salt: numberToBytes(0, { size: 32 }),
		bytecode: initCode,
	})
}

function getZoltarQuestionDataAddress(): `0x${ string }` {
	const bytecode: `0x${ string }` = `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0, { size: 32 }) })
}

const isZoltarQuestionDataDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object }`
	const address = getZoltarQuestionDataAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarQuestionDataTransaction = () => ({
		to: addressString(PROXY_DEPLOYER_ADDRESS),
		data: `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`,
	})

const ensureZoltarQuestionDataDeployed = async (client: WriteClient) => {
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

export const ensureZoltarDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	// Ensure ZoltarQuestionData is deployed first
	await ensureZoltarQuestionDataDeployed(client)
	if (await isZoltarDeployed(client)) return
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	const initCode = getZoltarInitCode(zoltarQuestionDataAddress)
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: initCode })
	await client.waitForTransactionReceipt({ hash })
}

export const getUniverseData = async (client: ReadClient, universeId: bigint) => {
	const [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universes',
		address: getZoltarAddress(),
		args: [universeId],
	})
	return { forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId }
}

export const forkUniverse = async (client: WriteClient, universeId: bigint, questionId: bigint) =>
	await writeContractAndWait(client, () => client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		address: getZoltarAddress(),
		args: [universeId, questionId],
	}))

export const addRepToMigrationBalance = async (client: WriteClient, universeId: bigint, amount: bigint) =>
	await writeContractAndWait(client, () => client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'addRepToMigrationBalance',
		address: getZoltarAddress(),
		args: [universeId, amount],
	}))

export const splitMigrationRep = async (client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: (number | bigint)[]) => {
	const bigintIndices = outcomeIndexes.map(x => BigInt(x))
	await writeContractAndWait(client, () => client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'splitMigrationRep',
		address: getZoltarAddress(),
		args: [universeId, amount, bigintIndices],
	}))
}

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: `0x${ string }`) {
	return await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: [],
	})
}

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

export const deployChild = async (client: WriteClient, universeId: bigint, outcomeIndex: bigint) =>
	await writeContractAndWait(client, () => client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'deployChild',
		address: getZoltarAddress(),
		args: [universeId, outcomeIndex],
	}))

export const getMigrationRepBalance = async (client: ReadClient, universeId: bigint, address: `0x${ string }`) => {
	const repBalance = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'getMigrationRepBalance',
		address: getZoltarAddress(),
		args: [address, universeId],
	})
	return repBalance
}
