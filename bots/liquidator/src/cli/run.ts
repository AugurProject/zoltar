#!/usr/bin/env bun

import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseTransaction, privateKeyToAccount, type Account, type Chain, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { checkConnectivity, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { pollUntilStopped } from '@zoltar/bot-shared/monitoring/resilience'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { loadSettings, parseStrategy, saveSettings, serializedSettings, type OperatorSettings } from '#config/settings'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { stagedOperationOutcome } from '#core/staged-outcome'
import { dryRunCandidate, executeLiquidation, executeVaultMigration, maintainVault, validateReceiptExpectation } from '#execution/liquidation-executor'
import { scanPools } from '#monitoring/pool-monitor'
import { assertIntentSender, initialRuntimeState, loadDurableState, operatorSnapshot, recordActivity, saveDurableState, type PoolObservation } from '#state/operator-state'
import { evaluateCandidate, sortCandidates } from '#core/strategy'
import { requireRecoveredTransactionSuccess, shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { inheritedChildPoolSelections, selectVaultMigration, validateApprovedUniverseSelection } from '#core/fork-migration'
import { createConfigurationMutationGate } from '#core/configuration-gate'

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function chainFor(settings: OperatorSettings) {
	return defineChain({
		id: settings.network.chainId,
		name: settings.network.name,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {
				http: [settings.connectivity.readRpcUrl],
			},
		},
	})
}

function selectedCandidate(pools: readonly PoolObservation[], settings: OperatorSettings) {
	const candidates = pools.flatMap(pool => pool.candidates)
	const candidate = sortCandidates(candidates, settings.strategy.candidatePriority)[0]
	if (candidate === undefined) return undefined
	const pool = pools.find(pool => pool.address.toLowerCase() === candidate.pool.address.toLowerCase())
	if (pool === undefined) throw new Error('Selected candidate pool disappeared from the scan')
	return { candidate, pool }
}

async function recoverPendingTransactions(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	for (const intent of [...state.pendingTransactions]) {
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
		const receiptResults = await Promise.all(
			clients.map(async ({ client, endpoint }) => {
				try {
					const receipt = await client.getTransactionReceipt({ hash: intent.hash })
					return {
						endpoint,
						receipt,
						value: {
							hash: receipt.transactionHash,
							logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
							status: receipt.status,
						},
					}
				} catch (error) {
					if (error instanceof Error && error.message.includes('could not be found')) return { endpoint, receipt: undefined, value: undefined }
					throw error
				}
			}),
		)
		const receiptEvidence = quorumValue(
			`receipt ${intent.hash}`,
			receiptResults.map(({ endpoint, value }) => ({ endpoint, value })),
		)
		if (receiptEvidence !== undefined) {
			const receipt = receiptResults.find(result => result.receipt !== undefined && result.receipt.transactionHash.toLowerCase() === receiptEvidence.hash.toLowerCase())?.receipt
			if (receipt === undefined) throw new Error(`Quorum receipt ${intent.hash} was not available for semantic validation`)
			const receiptOutcome = receipt.status === 'success' ? validateReceiptExpectation(receipt, intent.receiptExpectation) : { queuedOperationId: undefined }
			if (receiptOutcome.queuedOperationId !== undefined && intent.receiptExpectation.type === 'pending-liquidation') {
				state.pendingStagedOperations.push({
					coordinator: intent.receiptExpectation.coordinator,
					operationId: receiptOutcome.queuedOperationId,
					queuedBlock: receipt.blockNumber,
					target: intent.receiptExpectation.target,
				})
			}
			state.pendingTransactions = state.pendingTransactions.filter(value => value.hash.toLowerCase() !== intent.hash.toLowerCase())
			recordActivity(state, {
				hash: intent.hash,
				kind: intent.kind,
				message: receiptEvidence.status === 'success' ? `Recovered confirmation: ${intent.label}` : `Recovered revert: ${intent.label}`,
				status: receiptEvidence.status === 'success' ? 'confirmed' : 'failed',
			})
			await saveDurableState(settings.runtime.stateFile, state)
			requireRecoveredTransactionSuccess(receiptEvidence.status, intent.hash)
			continue
		}
		const nonce = quorumValue(`pending signer nonce for ${intent.hash}`, await Promise.all(clients.map(async ({ client, endpoint }) => ({ endpoint, value: await client.getTransactionCount({ address: intent.sender, blockTag: 'pending' }) }))))
		if (nonce > intent.nonce) {
			throw new Error(`Transaction ${intent.hash} has no receipt but signer nonce ${intent.nonce.toString()} was consumed; manual reconciliation is required`)
		}
		const blocks = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		if (intent.mode === 'private' && blocks.every(block => block > intent.maxBlockNumber)) {
			state.pendingTransactions = state.pendingTransactions.filter(value => value.hash.toLowerCase() !== intent.hash.toLowerCase())
			recordActivity(state, { hash: intent.hash, kind: intent.kind, message: `Private intent expired without inclusion: ${intent.label}`, status: 'failed' })
			await saveDurableState(settings.runtime.stateFile, state)
			continue
		}
		if (wallet.account.signMessage === undefined) throw new Error('Execution signer cannot authenticate transaction recovery')
		await submitSignedTransaction({
			address: intent.sender,
			hash: intent.hash,
			maxBlockNumber: intent.maxBlockNumber,
			publicRpcUrls: settings.connectivity.publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: intent.serializedTransaction,
			settings: settings.submission,
			signMessage: wallet.account.signMessage,
		})
		return true
	}
	return false
}

async function reconcilePendingStagedOperations(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
	for (const pending of [...state.pendingStagedOperations]) {
		const heads = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		const toBlock = heads.reduce((minimum, head) => (head < minimum ? head : minimum))
		const observations = await Promise.all(
			clients.map(async ({ client, endpoint }) => {
				const logs = await client.getLogs({ address: pending.coordinator, fromBlock: pending.queuedBlock, toBlock })
				return {
					endpoint,
					value: logs.flatMap(log => {
						const outcome = stagedOperationOutcome(log, pending.operationId)
						return outcome === undefined ? [] : [{ ...outcome, blockHash: log.blockHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash }]
					}),
				}
			}),
		)
		const outcomes = quorumValue(`staged operation ${pending.operationId.toString()}`, observations)
		if (outcomes.length === 0) continue
		const outcome = outcomes[0]
		if (outcome === undefined || outcomes.length !== 1 || outcome.operation !== 0n || outcome.operationId !== pending.operationId || typeof outcome.success !== 'boolean' || typeof outcome.errorMessage !== 'string') {
			throw new Error(`Coordinator returned an invalid outcome for staged operation ${pending.operationId.toString()}`)
		}
		state.pendingStagedOperations = state.pendingStagedOperations.filter(operation => operation.coordinator.toLowerCase() !== pending.coordinator.toLowerCase() || operation.operationId !== pending.operationId)
		recordActivity(state, {
			details: `coordinator=${pending.coordinator} operation=${pending.operationId.toString()} target=${pending.target}`,
			kind: 'liquidation',
			message: outcome.success ? 'Staged liquidation settled successfully' : `Staged liquidation failed: ${outcome.errorMessage}`,
			status: outcome.success ? 'confirmed' : 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		if (!outcome.success) throw new Error(`Staged liquidation ${pending.operationId.toString()} failed: ${outcome.errorMessage}`)
	}
}

async function main() {
	if (process.argv.length > 2) {
		throw new Error('The liquidator accepts no command-line arguments; use its operator file or dashboard')
	}
	let loaded = await loadSettings()
	let settings = loaded.settings
	let settingsRevision = loaded.revision
	let activePrivateKey = settings.privateKey
	let settingsQueue = Promise.resolve()
	const chain = chainFor(settings)
	let client = createPublicClient({
		chain,
		transport: http(settings.connectivity.readRpcUrl),
	})
	let wallet =
		activePrivateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(activePrivateKey),
					chain,
					transport: http(settings.connectivity.readRpcUrl),
				})
	const state = initialRuntimeState(settings.paused, wallet?.account.address)
	const durable = await loadDurableState(settings.runtime.stateFile)
	state.activities = durable.activities
	state.lastScannedBlock = durable.lastScannedBlock === undefined ? undefined : BigInt(durable.lastScannedBlock)
	state.pendingStagedOperations = durable.pendingStagedOperations
	state.pendingTransactions = durable.pendingTransactions
	const persistSettings = async (update: (current: OperatorSettings) => OperatorSettings) => {
		let result: Promise<void> = Promise.resolve()
		settingsQueue = settingsQueue.then(async () => {
			const next = update(settings)
			settingsRevision = await saveSettings(loaded.path, next, settingsRevision)
			settings = next
		})
		result = settingsQueue
		await result
	}
	const configurationMutationGate = createConfigurationMutationGate(() => state.scanning)
	const dashboard = settings.runtime.ui
		? startDashboardServer(settings.runtime.uiPort, {
				getConfiguration: () => serializedSettings(settings, true),
				getState: () => operatorSnapshot(state, settings.runtime.execute),
				hostname: settings.runtime.uiHost,
				setPaused: async value => {
					if (typeof value !== 'object' || value === null || Array.isArray(value)) {
						throw new Error('Pause request must be an object')
					}
					const paused = Reflect.get(value, 'paused')
					if (typeof paused !== 'boolean') throw new Error('paused must be a boolean')
					if (paused) {
						state.paused = true
						await persistSettings(current => ({ ...current, paused: true }))
					} else {
						await configurationMutationGate.run(async () => {
							await persistSettings(current => ({ ...current, paused: false }))
							state.paused = false
						})
					}
					recordActivity(state, {
						kind: 'configuration',
						message: paused ? 'Operator paused' : 'Operator resumed',
						status: 'info',
					})
					return { paused }
				},
				setApprovedUniverses: value =>
					configurationMutationGate.run(async () => {
						if (!Array.isArray(value) || value.some(universe => typeof universe !== 'string' || !/^(?:0|[1-9]\d*)$/.test(universe))) {
							throw new Error('Approved universes must be an array of non-negative integer strings')
						}
						const approvedUniverses = [...new Set(value.map(universe => BigInt(String(universe))))]
						if (approvedUniverses.some(universe => universe >= 2n ** 248n)) throw new Error('Approved universe must fit in uint248')
						validateApprovedUniverseSelection(state.universes, approvedUniverses)
						await persistSettings(current => ({ ...current, approvedUniverses }))
						for (const universe of state.universes) universe.approved = approvedUniverses.includes(universe.id)
						for (const pool of state.pools) pool.approvedUniverse = approvedUniverses.includes(pool.universeId)
						recordActivity(state, {
							details: approvedUniverses.map(universe => universe.toString()).join(', '),
							kind: 'configuration',
							message: 'Truthful universe selection saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
				setSelectedPools: value =>
					configurationMutationGate.run(async () => {
						if (!Array.isArray(value) || value.some(address => typeof address !== 'string')) {
							throw new Error('Selected pools must be an array of addresses')
						}
						const selectedPools = [
							...new Map(
								value.map(raw => {
									if (typeof raw !== 'string') throw new Error('Selected pools must contain addresses')
									const address = getAddress(raw)
									return [address.toLowerCase(), address] as const
								}),
							).values(),
						]
						await persistSettings(current => ({ ...current, selectedPools }))
						recordActivity(state, {
							details: selectedPools.join(', '),
							kind: 'configuration',
							message: 'Pool selection saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
				setSigner: value =>
					configurationMutationGate.run(async () => {
						if (typeof value !== 'object' || value === null || Array.isArray(value)) {
							throw new Error('Signer request must be an object')
						}
						const rawPrivateKey = Reflect.get(value, 'privateKey')
						const rememberSigner = Reflect.get(value, 'rememberSigner')
						if (typeof rawPrivateKey !== 'string' || typeof rememberSigner !== 'boolean') {
							throw new Error('Signer request requires privateKey and rememberSigner')
						}
						const candidate = signerCandidate(rawPrivateKey.trim() === '' ? null : rawPrivateKey)
						activePrivateKey = candidate.privateKey
						wallet =
							activePrivateKey === undefined
								? undefined
								: createWalletClient({
										account: privateKeyToAccount(activePrivateKey),
										chain,
										transport: http(settings.connectivity.readRpcUrl),
									})
						state.wallet = wallet?.account.address
						if (rememberSigner) {
							await persistSettings(current => ({ ...current, privateKey: candidate.privateKey }))
						}
						recordActivity(state, {
							kind: 'configuration',
							message: candidate.address === undefined ? 'Active signer cleared' : `Signer ${candidate.address} activated${rememberSigner ? ' and saved' : ''}`,
							status: 'info',
						})
						return { wallet: candidate.address }
					}),
				setStrategy: value =>
					configurationMutationGate.run(async () => {
						const strategy = parseStrategy(value)
						await persistSettings(current => ({ ...current, strategy }))
						recordActivity(state, {
							kind: 'configuration',
							message: 'Liquidation strategy saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
			})
		: undefined
	if (dashboard !== undefined) {
		console.log(`dashboard=${dashboard.url}`)
	}
	const actualChainId = await client.getChainId()
	if (actualChainId !== settings.network.chainId) {
		throw new Error(`Read RPC chain ${actualChainId.toString()} does not match configured chain ${settings.network.chainId.toString()}`)
	}
	await checkConnectivity(settings.connectivity, settings.network.chainId)
	for (const rpcUrl of settings.connectivity.quorumRpcUrls) {
		const chainId = await readRpcChainId(rpcUrl)
		if (chainId !== settings.network.chainId) {
			throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
		}
	}
	recordActivity(state, {
		details: `chain=${settings.network.chainId.toString()} factory=${settings.deployment.securityPoolFactory}`,
		kind: 'scan',
		message: 'Liquidator started',
		status: 'info',
	})
	let lastDryRunKey: string | undefined
	await pollUntilStopped(
		async () => {
			if (configurationMutationGate.isActive()) return false
			state.scanning = true
			state.error = undefined
			try {
				const currentChain = chainFor(settings)
				client = createPublicClient({
					chain: currentChain,
					transport: http(settings.connectivity.readRpcUrl),
				})
				const primary = await scanPools(client, settings, state.wallet)
				if (settings.runtime.execute) {
					const observations = [
						{
							endpoint: settings.connectivity.readRpcUrl,
							value: { pools: primary.pools, universes: primary.universes },
						},
					]
					for (const rpcUrl of settings.connectivity.quorumRpcUrls) {
						const quorumClient = createPublicClient({
							chain: currentChain,
							transport: http(rpcUrl),
						})
						const observation = await scanPools(quorumClient, settings, state.wallet)
						observations.push({
							endpoint: rpcUrl,
							value: { pools: observation.pools, universes: observation.universes },
						})
					}
					quorumValue('liquidation execution snapshot', observations)
				}
				const scannedBlock = await client.getBlock()
				state.pools = primary.pools
				state.universes = primary.universes
				state.walletRepByToken = primary.walletRepByToken
				state.lastScannedBlock = scannedBlock.number
				state.lastScannedTimestamp = scannedBlock.timestamp
				validateApprovedUniverseSelection(state.universes, settings.approvedUniverses)
				const inheritedSelections = inheritedChildPoolSelections(state.pools, settings.selectedPools)
				if (inheritedSelections.length > 0) {
					await persistSettings(current => ({
						...current,
						selectedPools: [...current.selectedPools, ...inheritedSelections.map(pool => pool.address)],
					}))
					for (const pool of inheritedSelections) pool.selected = true
				}
				state.lastScanAt = new Date().toISOString()
				if (state.wallet !== undefined) {
					state.walletEth = await client.getBalance({ address: state.wallet })
				}
				state.status = state.paused ? 'paused' : settings.runtime.execute ? 'running' : 'dry-run'
				if (!state.paused && settings.runtime.execute) {
					if (wallet === undefined) throw new Error('Live execution requires an active signer')
					await reconcilePendingStagedOperations(settings, wallet, state)
					if (await recoverPendingTransactions(settings, wallet, state)) {
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					const migration = selectVaultMigration(state.pools, state.universes, settings, scannedBlock.timestamp)
					if (migration !== undefined) {
						const childPool = migration.childPool
						if (childPool !== undefined && !settings.selectedPools.some(pool => pool.toLowerCase() === childPool.address.toLowerCase())) {
							await persistSettings(current => ({
								...current,
								selectedPools: [...current.selectedPools, childPool.address],
							}))
						}
						await executeVaultMigration(wallet, settings, state, migration)
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					for (const pool of state.pools) {
						if (await maintainVault(wallet, settings, state, pool)) {
							await saveDurableState(settings.runtime.stateFile, state)
							return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						}
					}
					const selected = selectedCandidate(state.pools, settings)
					if (selected !== undefined) {
						if (!settings.selectedPools.some(pool => pool.toLowerCase() === selected.pool.address.toLowerCase())) return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						const currentCandidate = evaluateCandidate(selected.candidate.pool, selected.candidate.target, selected.pool.botVault, settings.strategy)
						if (currentCandidate === undefined) return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						await executeLiquidation(wallet, settings, state, selected.pool, currentCandidate)
					}
				} else if (!state.paused) {
					const selected = selectedCandidate(state.pools, settings)
					if (selected !== undefined) {
						const dryRunKey = `${selected.pool.address}:${selected.candidate.target.address}:${selected.candidate.debtToMove.toString()}:${selected.pool.lastPrice.toString()}`
						if (dryRunKey !== lastDryRunKey) {
							dryRunCandidate(state, selected.candidate)
							lastDryRunKey = dryRunKey
						}
					}
				}
				await saveDurableState(settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(settings.runtime.once)
			} catch (error) {
				state.error = errorMessage(error)
				state.status = 'error'
				if (settings.runtime.execute) {
					state.paused = true
					await persistSettings(current => ({ ...current, paused: true })).catch(settingsError => {
						state.error = `${state.error}; failed to persist safety pause: ${errorMessage(settingsError)}`
					})
				}
				recordActivity(state, {
					details: state.error,
					kind: 'error',
					message: settings.runtime.execute ? 'Live execution paused after a failed cycle' : 'Scan cycle failed',
					status: 'failed',
				})
				await saveDurableState(settings.runtime.stateFile, state).catch(() => undefined)
				throw error
			} finally {
				state.scanning = false
			}
		},
		() => new Promise(resolve => setTimeout(resolve, settings.runtime.pollMilliseconds)),
		settings.runtime.once,
		error => console.error(`liquidator=${errorMessage(error)}`),
	)
	dashboard?.stop()
}

main().catch(error => {
	console.error(errorMessage(error))
	process.exitCode = 1
})
