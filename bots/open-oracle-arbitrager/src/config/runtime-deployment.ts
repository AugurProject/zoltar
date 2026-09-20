import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { canonicalSecurityPoolFactory } from '#config/network'
import type { DeploymentRole } from '#config/deployment-roles'
import { keccak256 } from '@zoltar/bot-shared/ethereum'
import { rpcFailureWithContext, type Address, type Hex, type TransactionLog } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, OPEN_ORACLE_REPORT_SETTLED_TOPIC } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { openOraclePriceCoordinatorAbi } from '#contracts/abi'
import { type Configuration } from '#config/configuration'
import { coordinatorPolicySafetyMismatch, retainedReportIds, type CoordinatorGamePolicy } from '#core/game-policy'
import { applyLogs, logBlockNumber, reportId, type ActiveReport } from '#monitoring/oracle-log-state'
import { compactFinalityWindow, ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { ReadClient } from '#core/operator-types'
import { availableSettledValues, quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { rpcQuorumDescription, rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
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

/** Presence of the canonical executor bytecode and the contracts live execution depends on, as last inspected by a scan. */
export type CanonicalDeploymentStatus = {
	contracts: readonly { address: Address; deployed: boolean; role: DeploymentRole }[]
	executor: 'deployed' | 'mismatched' | 'missing'
}

function executorStatus(code: Hex | undefined, runtimeCodeHash: Hex): CanonicalDeploymentStatus['executor'] {
	if (code === undefined || code === '0x') return 'missing'
	return keccak256(code) === runtimeCodeHash ? 'deployed' : 'mismatched'
}

async function inspectCanonicalDeploymentsWith(client: ReadClient, config: Configuration): Promise<CanonicalDeploymentStatus> {
	const executor = canonicalExecutorIdentity()
	const required = requiredDeploymentIdentities(config)
	const [executorCode, ...codes] = await Promise.all([client.getCode({ address: executor.address }), ...required.map(identity => client.getCode({ address: identity.address }))])
	return {
		contracts: required.map((identity, index) => ({ ...identity, deployed: codes[index] !== undefined && codes[index] !== '0x' })),
		executor: executorStatus(executorCode, executor.runtimeCodeHash),
	}
}

/** The reason live execution cannot rely on the inspected deployments, or undefined when every canonical contract is present. */
function canonicalDeploymentFailure(status: CanonicalDeploymentStatus) {
	if (status.executor !== 'deployed') return 'Canonical executor is missing or has unexpected bytecode; deploy the bundled executor'
	const missing = status.contracts.find(contract => !contract.deployed)
	return missing === undefined ? undefined : `Canonical ${missing.role} ${missing.address} is not deployed`
}

/**
 * Reads the canonical executor bytecode and the required contract deployments so the dashboard checklist can show them
 * before execution is armed. Dry run inspects the primary read endpoint only. Live mode needs the configured quorum to
 * agree the deployments are present; an endpoint that still reports them absent is set aside like an unavailable one so a
 * lagging node cannot block a quorum that has verified them, and its observation is returned when no quorum verifies them.
 * An endpoint reporting foreign executor bytecode is returned ahead of any verification so live mode refuses to start.
 */
async function inspectCanonicalDeployments(clients: readonly ReadClient[], config: Configuration): Promise<CanonicalDeploymentStatus> {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observe = async (client: ReadClient, index: number) => {
		const endpoint = endpointLabel(endpoints[index] ?? '')
		try {
			return { endpoint, value: await inspectCanonicalDeploymentsWith(client, config) }
		} catch (error) {
			throw rpcFailureWithContext(error, endpoint, 'eth_getCode')
		}
	}
	const primary = clients[0]
	if (primary === undefined) throw new Error('Canonical deployment inspection requires a read RPC client')
	if (!config.execute) return (await observe(primary, 0)).value
	const requirement = rpcQuorumRequirement()
	const settled = await Promise.allSettled(clients.map(observe))
	const available = availableSettledValues(settled)
	// Lag can only make a deployment look absent; foreign bytecode at the canonical address is never set aside as lagging.
	const mismatched = available.find(observation => observation.value.executor === 'mismatched')
	if (mismatched !== undefined) return mismatched.value
	const verified = available.filter(observation => canonicalDeploymentFailure(observation.value) === undefined)
	if (verified.length >= requirement) return quorumValue('Canonical deployments', verified, requirement)
	const incomplete = available.find(observation => canonicalDeploymentFailure(observation.value) !== undefined)
	if (incomplete !== undefined) return incomplete.value
	const failures = settled.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
	throw new ConnectivityDegradedError(`Deployment authentication requires at least ${rpcQuorumDescription(requirement)}${failures.length === 0 ? '' : `; ${failures.join('; ')}`}`)
}

/** Live execution refuses to start until the configured executor is the canonical one and every inspected deployment is present. */
function assertCanonicalDeployments(config: Pick<Configuration, 'executor'>, status: CanonicalDeploymentStatus) {
	if (config.executor?.toLowerCase() !== canonicalExecutorIdentity().address.toLowerCase()) throw new Error('Executor must use the canonical derived address')
	const failure = canonicalDeploymentFailure(status)
	if (failure !== undefined) throw new Error(failure)
}

/** Inspects the canonical deployments for the checklist and, in live mode, refuses to start until they are all present. */
export async function authenticateConfiguredDeployments(clients: readonly ReadClient[], config: Configuration) {
	const status = await inspectCanonicalDeployments(clients, config)
	if (config.execute) assertCanonicalDeployments(config, status)
	return status
}

/**
 * Contract code does not disappear from a canonical chain, so a verified inspection holds until the settings change; an
 * incomplete one is repeated every scan so the checklist notices an executor deployed from the dashboard or the CLI.
 */
export async function refreshIncompleteCanonicalDeployments(clients: readonly ReadClient[], config: Configuration, status: CanonicalDeploymentStatus | undefined) {
	if (status !== undefined && canonicalDeploymentFailure(status) === undefined) return status
	return await inspectCanonicalDeployments(clients, config)
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
