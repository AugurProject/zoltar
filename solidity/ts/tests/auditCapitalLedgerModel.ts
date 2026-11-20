// Naive reference model of the capital layer, shared with auditCapitalLedgerFuzz.test.ts.
// It keeps a flat list of positions and recomputes every aggregate by scanning it.

export const BPS = 10_000n
export const MULTIPLIER = 10_500n
export const MINC = 10n ** 15n
export const WAD = 10n ** 18n
export const PPM = 10_000_000n
export const DAY = 86_400n
export const HOUR = 3_600n
export const MAX_UINT = (1n << 256n) - 1n
export const SCALE = 1n << 96n
// Tolerated deviation, in base units, between tree apportionment and the exact rational for
// each credit event a position takes part in. See the measured maxima printed after a run.
const DUST_PER_CREDIT = 12n
export const OWNER_COUNT = 24
export const ADAPTER = -1

export const min = (a: bigint, b: bigint) => (a < b ? a : b)
export const max = (a: bigint, b: bigint) => (a > b ? a : b)
export const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n)
export const abs = (a: bigint) => (a < 0n ? -a : a)
const ascending = (a: bigint, b: bigint) => {
	if (a < b) return -1
	return a > b ? 1 : 0
}

export const requiredRep = (commitment: bigint, price: bigint, health: bigint) => {
	const base = ceilDiv(ceilDiv(commitment * price, WAD) * MULTIPLIER, BPS)
	return ceilDiv(base * health, BPS)
}
export const maxHealthyPrice = (rep: bigint, commitment: bigint) => (commitment === 0n ? MAX_UINT : (((rep * BPS) / MULTIPLIER) * WAD) / commitment)

export class ModelRevert extends Error {
	constructor(readonly reason: string) {
		super(reason)
	}
}
const fail = (reason: string): never => {
	throw new ModelRevert(reason)
}
const requireModel = (condition: boolean, reason: string) => {
	if (!condition) fail(reason)
}

type ModelOwner = {
	free: bigint
	target: bigint
	positionId: bigint
	exported: boolean
	// Scaled by SCALE: every fee ever settled into the owner account.
	settledEth: bigint
	settledRep: bigint
	dust: bigint
	// Actual base units already paid out.
	claimedEth: bigint
	claimedRep: bigint
	walletRep: bigint
}
export type ModelPosition = {
	id: bigint
	owner: number
	batch: bigint
	rep: bigint
	k: bigint
	price: bigint
	remaining: bigint
	order: bigint
	retired: boolean
	repClaimed: boolean
	distress: bigint | undefined
	ethFees: bigint
	repFees: bigint
	dust: bigint
}
type ModelBid = { owner: number; health: bigint; lots: bigint; positionId: bigint }
export type Model = {
	now: bigint
	accepted: bigint
	cons: bigint
	liq: bigint
	epoch: bigint
	harnessEpoch: bigint
	priceError: bigint
	validUntil: bigint
	demand: bigint
	totalFree: bigint
	retCash: bigint
	frozen: boolean
	importing: boolean
	everImported: boolean
	forkTime: bigint
	frozenBacking: bigint
	backingReleased: boolean
	owners: ModelOwner[]
	positions: ModelPosition[]
	currentBatch: bigint
	nextBatch: bigint
	lastBatch: bigint
	observedPrice: bigint
	streams: { start: bigint; end: bigint; eth: bigint; rep: bigint }[]
	releasedThrough: bigint
	fundedEth: bigint
	fundedRep: bigint
	burnedEth: bigint
	burnedRep: bigint
	creditEvents: bigint
	cohortId: bigint
	cohortLots: bigint
	repPerLot: bigint
	bids: Record<string, ModelBid>
	mockLots: bigint
	mockEth: bigint
	mockRep: bigint
	mockDust: bigint
	mintedToLedger: bigint
	genesisSupply: bigint
}

export const newModel = (now: bigint, releasedThrough: bigint, wallet: bigint, genesisSupply: bigint): Model => ({
	now,
	accepted: 0n,
	cons: 0n,
	liq: 0n,
	epoch: 0n,
	harnessEpoch: 0n,
	priceError: 0n,
	validUntil: 0n,
	demand: 0n,
	totalFree: 0n,
	retCash: 0n,
	frozen: false,
	importing: false,
	everImported: false,
	forkTime: 0n,
	frozenBacking: 0n,
	backingReleased: false,
	owners: Array.from({ length: OWNER_COUNT }, () => ({ free: 0n, target: 0n, positionId: 0n, exported: false, settledEth: 0n, settledRep: 0n, dust: 0n, claimedEth: 0n, claimedRep: 0n, walletRep: wallet })),
	positions: [],
	currentBatch: 0n,
	nextBatch: 1n,
	lastBatch: 1n,
	observedPrice: 0n,
	streams: [],
	releasedThrough,
	fundedEth: 0n,
	fundedRep: 0n,
	burnedEth: 0n,
	burnedRep: 0n,
	creditEvents: 0n,
	cohortId: 0n,
	cohortLots: 0n,
	repPerLot: 0n,
	bids: {},
	mockLots: 0n,
	mockEth: 0n,
	mockRep: 0n,
	mockDust: 0n,
	mintedToLedger: 0n,
	genesisSupply,
})

// ---------------------------------------------------------------- model primitives

export const ownerOf = (m: Model, o: number) => {
	const owner = m.owners[o]
	if (owner === undefined) throw new Error(`Model owner ${o} missing`)
	return owner
}
export const findPosition = (m: Model, id: bigint) => (id === 0n ? undefined : m.positions[Number(id) - 1])
export const positionOf = (m: Model, id: bigint) => {
	const position = findPosition(m, id)
	if (position === undefined) throw new Error(`Model position ${id} missing`)
	return position
}
export const inTree = (p: ModelPosition) => !p.retired && p.k !== 0n
export const live = (m: Model) => m.positions.filter(inTree)
const cohort = (m: Model, batch: bigint) =>
	live(m)
		.filter(p => p.batch === batch)
		.sort((a, b) => ascending(a.price, b.price) || ascending(a.id, b.id))
export const eligible = (m: Model, price: bigint) => live(m).reduce((sum, p) => sum + (p.price >= price ? p.k : 0n), 0n)
const activeCommitment = (p: { batch: bigint; k: bigint; remaining: bigint }) => (p.batch === 0n ? p.k : p.remaining)
export const eligibleActive = (m: Model, price: bigint) => live(m).reduce((sum, p) => sum + (p.price >= price ? activeCommitment(p) : 0n), 0n)
export const totalCommitment = (m: Model) => live(m).reduce((sum, p) => sum + p.k, 0n)
export const totalRep = (m: Model) => live(m).reduce((sum, p) => sum + p.rep, 0n)
export const priceValid = (m: Model) => m.accepted > 0n && m.now < m.validUntil
export const targetOf = (owner: ModelOwner) => (owner.target === 0n ? BPS : owner.target)
export const started = (m: Model, id: bigint) => {
	const p = findPosition(m, id)
	if (p === undefined || !inTree(p) || p.price >= m.observedPrice) return 0n
	return p.distress ?? 0n
}
const requireOpen = (m: Model) => requireModel(!m.importing && m.forkTime === 0n && !m.frozen, 'Capital universe inactive')
const requireFresh = (m: Model) => requireModel(priceValid(m), 'Capital price stale')

export const integral = (m: Model, at: bigint) => {
	let eth = 0n
	let rep = 0n
	for (const stream of m.streams) {
		if (at >= stream.end) {
			eth += stream.eth * DAY
			rep += stream.rep * DAY
		} else if (at > stream.start) {
			eth += stream.eth * (at - stream.start)
			rep += stream.rep * (at - stream.start)
		}
	}
	return [eth / DAY, rep / DAY] as const
}
const release = (m: Model, until: bigint) => {
	const [beforeEth, beforeRep] = integral(m, m.releasedThrough)
	const [afterEth, afterRep] = integral(m, until)
	m.releasedThrough = until
	return [afterEth - beforeEth, afterRep - beforeRep] as const
}
const burn = (m: Model, eth: bigint, rep: bigint) => {
	m.burnedEth += eth
	m.burnedRep += rep
}
const creditEarnings = (m: Model, eth: bigint, rep: bigint) => {
	if (eth === 0n && rep === 0n) return
	const price = m.accepted === 0n ? 0n : m.cons
	const total = totalCommitment(m)
	const recipients = price === 0n ? [] : live(m).filter(p => p.price >= price)
	const share = recipients.reduce((sum, p) => sum + p.k, 0n)
	const assignedEth = total === 0n ? 0n : (eth * share) / total
	const assignedRep = total === 0n ? 0n : (rep * share) / total
	if (share !== 0n) {
		requireModel(!m.importing, 'Commitment imports are open')
		m.creditEvents++
		for (const p of recipients) {
			p.ethFees += (assignedEth * p.k * SCALE) / share
			p.repFees += (assignedRep * p.k * SCALE) / share
			p.dust += DUST_PER_CREDIT
		}
	}
	burn(m, eth - assignedEth, rep - assignedRep)
}
export const checkpoint = (m: Model) => {
	if (m.importing) return
	const effective = m.forkTime !== 0n ? min(m.now, m.forkTime) : m.now
	// Prepaid fees belong to the existing backing through stale live time.
	// A terminal parent without a fresh fork-time price stops at its fork.
	const through = m.forkTime !== 0n && m.forkTime >= m.validUntil ? effective : m.now
	let eth = 0n
	let rep = 0n
	if (through > m.releasedThrough) [eth, rep] = release(m, through)
	if (m.now > m.releasedThrough) {
		const [staleEth, staleRep] = release(m, m.now)
		burn(m, staleEth, staleRep)
	}
	creditEarnings(m, eth, rep)
}
const settle = (m: Model, o: number) => {
	const owner = ownerOf(m, o)
	if (owner.positionId === 0n) return
	requireModel(!m.importing, 'Commitment imports are open')
	const p = positionOf(m, owner.positionId)
	if (p.retired && !p.repClaimed) {
		p.repClaimed = true
		owner.free += p.rep
		m.totalFree += p.rep
		m.retCash -= p.rep
	}
	owner.settledEth += p.ethFees
	owner.settledRep += p.repFees
	owner.dust += p.dust
	p.ethFees = 0n
	p.repFees = 0n
	p.dust = 0n
	if (!inTree(p)) owner.positionId = 0n
}
const clear = (p: ModelPosition) => {
	p.distress = undefined
}
const reinsert = (p: ModelPosition) => {
	if (p.remaining !== 0n && p.k <= p.remaining) {
		p.remaining = 0n
		p.batch = 0n
	}
}
const indexReplace = (m: Model, id: bigint, rep: bigint, k: bigint, price: bigint) => {
	const p = findPosition(m, id)
	if (p === undefined) return fail('Unknown commitment position')
	requireModel(inTree(p), 'Position is not live')
	if (p.batch === m.currentBatch && m.currentBatch !== 0n) requireModel(k <= p.k, 'Closed retirement commitment cannot increase')
	p.rep = rep
	p.k = k
	p.price = price
	if (k === 0n) requireModel(rep === 0n, 'Uncommitted REP must leave index')
	reinsert(p)
}
const ledgerReplace = (m: Model, id: bigint, rep: bigint, k: bigint) => {
	const price = maxHealthyPrice(rep, k)
	indexReplace(m, id, rep, k, price)
	if (k === 0n || (priceValid(m) && price >= m.liq)) clear(positionOf(m, id))
}
const create = (m: Model, owner: number, batch: bigint, rep: bigint, k: bigint, price: bigint, remaining: bigint) => {
	requireModel(k !== 0n, 'Invalid commitment position')
	const id = BigInt(m.positions.length + 1)
	const order = batch === 0n ? 0n : m.positions.reduce((last, p) => max(last, p.order), 0n) + 1n
	m.positions.push({ id, owner, batch, rep, k, price, remaining, order, retired: false, repClaimed: false, distress: undefined, ethFees: 0n, repFees: 0n, dust: 0n })
	return id
}
const promote = (m: Model) => {
	if (m.currentBatch !== 0n && cohort(m, m.currentBatch).length !== 0) return
	m.currentBatch = 0n
	if (cohort(m, m.nextBatch).length === 0) return
	m.currentBatch = m.nextBatch
	m.nextBatch = ++m.lastBatch
}
type Retirement = { rep: bigint; k: bigint; boundary: bigint }
type Preview = { status: 'NotRetiring' | 'DemandExceedsHealthy' | 'EarlierRequests' | 'InsufficientSpare' | 'Ready'; reduction: bigint }
const previewRetirement = (m: Model, id: bigint): Preview => {
	const p = findPosition(m, id)
	if (p === undefined || !inTree(p) || p.batch === 0n) return { status: 'NotRetiring', reduction: 0n }
	const reduction = p.k - p.remaining
	const healthy = eligible(m, m.cons)
	const spare = healthy > m.demand ? healthy - m.demand : 0n
	const ahead = live(m)
		.filter(q => q.batch !== 0n && q.order < p.order)
		.reduce((sum, q) => sum + q.k - q.remaining, 0n)
	if (healthy < m.demand) return { status: 'DemandExceedsHealthy', reduction }
	if (spare < ahead) return { status: 'EarlierRequests', reduction }
	if (p.price >= m.cons && spare - ahead < reduction) return { status: 'InsufficientSpare', reduction }
	return { status: 'Ready', reduction }
}
const retireOne = (m: Model, id: bigint): Retirement => {
	const result = { rep: 0n, k: 0n, boundary: 0n }
	const preview = previewRetirement(m, id)
	requireModel(preview.status !== 'NotRetiring', 'Position is not retiring')
	promote(m)
	if (preview.status !== 'Ready') return result
	const p = positionOf(m, id)
	result.k = preview.reduction
	if (p.remaining === 0n) {
		result.rep = p.rep
		p.retired = true
	} else {
		p.k = p.remaining
		reinsert(p)
		result.boundary = id
	}
	return result
}
export const serve = (m: Model, id: bigint) => {
	requireModel(id === 0n || id !== m.cohortId, 'Materialize an individual auction vault')
	const pending = findPosition(m, id)
	if (id === 0n || pending === undefined || !inTree(pending) || pending.batch === 0n || !priceValid(m) || m.frozen || m.forkTime !== 0n) return
	const result = retireOne(m, id)
	m.retCash += result.rep
	if (result.boundary !== 0n) {
		const boundary = positionOf(m, result.boundary)
		ledgerReplace(m, boundary.id, boundary.rep, boundary.k)
	}
}
export const cure = (m: Model, id: bigint, target: bigint, ownerExit: boolean) => {
	requireModel(id !== 0n && id !== m.cohortId, 'Materialize an individual auction vault')
	const p = findPosition(m, id)
	if (p === undefined || !inTree(p) || !(p.k > target)) return fail('Position is not live')
	const supported = (((p.rep * BPS) / MULTIPLIER) * WAD) / m.liq
	if (supported >= p.k) {
		clear(p)
		return 0n
	}
	const total = totalCommitment(m)
	const spare = total > m.demand ? total - m.demand : 0n
	const reduction = p.k - supported
	let removed = min(p.k - target, min(max(reduction, MINC), spare))
	if (removed < MINC && removed !== p.k) removed = 0n
	const rest = p.k - target - removed
	if (!ownerExit && rest !== 0n && rest < MINC) {
		if (removed >= MINC && p.k - target <= spare) removed = p.k - target
		else {
			const shortfall = MINC - rest
			removed = removed >= MINC + shortfall ? removed - shortfall : 0n
		}
	}
	// A cure may not release principal while any commitment remains supported.
	if (p.rep !== 0n && removed === p.k) removed = 0n
	const remaining = p.k - removed
	if (removed !== 0n) {
		if (remaining === 0n) {
			const freed = p.rep
			indexReplace(m, id, 0n, 0n, 0n)
			if (p.owner !== ADAPTER) ownerOf(m, p.owner).free += freed
			m.totalFree += freed
		} else indexReplace(m, id, p.rep, remaining, maxHealthyPrice(p.rep, remaining))
	}
	if (remaining <= supported) clear(p)
	return removed
}
const observe = (m: Model) => {
	m.observedPrice = m.liq
	for (const p of live(m)) {
		if (p.price >= m.liq) p.distress = undefined
		else if (p.distress === undefined) p.distress = m.now
	}
}
export const virtualBid = (m: Model, o: number) => Object.values(m.bids).find(bid => m.cohortId !== 0n && bid.owner === o && bid.positionId === 0n && bid.lots !== 0n)
export const collateral = (m: Model, o: number) => {
	const owner = ownerOf(m, o)
	const p = findPosition(m, owner.positionId)
	const bid = virtualBid(m, o)
	const released = p?.retired && !p.repClaimed ? p.rep : 0n
	let withdrawable = owner.free + released
	const pledged = (p !== undefined && inTree(p) ? p.rep : 0n) + (bid === undefined ? 0n : bid.lots * m.repPerLot)
	const principal = withdrawable + pledged
	const commitment = (p !== undefined && inTree(p) ? p.k : 0n) + (bid === undefined ? 0n : bid.lots * MINC)
	if (commitment === 0n) return { principal, commitment, withdrawable: principal }
	if (m.importing || m.frozen || owner.exported || m.forkTime !== 0n || !priceValid(m) || eligible(m, m.cons) < m.demand) return { principal, commitment, withdrawable }
	const withdrawalCommitment = p !== undefined && inTree(p) && p.batch !== 0n && previewRetirement(m, p.id).status === 'Ready' ? commitment - p.k + p.remaining : commitment
	const required = requiredRep(withdrawalCommitment, m.cons, bid === undefined ? targetOf(owner) : bid.health)
	if (pledged > required) withdrawable += pledged - required
	return { principal, commitment, withdrawable }
}

// ---------------------------------------------------------------- operations

export type Bounds = { maximumOwnerPrincipal: bigint; maximumOwnerCommitment: bigint; expectedTargetHealthFactorBps: bigint; expectedAcceptedPriceEpoch: bigint; expectedSourceBatch: bigint }
export type Operation =
	| { c: 'time'; dt: bigint }
	| { c: 'priceError'; value: bigint }
	| { c: 'price'; price: bigint; until: bigint }
	| { c: 'price2'; first: bigint; second: bigint; until: bigint }
	| { c: 'demand'; value: bigint }
	| { c: 'syncDemand'; value: bigint }
	| { c: 'deposit'; o: number; amount: bigint; sponsored?: boolean }
	| { c: 'depositTarget'; o: number; amount: bigint; target: bigint }
	| { c: 'withdraw'; o: number; amount: bigint; to: number; sponsored?: boolean }
	| { c: 'target'; o: number; target: bigint; sponsored?: boolean }
	| { c: 'commit'; o: number; value: bigint; sponsored?: boolean }
	| { c: 'serve'; o: number; id: bigint; sponsored?: boolean }
	| { c: 'claim'; o: number; sponsored?: boolean }
	| { c: 'takeover'; o: number; id: bigint; k: bigint; minAward: bigint; maxOwn: bigint; bounds: Bounds | undefined; sponsored?: boolean }
	| { c: 'takeoverBid'; o: number; bid: bigint; k: bigint; minAward: bigint; maxOwn: bigint; bounds: Bounds }
	| { c: 'fundEth'; amount: bigint }
	| { c: 'fundRep'; amount: bigint }
	| { c: 'creditTimed'; amount: bigint }
	| { c: 'checkpoint'; o: number }
	| { c: 'materialize'; o: number; bid: bigint }
	| { c: 'beginImport' }
	| { c: 'installAuction'; lots: bigint; repPerLot: bigint }
	| { c: 'setBid'; bid: bigint; o: number; health: bigint; lots: bigint }
	| { c: 'importChoice'; o: number; rep: bigint; k: bigint; batch: bigint; remaining: bigint; target: bigint }
	| { c: 'finishImport'; demand: bigint }
	| { c: 'fork'; back: bigint; freeze: boolean }
	| { c: 'export'; o: number }
	| { c: 'releaseBacking' }

export type TakeoverResult = { cured: boolean; full: boolean; merged: boolean; award: bigint; debit: bigint; sourceOwner: number; sourceBatch: bigint; receiverPrincipal: bigint; receiverCommitment: bigint }
const takeover = (m: Model, o: number, id: bigint, k: bigint, minAward: bigint, maxOwn: bigint, bounds: Bounds | undefined, sponsored = false): TakeoverResult => {
	requireModel(minAward === 0n, 'Repairs pay future income only')
	if (started(m, id) === 0n) fail('Adverse observation missing')
	const source = positionOf(m, id)
	requireModel(source.owner !== o && source.price < m.liq, 'Position does not need takeover')
	requireModel(k > 0n && k <= source.k, 'Invalid takeover commitment')
	if (cure(m, id, 0n, false) !== 0n && (!inTree(source) || source.price >= m.liq)) {
		requireModel(minAward === 0n, 'Takeover award below minimum')
		return { cured: true, full: false, merged: false, award: 0n, debit: 0n, sourceOwner: source.owner, sourceBatch: source.batch, receiverPrincipal: 0n, receiverCommitment: 0n }
	}
	requireModel(source.owner !== o && source.price < m.liq, 'Position does not need takeover')
	const start = started(m, id)
	requireModel(start !== 0n, 'Adverse observation missing')
	requireModel(k > 0n, 'Invalid takeover commitment')
	const supported = (((source.rep * BPS) / MULTIPLIER) * WAD) / m.cons
	const retained = max(supported, MINC)
	requireModel(source.k > retained, 'Position requires additional backing')
	k = min(k, source.k - retained)
	const award = 0n
	const debit = 0n
	settle(m, o)
	const receiver = ownerOf(m, o)
	const sourceBatch = source.batch
	if (bounds !== undefined) {
		// A report-sponsored takeover may leave the epoch open: it runs inside the report it funds.
		requireModel(m.epoch === bounds.expectedAcceptedPriceEpoch || (bounds.expectedAcceptedPriceEpoch === 0n && sponsored), 'Takeover price epoch changed')
		requireModel(targetOf(receiver) === bounds.expectedTargetHealthFactorBps, 'Takeover owner target changed')
		requireModel(sourceBatch === bounds.expectedSourceBatch, 'Takeover source cohort changed')
	}
	const existing = findPosition(m, receiver.positionId)
	const existingRep = existing === undefined ? 0n : existing.rep
	const existingK = existing === undefined ? 0n : existing.k
	if (existing !== undefined) requireModel(existing.batch === 0n || existing.batch === sourceBatch, 'Receiver retirement differs')
	const free = receiver.free
	requireModel(free <= maxOwn, 'Receiver consent exceeded')
	requireModel(existingRep + award + free >= requiredRep(existingK + k, m.cons, targetOf(receiver)), 'Receiver collateral insufficient')
	requireModel(existingK + k >= MINC, 'Receiver commitment below minimum')
	const remainingK = source.k - k
	const remainingRep = source.rep - debit
	const received = award + free
	if (bounds !== undefined) {
		requireModel(existingRep + received <= bounds.maximumOwnerPrincipal, 'Takeover owner principal exceeds limit')
		requireModel(existingK + k <= bounds.maximumOwnerCommitment, 'Takeover owner commitment exceeds limit')
	}
	source.rep = remainingRep
	source.k = remainingK
	source.price = maxHealthyPrice(remainingRep, remainingK)
	let transferred = 0n
	if (source.remaining > source.k) {
		transferred = source.remaining - source.k
		source.remaining = source.k
	}
	reinsert(source)
	let receiverId = receiver.positionId
	if (existing === undefined) {
		receiverId = create(m, o, sourceBatch, debit, k, maxHealthyPrice(received, k), transferred)
		receiver.positionId = receiverId
	} else {
		existing.rep += debit
		existing.k += k
		if (existing.batch !== 0n) {
			existing.remaining += transferred
			existing.order = m.positions.reduce((last, q) => max(last, q.order), 0n) + 1n
		}
		reinsert(existing)
	}
	ledgerReplace(m, receiverId, existingRep + received, existingK + k)
	if (remainingK === 0n || (priceValid(m) && source.price >= m.liq)) clear(source)
	receiver.free -= free
	m.totalFree -= free
	if (source.owner !== ADAPTER) ownerOf(m, source.owner).free += debit - award
	m.totalFree += debit - award
	return { cured: false, full: remainingK === 0n, merged: existing !== undefined, award, debit, sourceOwner: source.owner, sourceBatch, receiverPrincipal: existingRep + received, receiverCommitment: existingK + k }
}
const materialize = (m: Model, bidId: bigint) => {
	requireModel(!m.importing && m.cohortId !== 0n && bidId !== 0n, 'Auction capital unavailable')
	const bid = m.bids[bidId.toString()]
	if (bid === undefined) return fail('Auction vault missing')
	if (bid.positionId !== 0n || bid.lots === 0n) return bid.positionId
	requireModel(bid.lots <= m.cohortLots && bid.health >= BPS, 'Invalid auction position')
	const owner = ownerOf(m, bid.owner)
	requireModel(owner.positionId === 0n && owner.free === 0n && !owner.exported, 'Auction vault already has principal')
	const source = positionOf(m, m.cohortId)
	m.mockEth += source.ethFees
	m.mockRep += source.repFees
	m.mockDust += source.dust
	source.ethFees = 0n
	source.repFees = 0n
	source.dust = 0n
	const ownedEth = (m.mockEth * bid.lots) / m.mockLots
	const ownedRep = (m.mockRep * bid.lots) / m.mockLots
	m.mockEth -= ownedEth
	m.mockRep -= ownedRep
	m.mockLots -= bid.lots
	const principal = bid.lots * m.repPerLot
	const k = bid.lots * MINC
	requireModel(inTree(source) && source.batch === 0n, 'Auction position is not active')
	requireModel(k <= source.k && (source.rep * k) / source.k === principal && (source.rep * k) % source.k === 0n, 'Auction split must be proportional')
	source.rep -= principal
	source.k -= k
	const id = create(m, bid.owner, 0n, principal, k, source.price, 0n)
	positionOf(m, id).distress = source.distress
	bid.positionId = id
	m.cohortLots -= bid.lots
	owner.positionId = id
	owner.target = bid.health
	owner.settledEth += ownedEth
	owner.settledRep += ownedRep
	// The adapter mock floors each bidder's share of the cohort's own tree-rounded fees.
	owner.dust += m.mockDust + 2n
	return id
}

/** Apply one operation at `m.now`, the timestamp of the block that mines it. */
export const applyModel = (m: Model, op: Operation): TakeoverResult | undefined => {
	switch (op.c) {
		case 'time':
			return undefined
		case 'priceError':
			m.priceError = op.value
			return undefined
		case 'price':
		case 'price2': {
			if (op.c === 'price2') checkpoint(m)
			for (const price of op.c === 'price' ? [op.price] : [op.first, op.second]) {
				m.harnessEpoch++
				requireModel(m.forkTime === 0n, 'Fork price already frozen')
				requireModel(price > 0n && op.until > m.now, 'Invalid capital price')
				checkpoint(m)
				requireModel(m.priceError < PPM, 'Invalid oracle uncertainty')
				m.epoch = m.harnessEpoch
				m.accepted = price
				m.cons = ceilDiv(price * PPM, PPM - m.priceError)
				m.liq = (price * PPM) / (PPM + m.priceError)
				requireModel(m.liq !== 0n, 'Liquidation price rounds to zero')
				if (!m.importing && m.now >= m.validUntil) {
					for (const position of live(m)) position.distress = undefined
				}
				m.validUntil = op.until
				if (!m.importing) observe(m)
			}
			return undefined
		}
		case 'demand':
			requireOpen(m)
			checkpoint(m)
			if (op.value > m.demand) {
				requireFresh(m)
				serve(m, 0n)
				requireModel(op.value <= eligibleActive(m, m.cons), 'Healthy commitment insufficient')
			}
			m.demand = op.value
			serve(m, 0n)
			return undefined
		case 'syncDemand':
			requireModel(op.value <= m.demand, 'Sync cannot add demand')
			m.demand = op.value
			return undefined
		case 'deposit':
		case 'depositTarget': {
			requireOpen(m)
			requireModel(op.amount > 0n, 'Invalid capital deposit')
			checkpoint(m)
			settle(m, op.o)
			const owner = ownerOf(m, op.o)
			if (owner.positionId === 0n) {
				owner.free += op.amount
				m.totalFree += op.amount
			} else {
				const p = positionOf(m, owner.positionId)
				ledgerReplace(m, p.id, p.rep + op.amount, p.k)
			}
			requireModel(owner.walletRep >= op.amount, 'TOKEN')
			owner.walletRep -= op.amount
			serve(m, 0n)
			if (op.c === 'deposit') return undefined
			return applyModel(m, { c: 'target', o: op.o, target: op.target })
		}
		case 'target': {
			requireOpen(m)
			requireModel(op.target >= BPS, 'Health below protocol floor')
			checkpoint(m)
			settle(m, op.o)
			const owner = ownerOf(m, op.o)
			if (owner.positionId !== 0n && op.target > targetOf(owner)) {
				requireFresh(m)
				const p = positionOf(m, owner.positionId)
				requireModel(p.rep >= requiredRep(p.k, m.cons, op.target), 'Chosen health target unmet')
			}
			owner.target = op.target
			return undefined
		}
		case 'withdraw': {
			checkpoint(m)
			serve(m, ownerOf(m, op.o).positionId)
			requireModel(op.amount > 0n, 'Invalid capital withdrawal')
			settle(m, op.o)
			const owner = ownerOf(m, op.o)
			const free = min(op.amount, owner.free)
			owner.free -= free
			m.totalFree -= free
			const pledged = op.amount - free
			if (pledged !== 0n) {
				requireModel(owner.positionId !== 0n, 'Insufficient owner principal')
				requireOpen(m)
				requireFresh(m)
				requireModel(eligible(m, m.cons) >= m.demand, 'Portfolio backing insufficient')
				const p = positionOf(m, owner.positionId)
				requireModel(pledged <= p.rep && p.rep - pledged >= requiredRep(p.k, m.cons, targetOf(owner)), 'Owner collateral too low')
				const price = maxHealthyPrice(p.rep - pledged, p.k)
				indexReplace(m, p.id, p.rep - pledged, p.k, price)
				if (price >= m.liq) clear(p)
			}
			ownerOf(m, op.to).walletRep += op.amount
			return undefined
		}
		case 'commit': {
			requireOpen(m)
			checkpoint(m)
			serve(m, 0n)
			settle(m, op.o)
			const owner = ownerOf(m, op.o)
			const p = findPosition(m, owner.positionId)
			const pending = p !== undefined && p.batch !== 0n
			requireModel(!pending || op.value === p.remaining, 'Retirement pending')
			const current = p === undefined ? 0n : p.k
			if (op.value >= current) {
				requireFresh(m)
				requireModel(op.value >= MINC, 'Commitment below minimum')
				const rep = owner.free + (p === undefined ? 0n : p.rep)
				requireModel(rep >= requiredRep(op.value, m.cons, targetOf(owner)), 'Chosen health target unmet')
				m.totalFree -= owner.free
				owner.free = 0n
				const price = maxHealthyPrice(rep, op.value)
				if (p === undefined) owner.positionId = create(m, op.o, 0n, rep, op.value, price, 0n)
				else {
					indexReplace(m, p.id, rep, op.value, price)
					if (price >= m.liq) clear(p)
				}
				return undefined
			}
			if (p === undefined) throw new Error('Model reduction without a position')
			requireModel(op.value === 0n || op.value >= MINC, 'Commitment below minimum')
			let left = current
			if (priceValid(m)) left -= cure(m, p.id, op.value, op.value === 0n)
			if (left > op.value && !pending) {
				requireModel(p.batch === 0n && p.k !== 0n, 'Position is not active')
				requireModel(op.value === 0n || (op.value >= MINC && p.k - op.value >= MINC), 'Retirement below economic minimum')
				p.batch = m.nextBatch
				p.order = m.positions.reduce((last, q) => max(last, q.order), 0n) + 1n
				p.remaining = op.value
			}
			serve(m, p.id)
			return undefined
		}
		case 'serve':
			requireOpen(m)
			requireModel(op.id !== 0n && findPosition(m, op.id)?.owner === op.o, 'Only retirement owner')
			checkpoint(m)
			serve(m, op.id)
			return undefined
		case 'claim':
			checkpoint(m)
			settle(m, op.o)
			return undefined
		case 'takeover':
			requireOpen(m)
			requireFresh(m)
			requireModel(op.minAward === 0n, 'Repairs pay future income only')
			checkpoint(m)
			serve(m, 0n)
			return takeover(m, op.o, op.id, op.k, op.minAward, op.maxOwn, op.bounds, op.sponsored === true)
		case 'takeoverBid': {
			requireOpen(m)
			requireFresh(m)
			checkpoint(m)
			const id = materialize(m, op.bid)
			serve(m, 0n)
			return takeover(m, op.o, id, op.k, op.minAward, op.maxOwn, op.bounds)
		}
		case 'fundEth':
		case 'fundRep': {
			requireModel(!m.importing, 'Capital imports are not complete')
			checkpoint(m)
			requireModel(op.amount !== 0n, 'Empty fee stream')
			const eth = op.c === 'fundEth' ? op.amount : 0n
			const rep = op.c === 'fundRep' ? op.amount : 0n
			m.streams.push({ start: m.now, end: m.now + DAY, eth, rep })
			m.fundedEth += eth
			m.fundedRep += rep
			return undefined
		}
		case 'creditTimed':
			m.fundedEth += op.amount
			creditEarnings(m, op.amount, 0n)
			return undefined
		case 'checkpoint':
			checkpoint(m)
			return undefined
		case 'materialize':
			checkpoint(m)
			materialize(m, op.bid)
			return undefined
		case 'beginImport':
			requireModel(totalRep(m) === 0n && totalCommitment(m) === 0n && !m.importing, 'Capital already used')
			requireModel(!m.everImported && m.positions.length === 0, 'Commitment imports already initialized')
			m.importing = true
			m.everImported = true
			m.currentBatch = 1n
			m.nextBatch = 2n
			m.lastBatch = 2n
			return undefined
		case 'installAuction': {
			requireModel(m.importing && m.cohortId === 0n, 'Auction cohort installation unavailable')
			requireModel(op.lots !== 0n && op.repPerLot !== 0n, 'Invalid auction cohort')
			requireModel((op.repPerLot * BPS) % MULTIPLIER === 0n, 'Auction collateral ratio rounds per vault')
			m.mintedToLedger += op.lots * op.repPerLot
			m.cohortId = create(m, ADAPTER, 0n, op.lots * op.repPerLot, op.lots * MINC, maxHealthyPrice(op.repPerLot, MINC), 0n)
			m.cohortLots = op.lots
			m.repPerLot = op.repPerLot
			return undefined
		}
		case 'setBid':
			requireModel(m.bids[op.bid.toString()] === undefined && Object.values(m.bids).every(bid => bid.owner !== op.o), 'Duplicate test bid')
			m.bids[op.bid.toString()] = { owner: op.o, health: op.health, lots: op.lots, positionId: 0n }
			m.mockLots += op.lots
			return undefined
		case 'importChoice': {
			requireModel(m.importing && op.target >= BPS, 'Fork import unavailable')
			const owner = ownerOf(m, op.o)
			requireModel(owner.positionId === 0n && owner.free === 0n, 'Owner already imported')
			owner.target = op.target
			requireModel(op.k !== 0n && op.rep !== 0n, 'Empty fork choice')
			requireModel(op.batch === 0n || op.batch === m.currentBatch || op.batch === m.nextBatch, 'Unknown imported cohort')
			requireModel(op.remaining < op.k && (op.batch !== 0n || op.remaining === 0n), 'Invalid imported retirement target')
			owner.positionId = create(m, op.o, op.batch, op.rep, op.k, maxHealthyPrice(op.rep, op.k), op.remaining)
			m.mintedToLedger += op.rep
			return undefined
		}
		case 'finishImport':
			requireModel(m.importing, 'Fork import unavailable')
			m.importing = false
			m.demand = op.demand
			if (priceValid(m)) observe(m)
			return undefined
		case 'fork':
			// The mock sets the native fork time; the ledger freezes in the same or a later transaction.
			if (m.forkTime === 0n) m.forkTime = m.now - op.back
			if (!op.freeze || m.frozen) return undefined
			checkpoint(m)
			m.frozenBacking = totalRep(m)
			m.frozen = true
			return undefined
		case 'export': {
			const owner = ownerOf(m, op.o)
			requireModel(m.frozen && !owner.exported, 'Fork choice unavailable')
			settle(m, op.o)
			owner.exported = true
			return undefined
		}
		case 'releaseBacking':
			requireModel(m.frozen && !m.backingReleased, 'Fork backing release unavailable')
			m.backingReleased = true
			return undefined
		default:
			throw new Error('Unknown operation')
	}
}
