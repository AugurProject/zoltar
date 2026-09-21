import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { canonicalSecurityPoolFactory } from '#config/network'
import { requiredDeploymentRoles, type DeploymentRole } from '#config/deployment-roles'
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
import type { OperatorState } from '#state/operator-state'

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
	const addresses: Record<DeploymentRole, Address | undefined> = {
		'open-oracle': config.openOracle,
		'security-pool-factory': canonicalSecurityPoolFactory(config.network.name),
		'uniswap-factory': config.network.factory,
		'uniswap-quoter': config.network.quoter,
		'uniswap-router': config.router,
		'uniswap-v2-router': config.v2Router,
		'uniswap-v4-pool-manager': config.v4PoolManager,
		'uniswap-v4-quoter': config.v4Quoter,
		weth: config.network.weth,
	}
	return requiredDeploymentRoles({ v2: config.v2Router !== undefined, v3: config.router !== undefined, v4: config.v4PoolManager !== undefined || config.v4Quoter !== undefined }).map(role => {
		const address = addresses[role]
		if (address === undefined) throw new Error(`Canonical ${role} address is unavailable on ${config.network.name}`)
		return { address, role }
	})
}

/**
 * Presence of the canonical executor and the contracts live execution depends on, as last inspected by a scan. The CREATE2
 * address commits to the bundled init code and the executor has no constructor state, so any code at that address is the
 * bundled runtime code; presence is the whole check.
 */
export type CanonicalDeploymentStatus = {
	contracts: readonly { address: Address; deployed: boolean; role: DeploymentRole }[]
	executorDeployed: boolean
}

const hasCode = (code: Hex | undefined) => code !== undefined && code !== '0x'

async function inspectCanonicalDeploymentsWith(client: ReadClient, config: Configuration): Promise<CanonicalDeploymentStatus> {
	const required = requiredDeploymentIdentities(config)
	const [executorCode, ...codes] = await Promise.all([client.getCode({ address: canonicalExecutorIdentity().address }), ...required.map(identity => client.getCode({ address: identity.address }))])
	return { contracts: required.map((identity, index) => ({ ...identity, deployed: hasCode(codes[index]) })), executorDeployed: hasCode(executorCode) }
}

/** The reason live execution cannot rely on the inspected deployments, or undefined when every canonical contract is present. */
function canonicalDeploymentFailure(status: CanonicalDeploymentStatus) {
	if (!status.executorDeployed) return 'Canonical executor is not deployed; deploy the bundled executor'
	const missing = status.contracts.find(contract => !contract.deployed)
	return missing === undefined ? undefined : `Canonical ${missing.role} ${missing.address} is not deployed`
}

/**
 * Reads the canonical executor bytecode and the required contract deployments so the dashboard checklist can show them
 * before execution is armed. Dry run inspects the primary read endpoint only. Live mode needs the configured quorum to
 * agree the deployments are present; an endpoint that still reports them absent is set aside like an unavailable one so a
 * lagging node cannot block a quorum that has verified them, and its observation is returned when no quorum verifies them.
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

/**
 * Inspects the canonical deployments and publishes the result for the checklist before live mode enforces it, so a failed
 * live startup shows what is missing instead of the previous inspection. The previous result is dropped first: it may
 * predate a settings change, and an inspection that fails must not leave it looking verified.
 */
export async function authenticateConfiguredDeployments(clients: readonly ReadClient[], config: Configuration, state: Pick<OperatorState, 'canonicalDeployments'>) {
	state.canonicalDeployments = undefined
	state.canonicalDeployments = await inspectCanonicalDeployments(clients, config)
	if (config.execute) assertCanonicalDeployments(config, state.canonicalDeployments)
	return state.canonicalDeployments
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
