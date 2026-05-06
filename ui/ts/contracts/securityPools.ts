import { encodeAbiParameters, encodeDeployData, encodeFunctionData, getCreate2Address, keccak256, RpcError, type Abi, type Account, type Address, type Hash, type TransactionReceipt } from 'viem'
import {
	peripherals_SecurityPool_SecurityPool,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_tokens_ShareToken_ShareToken,
} from '../contractArtifact.js'
import type { SecurityPoolCreationResult, SecurityVaultDetails, WriteClient, ReadClient } from '../types/contracts.js'
import { getQuestionIdHex } from './helpers.js'
import { getDeploymentSteps } from './deployment.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'

type ContractRevertReasonParams = {
	account?: Account | Address | undefined | null
	abi: Abi | readonly unknown[]
	address: Address
	args?: readonly unknown[]
	functionName: string
	gas?: bigint
	value?: bigint
}

function getDeploymentStepAddress(id: 'securityPoolFactory' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

async function getContractRevertReason<TCallParams extends ContractRevertReasonParams>(client: ReadClient | WriteClient, params: TCallParams) {
	try {
		const data = encodeFunctionData({
			abi: params.abi,
			functionName: params.functionName,
			args: params.args,
		})
		const account = params.account ?? undefined
		await client.call({
			account,
			data,
			gas: params.gas,
			to: params.address,
			value: params.value,
		})
		return undefined
	} catch (error) {
		if (error instanceof RpcError) {
			return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined)
		}
		if (error instanceof Error) return error.message
		return undefined
	}
}

function getOriginalErrorMessage(error: unknown) {
	if (error instanceof RpcError) {
		return error.shortMessage ?? error.message ?? (error.cause instanceof Error ? error.cause.message : undefined)
	}
	if (error instanceof Error) return error.message
	return undefined
}

async function writeContractAndWaitForReceipt<TCallParams extends ContractRevertReasonParams>(client: WriteClient, getCallParams: () => TCallParams): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
	const callParams = getCallParams()
	const data = encodeFunctionData({
		abi: callParams.abi,
		functionName: callParams.functionName,
		args: callParams.args,
	})
	const account = callParams.account ?? undefined
	let hash: Hash
	try {
		hash = await client.sendTransaction({
			account,
			data,
			gas: callParams.gas,
			to: callParams.address,
			value: callParams.value,
		})
	} catch (error) {
		const reason = await getContractRevertReason(client, callParams)
		throw new Error(reason ?? getOriginalErrorMessage(error) ?? 'Transaction reverted')
	}
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.status === 'reverted') {
		const reason = await getContractRevertReason(client, callParams)
		throw new Error(reason ?? 'Transaction reverted')
	}
	return { hash, receipt }
}

async function getLatestDeployedSecurityPoolAddress(client: Pick<WriteClient, 'readContract'>) {
	const deploymentCount = await client.readContract({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	if (deploymentCount === 0n) throw new Error('Security pool deployment transaction succeeded without recording a deployment')

	const deployments = await client.readContract({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentsRange',
		args: [deploymentCount - 1n, 1n],
	})
	const latestDeployment = deployments[0]
	if (latestDeployment === undefined) throw new Error('Missing latest security pool deployment record')
	return latestDeployment.securityPool
}

function getOriginSecurityPoolShareTokenSalt(questionId: bigint, securityMultiplier: bigint) {
	return keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [securityMultiplier, questionId]))
}

function getOriginSecurityPoolShareTokenAddress(questionId: bigint, securityMultiplier: bigint) {
	return getCreate2Address({
		from: getInfraContractAddresses().shareTokenFactory,
		salt: getOriginSecurityPoolShareTokenSalt(questionId, securityMultiplier),
		bytecode: encodeDeployData({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [getInfraContractAddresses().securityPoolFactory, getZoltarAddress(), questionId],
		}),
	})
}

async function securityPoolExists(client: Pick<ReadClient, 'getCode'>, securityPoolAddress: Address) {
	const code = await client.getCode({ address: securityPoolAddress })
	return code !== undefined && code !== '0x'
}

async function poolOwnershipToRep(client: ReadClient, securityPoolAddress: Address, poolOwnership: bigint) {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipToRep',
		address: securityPoolAddress,
		args: [poolOwnership],
	})
}

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		currentRetentionRate: bigint
		questionId: bigint
		securityMultiplier: bigint
	},
) {
	const { hash: deployPoolHash } = await writeContractAndWaitForReceipt(client, () => ({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.securityMultiplier, parameters.currentRetentionRate],
	}))

	return {
		deployPoolHash,
		questionId: getQuestionIdHex(parameters.questionId),
		securityPoolAddress: await getLatestDeployedSecurityPoolAddress(client),
		securityMultiplier: parameters.securityMultiplier,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, securityMultiplier: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, securityMultiplier)
	const code = await client.getCode({ address: shareTokenAddress })
	return code !== undefined && code !== '0x'
}

export async function loadSecurityVaultDetails(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails | undefined> {
	if (!(await securityPoolExists(client, securityPoolAddress))) return undefined

	const [currentRetentionRate, managerAddress, poolOwnershipDenominator, repToken, totalSecurityBondAllowance, universeId, vaultData] = await Promise.all([
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'poolOwnershipDenominator', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalSecurityBondAllowance', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
	])

	const [poolOwnership, securityBondAllowance, unpaidEthFees, , lockedRepInEscalationGame] = vaultData
	const repDepositShare = poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : await poolOwnershipToRep(client, securityPoolAddress, poolOwnership)

	return {
		currentRetentionRate,
		lockedRepInEscalationGame,
		managerAddress,
		poolOwnershipDenominator,
		repDepositShare,
		repToken,
		securityBondAllowance,
		securityPoolAddress,
		totalSecurityBondAllowance,
		unpaidEthFees,
		universeId,
		vaultAddress,
	}
}
