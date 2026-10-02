import { authenticateConfiguredDeployments, refreshIncompleteCanonicalDeployments } from '#config/runtime-deployment'
import { REORG_OVERLAP_BLOCKS } from '#execution/execution-orchestration'
import { checkConnectivity, checkSubmissionEndpoints } from '@zoltar/bot-shared/monitoring/connectivity'
import { recordOperation } from '#state/operator-state'
import { finalityAnchorRequiresReset, initialCursor, latestLogRange } from '@zoltar/bot-shared/monitoring/block-sync'
import { requireDeployedContractsOnce } from '@zoltar/bot-shared/monitoring/deployed-contracts'
import { clearReportCaches, readEndpoints, type OperatorContext, type OperatorRuntime, type ScanBlock } from './operator-runtime.ts'
import { selectQuorumChainClient, selectQuorumHead } from './quorum-head.ts'

/**
 * Validates the chain, deployed contracts, and endpoints once after startup or any reset of the read clients;
 * later scans only refresh canonical deployments that are still incomplete.
 */
export async function validateStartupOrRefreshDeployments(runtime: OperatorRuntime, context: OperatorContext, executionActivationPending: boolean) {
	const { config, contextualRpcRead, fixedState, pending, state } = context
	if (runtime.startupValidated) {
		state.canonicalDeployments = await refreshIncompleteCanonicalDeployments(runtime.readClients, config, state.canonicalDeployments)
		return
	}
	if (config.execute) {
		const selected = await selectQuorumChainClient(runtime.readClients, readEndpoints(config), config.network, contextualRpcRead, config.rpcQuorum)
		runtime.client = selected.client
		runtime.clientRpcUrl = selected.rpcUrl
	}
	await contextualRpcRead('eth_chainId', async requestClient => {
		const value = await requestClient.getChainId()
		if (value !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${value.toString()}`)
	})
	await requireDeployedContractsOnce(runtime.client, [{ name: 'Multicall3', address: config.network.multicall3 }])
	await authenticateConfiguredDeployments(runtime.readClients, config, state)
	state.endpointChecks = [...(config.execute ? [] : await checkConnectivity(config.connectivity, config.network.chain.id)), ...(await checkSubmissionEndpoints(config.submission, config.network.chain.id))]
	runtime.startupValidated = true
	if (executionActivationPending) {
		fixedState.execute = true
		pending.execute = undefined
		state.paused = config.paused
	}
}

/** Execution agrees on a quorum head and pins the scan client to it; monitoring reads the latest block from the pool. */
export async function selectScanHead(runtime: OperatorRuntime, context: OperatorContext): Promise<ScanBlock> {
	const { config, contextualRpcRead } = context
	if (config.execute) {
		const selected = await selectQuorumHead(runtime.readClients, readEndpoints(config), contextualRpcRead, config.rpcQuorum)
		runtime.client = selected.client
		runtime.clientRpcUrl = selected.rpcUrl
		return selected.block
	}
	return await contextualRpcRead('eth_getBlockByNumber', async requestClient => {
		const value = await requestClient.getBlock()
		if (value.number == null) throw new Error('Latest block is missing its number')
		if (value.hash == null) throw new Error('Latest block is missing its hash')
		return { ...value, hash: value.hash, number: value.number }
	})
}

async function canonicalAnchorBlock(context: OperatorContext, blockNumber: bigint) {
	return await context.contextualRpcRead('eth_getBlockByNumber', async requestClient => {
		const value = await requestClient.getBlock({ blockNumber })
		if (value.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
		return { ...value, hash: value.hash }
	})
}

export async function finalityAnchorForHead(context: OperatorContext, headNumber: bigint) {
	const number = headNumber > REORG_OVERLAP_BLOCKS ? headNumber - REORG_OVERLAP_BLOCKS : 0n
	const anchor = await canonicalAnchorBlock(context, number)
	return { hash: anchor.hash, number }
}

export type FinalityAnchor = Awaited<ReturnType<typeof finalityAnchorForHead>>

/**
 * Compares the cursor's finality anchor with the canonical chain. When history changed beyond the retained overlap,
 * every report and market cache is cleared, the cursor restarts at the latest bounded window, and `true` is returned.
 */
export async function resetAfterFinalityAnchorReorg(runtime: OperatorRuntime, context: OperatorContext, blockNumber: bigint) {
	const { config, state } = context
	const cursor = runtime.cursor
	if (cursor?.finalityAnchorNumber === undefined || cursor.finalityAnchorHash === undefined) return false
	const anchorNumber = cursor.finalityAnchorNumber
	let observedAnchorHash: string | undefined
	if (anchorNumber <= blockNumber) observedAnchorHash = (await canonicalAnchorBlock(context, anchorNumber)).hash
	if (!finalityAnchorRequiresReset(cursor, blockNumber, observedAnchorHash)) return false
	clearReportCaches(runtime, context)
	runtime.cursor = config.coordinatorAddresses.length !== 0 || config.logLookbackBlocks === 0n ? initialCursor(blockNumber, 0n) : { ...initialCursor(blockNumber, 0n), nextBlock: latestLogRange(blockNumber, config.logLookbackBlocks).fromBlock }
	state.status = 'syncing'
	recordOperation(state, {
		category: 'scan',
		details: `anchor=${anchorNumber.toString()}`,
		level: 'warning',
		message: 'Canonical history changed beyond the retained overlap',
		reason: 'Execution stayed blocked while report and market caches were cleared; the latest bounded window will rebuild on the next scan',
		reportId: undefined,
	})
	return true
}
