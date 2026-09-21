import { renderExecutionMode, type ReadinessRow } from '@zoltar/bot-shared/dashboard/readiness'
import { shorten } from '@zoltar/bot-shared/dashboard/dom'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'

/** The parts of the sanitized snapshot the go-live checklist reads. */
export type GoLiveSnapshot = {
	execute?: boolean | undefined
	inventory: { eth?: string | number | undefined; rep: { balance?: string | number | undefined; token?: string | undefined; universeId?: string | undefined }[] }
	lastScannedBlock?: string | number | undefined
	network?: string | undefined
	obligations: readonly unknown[]
	paused?: boolean | undefined
	pendingTransactions: readonly unknown[]
	rpcHealth: { chainReady?: boolean | undefined; status?: string | undefined }
	submissionHealth: { healthyOriginCount?: number | undefined; mode?: 'private' | 'public' | undefined; ready?: boolean | undefined; requiredHealthyOriginCount?: number | undefined; status?: string | undefined }
	topology: { complete?: boolean | undefined; universes: readonly { id?: string | undefined; repToken?: string | undefined }[] }
	wallet?: string | undefined
	workflows: readonly { status?: string | undefined }[]
}

/** The parts of the loaded configuration the go-live checklist reads. */
export type GoLiveConfiguration = {
	connectivity?: { quorumRpcUrls: string[] } | undefined
	execute?: boolean | undefined
	hasSigner?: boolean | undefined
	maximumEthPerOperation?: string | number | undefined
	maximumGasCostEth?: string | number | undefined
	maximumRepPerOperation?: string | number | undefined
	minimumEthReserve?: string | number | undefined
	minimumRepReserve?: string | number | undefined
	networkConfigured?: boolean | undefined
	paused?: boolean | undefined
	rpcQuorum?: string | number | undefined
	wallet?: string | undefined
}

export function decimalAtto(value: string) {
	const [whole, fraction = ''] = value.split('.')
	if (whole === undefined) throw new Error('Decimal amount is missing its whole-number component.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

function configuredAmount(value: string | number | undefined) {
	if (value === undefined) return undefined
	const text = String(value)
	return /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(text) ? decimalAtto(text) : undefined
}

function integerAmount(value: string | number | undefined) {
	const text = value === undefined ? '' : String(value)
	return /^\d+$/.test(text) ? BigInt(text) : undefined
}

const ACTIVE_WORKFLOW_STATUSES = new Set(['running', 'waiting-continuation', 'waiting-obligation', 'waiting-transaction'])

/** The reserve rules the operator file enforces for live mode: positive reserves and an ETH floor of one gas budget. */
function reservePolicyRow(configuration: GoLiveConfiguration): ReadinessRow {
	const eth = configuredAmount(configuration.minimumEthReserve)
	const rep = configuredAmount(configuration.minimumRepReserve)
	const gas = configuredAmount(configuration.maximumGasCostEth)
	if (eth === undefined || rep === undefined || gas === undefined) return { detail: 'Waiting for the execution policy', label: 'Reserve policy', ready: false }
	if (eth === 0n || rep === 0n) return { detail: 'Set positive ETH and REP reserves under Execution policy', label: 'Reserve policy', ready: false }
	if (eth < gas) return { detail: `ETH reserve ${formatDecimalAmount(eth)} is below the ${formatDecimalAmount(gas)} ETH gas budget`, label: 'Reserve policy', ready: false }
	return { detail: `${formatDecimalAmount(eth)} ETH · ${formatDecimalAmount(rep)} REP`, label: 'Reserve policy', ready: true }
}

/** Live novelty needs the reserve plus one principal (and one gas budget for ETH) in the scanned inventory. */
function inventoryRow(snapshot: GoLiveSnapshot, configuration: GoLiveConfiguration): ReadinessRow {
	const ethReserve = configuredAmount(configuration.minimumEthReserve)
	const ethPrincipal = configuredAmount(configuration.maximumEthPerOperation)
	const gas = configuredAmount(configuration.maximumGasCostEth)
	const repReserve = configuredAmount(configuration.minimumRepReserve)
	const repPrincipal = configuredAmount(configuration.maximumRepPerOperation)
	if (ethReserve === undefined || ethPrincipal === undefined || gas === undefined || repReserve === undefined || repPrincipal === undefined) return { detail: 'Waiting for the execution policy', label: 'Live inventory', ready: false }
	const requiredEth = ethReserve + ethPrincipal + gas
	const requiredRep = repReserve + repPrincipal
	const eth = integerAmount(snapshot.inventory.eth)
	if (eth === undefined || snapshot.wallet === undefined) return { detail: `Needs ${formatDecimalAmount(requiredEth)} ETH and ${formatDecimalAmount(requiredRep)} REP · waiting for a signer scan`, label: 'Live inventory', ready: false }
	const canonical = new Set(snapshot.topology.universes.flatMap(universe => (universe.id === undefined || universe.repToken === undefined ? [] : [`${universe.id}:${universe.repToken.toLowerCase()}`])))
	let largestRep = 0n
	for (const candidate of snapshot.inventory.rep) {
		if (candidate.universeId === undefined || candidate.token === undefined || !canonical.has(`${candidate.universeId}:${candidate.token.toLowerCase()}`)) continue
		const balance = integerAmount(candidate.balance)
		if (balance !== undefined && balance > largestRep) largestRep = balance
	}
	const ethReady = eth >= requiredEth
	const repReady = largestRep >= requiredRep
	if (ethReady && repReady) return { detail: `${formatDecimalAmount(eth)} ETH · ${formatDecimalAmount(largestRep)} REP`, label: 'Live inventory', ready: true }
	const missing = [ethReady ? undefined : `${formatDecimalAmount(requiredEth)} ETH`, repReady ? undefined : `${formatDecimalAmount(requiredRep)} canonical REP`].filter(part => part !== undefined)
	return { detail: `Needs ${missing.join(' and ')}`, label: 'Live inventory', ready: false }
}

function deliveryRow(snapshot: GoLiveSnapshot): ReadinessRow {
	const health = snapshot.submissionHealth
	const mode = health.mode === 'private' ? 'Private relays' : 'Public mempool'
	const origins = `${(health.healthyOriginCount ?? 0).toString()} of ${(health.requiredHealthyOriginCount ?? 0).toString()} origins healthy`
	if (health.ready === true) return { detail: `${mode} · ${origins}`, label: 'Delivery', ready: true }
	if (health.status === 'not-configured') return { detail: 'Save the submission RPCs under Connect', label: 'Delivery', ready: false }
	if (health.status === 'stale') return { detail: `${mode} · evidence stale`, label: 'Delivery', ready: false }
	if (health.status === 'not-checked' || health.status === undefined) return { detail: `${mode} · waiting for the submission check`, label: 'Delivery', ready: false }
	return { detail: `${mode} · ${origins}`, label: 'Delivery', ready: false }
}

/**
 * The prerequisites the chaos bot enforces before it flips to live mode: a paused operator, a configured signer with a
 * fresh complete canonical scan, healthy read and submission paths, positive reserves, and inventory covering one full
 * operation. Recovery work only decides whether resumed scheduling can start novelty, so it is advisory.
 */
function readinessRows(snapshot: GoLiveSnapshot, configuration: GoLiveConfiguration): ReadinessRow[] {
	const paused = snapshot.paused === true && configuration.paused === true
	const wallet = configuration.wallet ?? snapshot.wallet
	const signer = configuration.hasSigner === true
	const requiredQuorumRpcs = String(configuration.rpcQuorum) === '2' ? 2 : 0
	const quorumRpcs = configuration.connectivity?.quorumRpcUrls.length ?? 0
	const scanComplete = snapshot.topology.complete === true && snapshot.lastScannedBlock !== undefined
	let rpcDetail = 'Save the RPC endpoints under Connect'
	if (configuration.networkConfigured === true) rpcDetail = snapshot.rpcHealth.chainReady === true ? `Ready for ${snapshot.network ?? 'the configured chain'}` : 'Read quorum is not healthy yet'
	let signerDetail = 'Set one under Transaction signer'
	if (signer) signerDetail = wallet === undefined ? 'Configured' : shorten(wallet)
	const recovery = snapshot.pendingTransactions.length + snapshot.obligations.length + snapshot.workflows.filter(workflow => workflow.status !== undefined && ACTIVE_WORKFLOW_STATUSES.has(workflow.status)).length
	return [
		{ detail: paused ? 'Paused' : 'Pause the bot before changing execution mode', label: 'Bot paused', ready: paused },
		{ detail: signerDetail, label: 'Transaction signer', ready: signer },
		{ detail: rpcDetail, label: 'Chain and RPC endpoints', ready: configuration.networkConfigured === true && snapshot.rpcHealth.chainReady === true },
		{ detail: `${quorumRpcs.toString()} configured · ${requiredQuorumRpcs.toString()} required`, label: 'Independent quorum RPCs', ready: quorumRpcs >= requiredQuorumRpcs },
		reservePolicyRow(configuration),
		{ detail: scanComplete ? `Complete at block ${String(snapshot.lastScannedBlock)}` : 'Waiting for a complete canonical scan', label: 'Canonical scan', ready: scanComplete },
		inventoryRow(snapshot, configuration),
		deliveryRow(snapshot),
		{ advisory: true, detail: recovery === 0 ? 'Clear' : `${recovery.toString()} item${recovery === 1 ? '' : 's'} · resolve before resuming`, label: 'Recovery work', ready: recovery === 0 },
	]
}

/** Live execution stays locked until every required row holds; a live operator can always return to dry run. */
export function renderGoLive(snapshot: GoLiveSnapshot, configuration: GoLiveConfiguration) {
	renderExecutionMode(readinessRows(snapshot, configuration), { live: snapshot.execute === true, queued: false, saved: configuration.execute === true })
}
