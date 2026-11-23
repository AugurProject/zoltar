import { expect, test } from 'bun:test'
import { portfolioTakeoverSource } from './securityPoolPortfolioTakeover.js'

const unit = 10n ** 18n
const snapshot = { conservativePrice: (12n * unit) / 10n, liquidationPrice: (12n * unit) / 10n, securityMultiplierBps: 10_500n, totalCommitmentAttoEth: 101n * unit, demandAttoEth: 100n * unit, economics: { minimumCommitmentAttoEth: unit } }
const position = { rep: (105n * unit) / 100n, commitment: unit, batch: 0n, remainingCommitment: 0n }

test('#1254 a minimum-size cure cannot remove the commitment that still has REP backing', () => {
	expect(portfolioTakeoverSource(snapshot, position)).toMatchObject({ removed: 0n, commitment: unit, rep: position.rep, healthy: false })
})

test('a position supporting zero commitment may still be removed entirely', () => {
	expect(portfolioTakeoverSource(snapshot, { ...position, rep: 0n })).toMatchObject({ removed: unit, commitment: 0n, healthy: true })
})

test('#1571 the cure measures health at the conservative repair price, not the liquidation price', () => {
	// 2% uncertainty around 1.2: liquidation 1.17647, conservative 1.22449; 50 of nominal spare.
	const band = { ...snapshot, conservativePrice: 1224489795918367347n, liquidationPrice: 1176470588235294117n, totalCommitmentAttoEth: 200n * unit, demandAttoEth: 150n * unit }
	const source = portfolioTakeoverSource(band, { rep: (10715n * unit) / 100n, commitment: 100n * unit, batch: 0n, remainingCommitment: 0n })
	const supported = (((((10715n * unit) / 100n) * 10_000n) / 10_500n) * unit) / band.conservativePrice
	expect(source).toMatchObject({ commitment: supported, healthy: true, maximumTakeoverCommitment: 0n })
})

test('#1571 a cure limited by nominal spare does not settle the takeover', () => {
	const band = { ...snapshot, conservativePrice: 1224489795918367347n, liquidationPrice: 1176470588235294117n, totalCommitmentAttoEth: 200n * unit, demandAttoEth: 195n * unit }
	const source = portfolioTakeoverSource(band, { rep: (10715n * unit) / 100n, commitment: 100n * unit, batch: 0n, remainingCommitment: 0n })
	expect(source.removed).toBe(5n * unit)
	expect(source.healthy).toBe(false)
	expect(source.maximumTakeoverCommitment).toBeGreaterThan(0n)
})
