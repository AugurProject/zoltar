import { decodeEventLog, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type Address, type TransactionReceipt } from 'viem'
import { peripherals_SecurityPool_SecurityPool, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_tokens_ShareToken_ShareToken } from '../contractArtifact.js'
import { isIgnorableLogDecodeError } from '../lib/errors.js'
import type { SecurityPoolCreationResult, SecurityPoolPage, SecurityVaultDetails, WriteClient, ReadClient } from '../types/contracts.js'
import { writeContractAndWaitForReceipt } from './core.js'
import { getDeploymentSteps } from './deployment.js'
import { getInfraContractAddresses, getZoltarAddress } from './deploymentHelpers.js'
import { getQuestionIdHex } from './helpers.js'
import { loadEscrowedRepByVaults, loadListedSecurityPool, loadSecurityPoolDeployments } from './securityPoolSummaries.js'

const ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT = 3n

function getDeploymentStepAddress(id: 'securityPoolFactory' | 'zoltarQuestionData') {
	const step = getDeploymentSteps().find(candidate => candidate.id === id)
	if (step === undefined) throw new Error(`Unknown deployment step: ${id}`)
	return step.address
}

function getSecurityPoolAddressFromReceipt(receipt: TransactionReceipt) {
	for (const log of receipt.logs) {
		try {
			const decodedLog = decodeEventLog({
				abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
				data: log.data,
				topics: log.topics,
			})
			if (decodedLog.eventName !== 'DeploySecurityPool') continue
			const securityPoolAddress = decodedLog.args.securityPool
			if (securityPoolAddress === undefined) throw new Error('Deployment event missing security pool address')
			return securityPoolAddress
		} catch (error) {
			if (!isIgnorableLogDecodeError(error)) throw error
			continue
		}
	}

	throw new Error('Security pool deployment transaction succeeded without a DeploySecurityPool event')
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

export async function createSecurityPool(
	client: WriteClient,
	parameters: {
		questionId: bigint
		securityMultiplier: bigint
	},
) {
	const { hash: deployPoolHash, receipt } = await writeContractAndWaitForReceipt(client, () => ({
		address: getDeploymentStepAddress('securityPoolFactory'),
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		args: [0n, parameters.questionId, parameters.securityMultiplier],
	}))

	return {
		deployPoolHash,
		questionId: getQuestionIdHex(parameters.questionId),
		securityPoolAddress: getSecurityPoolAddressFromReceipt(receipt),
		securityMultiplier: parameters.securityMultiplier,
		universeId: 0n,
	} satisfies SecurityPoolCreationResult
}

export async function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, securityMultiplier: bigint) {
	const shareTokenAddress = getOriginSecurityPoolShareTokenAddress(questionId, securityMultiplier)
	const code = await client.getCode({ address: shareTokenAddress })
	return code !== undefined && code !== '0x'
}

export async function loadSecurityPoolPage(client: ReadClient, pageIndex: number, pageSize: number, accountAddress?: Address): Promise<SecurityPoolPage> {
	if (!Number.isInteger(pageIndex) || pageIndex < 0) throw new Error('Security pool page index must be a non-negative integer')
	if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('Security pool page size must be a positive integer')
	const poolCount = await client.readContract({
		address: getInfraContractAddresses().securityPoolFactory,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'securityPoolDeploymentCount',
		args: [],
	})
	const startIndex = BigInt(pageIndex * pageSize)
	if (startIndex >= poolCount) {
		return {
			pageIndex,
			pageSize,
			poolCount,
			pools: [],
		}
	}
	const count = poolCount - startIndex < BigInt(pageSize) ? poolCount - startIndex : BigInt(pageSize)
	const deployments = await loadSecurityPoolDeployments(client, startIndex, count)
	const pools = await Promise.all(
		deployments.map(
			async deployment =>
				await loadListedSecurityPool(client, deployment, {
					...(accountAddress === undefined ? {} : { accountAddress }),
					loadVaults: true,
					vaultPreviewLimit: ACTIVE_SECURITY_POOL_VAULT_PREVIEW_LIMIT,
				}),
		),
	)
	return {
		pageIndex,
		pageSize,
		poolCount,
		pools,
	}
}

export async function loadSecurityVaultDetails(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails | undefined> {
	if (!(await securityPoolExists(client, securityPoolAddress))) return undefined

	const [currentRetentionRate, managerAddress, poolOwnershipDenominator, repToken, totalRepBalance, totalSecurityBondAllowance, universeId, vaultData, escrowedRepByVault] = await Promise.all([
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'currentRetentionRate', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'priceOracleManagerAndOperatorQueuer', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'poolOwnershipDenominator', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'repToken', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'getTotalRepBalance', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'totalSecurityBondAllowance', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'universeId', address: securityPoolAddress, args: [] }),
		client.readContract({ abi: peripherals_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', address: securityPoolAddress, args: [vaultAddress] }),
		loadEscrowedRepByVaults(client, securityPoolAddress, [vaultAddress]).then(values => values[0] ?? 0n),
	])

	const [poolOwnership, securityBondAllowance, unpaidEthFees] = vaultData
	const repDepositShare = poolOwnershipDenominator === 0n || poolOwnership === 0n ? 0n : (poolOwnership * totalRepBalance) / poolOwnershipDenominator

	return {
		currentRetentionRate,
		escalationEscrowedRep: escrowedRepByVault,
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
