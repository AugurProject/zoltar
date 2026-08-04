export type Lifecycle = 'open' | 'ended' | 'forked' | 'resolved-invalid' | 'resolved-yes' | 'resolved-no' | 'truth-auction'

export type DemoMarket = Readonly<{
	id: string
	question: string
	universe: string
	pool: `0x${string}`
	pair?: `0x${string}`
	endTime: string
	lifecycle: Lifecycle
	yesReserve: bigint
	noReserve: bigint
	feeBps: bigint
}>

const pool = `0x${'3a'.repeat(20)}` as const
const pair = `0x${'7c'.repeat(20)}` as const

export function demoMarket(scenario: string): DemoMarket {
	let lifecycle: Lifecycle = 'open'
	if (scenario === 'ended') lifecycle = 'ended'
	if (scenario === 'forked') lifecycle = 'forked'
	if (scenario === 'resolved-invalid') lifecycle = 'resolved-invalid'
	const common = {
		id: 'eth-10k-2027',
		question: 'Will ETH trade above $10,000 before 1 January 2027?',
		universe: scenario === 'forked' ? 'Parent universe · forked' : 'Genesis universe',
		pool,
		endTime: '31 Dec 2026 · 23:59 UTC',
		lifecycle,
		yesReserve: 428_571_000_000_000_000_000n,
		noReserve: 1_000_000_000_000_000_000_000n,
		feeBps: 30n,
	}
	return scenario === 'missing-pair' ? common : { ...common, pair }
}

export function lifecycleLabel(lifecycle: Lifecycle) {
	switch (lifecycle) {
		case 'open':
			return 'Trading open'
		case 'ended':
			return 'Question ended'
		case 'forked':
			return 'Parent universe forked'
		case 'resolved-invalid':
			return 'Resolved INVALID'
		case 'resolved-yes':
			return 'Resolved YES'
		case 'resolved-no':
			return 'Resolved NO'
		case 'truth-auction':
			return 'Truth auction in progress'
		default:
			throw new Error(`Unknown lifecycle: ${lifecycle}`)
	}
}

export function tradingClosedReason(lifecycle: Lifecycle) {
	return lifecycle === 'open' ? undefined : lifecycleLabel(lifecycle)
}
