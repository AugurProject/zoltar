import { ReputationToken_ReputationToken, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData } from '../../../../types/contractArtifact'
import { ReadClient, WriteClient } from '../viem'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes } from 'viem'
import { addressString, bytes32String } from '../bigint'
import { ensureProxyDeployerDeployed, getERC20Balance } from '../utilities'

function getZoltarInitCode(zoltarQuestionDataAddress: `0x${string}`): `0x${string}` {
	return encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
		args: [zoltarQuestionDataAddress],
	})
}

export function getZoltarAddress(): `0x${string}` {
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	const initCode = getZoltarInitCode(zoltarQuestionDataAddress)
	return getCreate2Address({
		from: addressString(PROXY_DEPLOYER_ADDRESS),
		salt: numberToBytes(0),
		bytecode: initCode,
	})
}

export function getZoltarQuestionDataAddress(): `0x${string}` {
	const bytecode: `0x${string}` = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isZoltarQuestionDataDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${string}` = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.deployedBytecode.object}`
	const address = getZoltarQuestionDataAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

const deployZoltarQuestionDataTransaction = () => {
	const bytecode: `0x${string}` = `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`
	return { to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const
}

export const ensureZoltarQuestionDataDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isZoltarQuestionDataDeployed(client)) return
	const hash = await client.sendTransaction(deployZoltarQuestionDataTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const isZoltarDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${string}` = `0x${Zoltar_Zoltar.evm.deployedBytecode.object}`
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
	const raw = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'universes',
		address: getZoltarAddress(),
		args: [universeId],
	})
	// ABI returns: [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId]
	const [forkTime, , forkingOutcomeIndex, reputationToken, parentUniverseId] = raw as [bigint, bigint, bigint, `0x${string}`, bigint]
	return { forkTime, reputationToken, parentUniverseId, forkingOutcomeIndex: Number(forkingOutcomeIndex) }
}

export const getUniverseForkData = async (client: ReadClient, universeId: bigint) => {
	// Determine forker address from client (tests pass a WriteClient with account)
	const clientAny = client as any
	const forkerAddress = clientAny.account?.address
	if (!forkerAddress) {
		throw new Error('forker address not available from client')
	}
	// Get forker's internal rep balance for this universe
	const repBalance = (await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'repTokensMigrated',
		address: getZoltarAddress(),
		args: [forkerAddress, universeId],
	})) as bigint
	// Get forkQuestionId from universe data
	const raw = await client.readContract({
		abi: Zoltar_Zoltar.abi,
		address: getZoltarAddress(),
		functionName: 'universes',
		args: [universeId],
	})
	const [, forkQuestionId] = raw as [bigint, bigint, bigint, `0x${string}`, bigint]
	return { forkedBy: forkerAddress, forkerRepDeposit: repBalance, questionId: forkQuestionId }
}

export const forkUniverse = async (client: WriteClient, universeId: bigint, questionId: bigint) =>
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'forkUniverse',
		address: getZoltarAddress(),
		args: [universeId, questionId],
	})

export const prepareRepForMigration = async (client: WriteClient, universeId: bigint, amount: bigint) =>
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'prepareRepForMigration',
		address: getZoltarAddress(),
		args: [universeId, amount],
	})

export const migrateInternalRep = async (client: WriteClient, universeId: bigint, amount: bigint, outcomeIndexes: (number | bigint)[]) => {
	const bigintIndices = outcomeIndexes.map(x => BigInt(x))
	await client.writeContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'migrateInternalRep',
		address: getZoltarAddress(),
		args: [universeId, amount, bigintIndices],
	})
}

// forkerClaimRep: mints the forker's internal balance (from fork) to specified child outcomes
export const forkerClaimRep = async (client: WriteClient, universeId: bigint, outcomeIndexes: (number | bigint)[]) => {
	const clientAny = client as any
	const forkerAddress = clientAny.account?.address
	if (!forkerAddress) throw new Error('client account missing')
	// Get the internal balance for the forker in this universe
	const amount = (await client.readContract({
		abi: Zoltar_Zoltar.abi,
		functionName: 'repTokensMigrated',
		address: getZoltarAddress(),
		args: [forkerAddress, universeId],
	})) as bigint
	await migrateInternalRep(client, universeId, amount, outcomeIndexes)
}

// splitRep: burns the caller's Genesis REP and mints it to the specified child outcomes
export const splitRep = async (client: WriteClient, universeId: bigint, outcomeIndexes: (number | bigint)[]) => {
	// Get the caller's Genesis REP balance
	const genesisRepBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
	if (genesisRepBalance > 0n) {
		// Burn the REP and credit internal balance
		await prepareRepForMigration(client, universeId, genesisRepBalance)
		// Migrate to children
		await migrateInternalRep(client, universeId, genesisRepBalance, outcomeIndexes)
	}
}

export async function getTotalTheoreticalSupply(client: ReadClient, repToken: `0x${string}`) {
	return await client.readContract({
		abi: ReputationToken_ReputationToken.abi,
		functionName: 'getTotalTheoreticalSupply',
		address: repToken,
		args: [],
	})
}

export function getRepTokenAddress(universeId: bigint): `0x${string}` {
	if (universeId === 0n) return getAddress(addressString(GENESIS_REPUTATION_TOKEN))
	const initCode = encodeDeployData({
		abi: ReputationToken_ReputationToken.abi,
		bytecode: `0x${ReputationToken_ReputationToken.evm.bytecode.object}`,
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
