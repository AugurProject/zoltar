import { type Address, type TransactionLog } from '#ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_REPORT_SETTLED_TOPIC } from '@zoltar/shared/openOracle'
import { openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { type Configuration } from '#config/configuration'
import { authenticateDeploymentManifest, type DeploymentRole } from '#config/deployment-auth'
import { coordinatorPolicySafetyMismatch, retainedReportIds, type CoordinatorGamePolicy } from '#core/game-policy'
import { applyLogs, logBlockNumber, reportId, type ActiveReport } from '#monitoring/oracle-log-state'
import { compactFinalityWindow, ConnectivityDegradedError, operationalFailureDisposition } from '#monitoring/resilience'
import type { ReadClient } from '#core/operator-types'
import { errorMessage } from '#core/rpc-validation'
import { settledQuorumValue } from '#monitoring/read-quorum'
import { rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

const MAX_UNTRUSTED_DRY_RUN_REPORTS = 256
const REORG_OVERLAP_BLOCKS = 12n

export async function loadCoordinatorPolicies(client: ReadClient, config: Pick<Configuration, 'coordinatorAddresses' | 'network' | 'openOracle'>) {
	return Promise.all(
		config.coordinatorAddresses.map(async coordinator => {
			const [openOracle, token2, token1, settlementTime, disputeDelay, protocolFee, feePercentage, multiplier, timeType, trackDisputes, protocolFeeRecipient, callbackGasLimit] = await Promise.all([
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'openOracle' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'reputationToken' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'weth' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'settlementTime' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'disputeDelay' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'protocolFee' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'feePercentage' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'multiplier' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'timeType' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'trackDisputes' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'protocolFeeRecipient' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'getSettlementCallbackGasLimit' }),
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

export async function loadCoordinatorPoliciesWithQuorum(clients: readonly ReadClient[], endpoints: readonly string[], config: Pick<Configuration, 'coordinatorAddresses' | 'network' | 'openOracle'>) {
	if (clients.length !== endpoints.length) throw new Error('Coordinator policy readers and endpoints differ')
	return settledQuorumValue(
		'coordinator policies',
		clients.map(async (client, index) => ({ endpoint: endpoints[index] ?? '', value: await loadCoordinatorPolicies(client, config) })),
	)
}

export function requiredDeploymentIdentities(config: Configuration) {
	const identities: { address: Address; role: DeploymentRole }[] = [
		{ address: config.openOracle, role: 'open-oracle' },
		{ address: config.network.weth, role: 'weth' },
		{ address: config.network.factory, role: 'uniswap-factory' },
		{ address: config.network.quoter, role: 'uniswap-quoter' },
		...config.coordinatorAddresses.map(address => ({ address, role: 'coordinator' as const })),
		...config.tokenAddresses.map(address => ({ address, role: 'token' as const })),
	]
	if (config.executor !== undefined) identities.push({ address: config.executor, role: 'executor' })
	if (config.router !== undefined) identities.push({ address: config.router, role: 'uniswap-router' })
	if (config.v2Router !== undefined) identities.push({ address: config.v2Router, role: 'uniswap-v2-router' })
	if (config.v4PoolManager !== undefined) identities.push({ address: config.v4PoolManager, role: 'uniswap-v4-pool-manager' })
	if (config.v4Quoter !== undefined) identities.push({ address: config.v4Quoter, role: 'uniswap-v4-quoter' })
	return identities
}

export function authenticatedExecutionToken(config: Configuration, token: Address) {
	if (!config.execute) return true
	return config.deploymentManifest?.contracts.some(entry => entry.role === 'token' && entry.address.toLowerCase() === token.toLowerCase()) === true
}

export async function requireManifestAuthenticationQuorum(attempts: readonly Promise<void>[]) {
	const settled = await Promise.allSettled(attempts)
	const failures = settled.flatMap(result => (result.status === 'rejected' ? [result.reason] : []))
	const safetyFailure = failures.find(error => operationalFailureDisposition(error) === 'safety-paused')
	if (safetyFailure !== undefined) throw safetyFailure
	const requirement = rpcQuorumRequirement()
	if (settled.filter(result => result.status === 'fulfilled').length < requirement) throw new ConnectivityDegradedError(`Deployment authentication requires at least ${requirement === 1 ? 'one available RPC endpoint' : 'two available independent RPC endpoints'}: ${failures.map(errorMessage).join('; ')}`)
}

export async function authenticateConfiguredDeployments(clients: readonly ReadClient[], config: Configuration) {
	if (!config.execute) return
	const manifest = config.deploymentManifest
	if (manifest === undefined) throw new Error('Execution requires an authenticated deployment manifest')
	const required = [...requiredDeploymentIdentities(config), ...manifest.contracts.map(contract => ({ address: contract.address, role: contract.role }))]
	await requireManifestAuthenticationQuorum(
		clients.map(client =>
			authenticateDeploymentManifest(manifest, {
				chainId: config.network.chain.id,
				network: config.network.name,
				readCode: address => client.getCode({ address }),
				required,
			}),
		),
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
