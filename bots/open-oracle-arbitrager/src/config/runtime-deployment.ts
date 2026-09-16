import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { canonicalSecurityPoolFactory } from '#config/network'
import { keccak256 } from '@zoltar/bot-shared/ethereum'
import { rpcFailureWithContext, type Address, type TransactionLog } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_REPORT_SETTLED_TOPIC } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { type Configuration } from '#config/configuration'
import { authenticateDeploymentManifest, validateDeploymentManifestRequirements, type DeploymentRole } from '#config/deployment-auth'
import { coordinatorPolicySafetyMismatch, retainedReportIds, type CoordinatorGamePolicy } from '#core/game-policy'
import { applyLogs, logBlockNumber, reportId, type ActiveReport } from '#monitoring/oracle-log-state'
import { compactFinalityWindow } from '@zoltar/bot-shared/monitoring/resilience'
import type { ReadClient } from '#core/operator-types'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { endpointLabel } from '#monitoring/connectivity'

const MAX_UNTRUSTED_DRY_RUN_REPORTS = 256
const REORG_OVERLAP_BLOCKS = 12n

export async function loadCoordinatorPolicies(client: ReadClient, config: Pick<Configuration, 'coordinatorAddresses' | 'network' | 'openOracle'>, blockNumber?: bigint) {
	return Promise.all(
		config.coordinatorAddresses.map(async coordinator => {
			const [openOracle, token2, token1, settlementTime, disputeDelay, protocolFee, feePercentage, multiplier, timeType, trackDisputes, protocolFeeRecipient, callbackGasLimit] = await Promise.all([
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'openOracle' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'reputationToken' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'weth' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'settlementTime' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'disputeDelay' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'protocolFee' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'feePercentage' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'multiplier' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'timeType' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'trackDisputes' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'protocolFeeRecipient' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, blockNumber, functionName: 'getSettlementCallbackGasLimit' }),
			])
			if (openOracle.toLowerCase() !== config.openOracle.toLowerCase()) throw new Error(`Configured coordinator ${coordinator} uses OpenOracle ${openOracle}, not ${config.openOracle}`)
			if (token1.toLowerCase() !== config.network.weth.toLowerCase()) throw new Error(`Configured coordinator ${coordinator} uses WETH ${token1}, not ${config.network.weth}`)
			if (!trackDisputes) throw new Error(`Configured coordinator ${coordinator} does not track disputes`)
			const policy = {
				callbackGasLimit,
				coordinator,
				disputeDelay,
				feePercentage,
				flags: OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | (timeType ? OPEN_ORACLE_FLAG_TIME_TYPE : 0n),
				multiplier,
				openOracle,
				protocolFee,
				protocolFeeRecipient,
				settlementTime,
				token1,
				token2,
			} satisfies CoordinatorGamePolicy
			const safetyMismatch = coordinatorPolicySafetyMismatch(policy)
			if (safetyMismatch !== undefined) throw new Error(`Configured coordinator ${coordinator} is unsafe: ${safetyMismatch}`)
			return policy
		}),
	)
}

function requiredDeploymentIdentities(config: Configuration) {
	const identities: { address: Address; role: DeploymentRole }[] = [
		{ address: config.openOracle, role: 'open-oracle' },
		{ address: config.network.weth, role: 'weth' },
		{ address: canonicalSecurityPoolFactory(config.network.name), role: 'security-pool-factory' },
	]
	if (config.router !== undefined) identities.push({ address: config.network.factory, role: 'uniswap-factory' }, { address: config.network.quoter, role: 'uniswap-quoter' }, { address: config.router, role: 'uniswap-router' })
	if (config.v2Router !== undefined) identities.push({ address: config.v2Router, role: 'uniswap-v2-router' })
	if (config.v4PoolManager !== undefined) identities.push({ address: config.v4PoolManager, role: 'uniswap-v4-pool-manager' })
	if (config.v4Quoter !== undefined) identities.push({ address: config.v4Quoter, role: 'uniswap-v4-quoter' })
	return identities
}

export function authenticatedExecutionToken(config: Configuration, token: Address) {
	if (!config.execute) return true
	return config.deploymentManifest?.contracts.some(entry => entry.role === 'token' && entry.address.toLowerCase() === token.toLowerCase()) === true
}

export async function authenticateConfiguredDeployments(clients: readonly ReadClient[], config: Configuration) {
	if (!config.execute) return
	const executor = canonicalExecutorIdentity()
	if (config.executor?.toLowerCase() !== executor.address.toLowerCase()) throw new Error('Executor must use the canonical derived address')
	const manifest = config.deploymentManifest
	if (manifest === undefined) throw new Error('Execution requires an authenticated deployment manifest')
	const required = [...requiredDeploymentIdentities(config), ...manifest.contracts.map(contract => ({ address: contract.address, role: contract.role }))]
	validateDeploymentManifestRequirements(manifest, { chainId: config.network.chain.id, network: config.network.name, required })
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	await settledQuorumValue(
		'Deployment authentication',
		clients.map(async (client, index) => {
			const endpoint = endpointLabel(endpoints[index] ?? '')
			try {
				const executorCode = await client.getCode({ address: executor.address })
				if (executorCode === undefined || keccak256(executorCode) !== executor.runtimeCodeHash) throw new Error('Canonical executor is missing or has unexpected bytecode; deploy the bundled executor')
				await authenticateDeploymentManifest(manifest, {
					chainId: config.network.chain.id,
					network: config.network.name,
					readCode: address => client.getCode({ address }),
					required,
				})
			} catch (error) {
				throw rpcFailureWithContext(error, endpoint, 'eth_getCode')
			}
			return { endpoint, value: true }
		}),
	)
}

export function retainReportsAndLogs(reports: Map<bigint, ActiveReport>, logs: readonly TransactionLog[], policies: readonly CoordinatorGamePolicy[], openOracle: Address, head: bigint) {
	const retainedIds = retainedReportIds(reports, policies, openOracle, MAX_UNTRUSTED_DRY_RUN_REPORTS)
	const retainedLogs = compactFinalityWindow(
		logs.filter(log => retainedIds.has(reportId(log))),
		head,
		REORG_OVERLAP_BLOCKS,
		reportId,
		logBlockNumber,
		log => log.topics[0]?.toLowerCase() === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase(),
	)
	reports.clear()
	applyLogs(reports, retainedLogs)
	return retainedLogs
}
