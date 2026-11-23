import { expect, test } from 'bun:test'
import { securityPoolTakeoverSource, securityPoolTakeoverTransfer } from './securityPoolTakeover.js'

const unit = 10n ** 18n
const snapshot = { conservativePrice: (12n * unit) / 10n, liquidationPrice: (12n * unit) / 10n, securityMultiplierBps: 10_500n, totalCommitmentAttoEth: 101n * unit, demandAttoEth: 100n * unit, economics: { minimumCommitmentAttoEth: unit } }
const position = { rep: (105n * unit) / 100n, commitment: unit, batch: 0n, remainingCommitment: 0n }

test('#1254 a minimum-size cure cannot remove the commitment that still has REP backing', () => {
	expect(securityPoolTakeoverSource(snapshot, position)).toMatchObject({ removed: 0n, commitment: unit, rep: position.rep, healthy: false })
})

test('a position supporting zero commitment may still be removed entirely', () => {
	expect(securityPoolTakeoverSource(snapshot, { ...position, rep: 0n })).toMatchObject({ removed: unit, commitment: 0n, healthy: true })
})

test('#1571 the cure measures health at the conservative repair price, not the liquidation price', () => {
	// 2% uncertainty around 1.2: liquidation 1.17647, conservative 1.22449; 50 of nominal spare.
	const band = { ...snapshot, conservativePrice: 1224489795918367347n, liquidationPrice: 1176470588235294117n, totalCommitmentAttoEth: 200n * unit, demandAttoEth: 150n * unit }
	const source = securityPoolTakeoverSource(band, { rep: (10715n * unit) / 100n, commitment: 100n * unit, batch: 0n, remainingCommitment: 0n })
	const supported = (((((10715n * unit) / 100n) * 10_000n) / 10_500n) * unit) / band.conservativePrice
	expect(source).toMatchObject({ commitment: supported, healthy: true, maximumTakeoverCommitment: 0n })
})

test('#1571 a cure limited by nominal spare does not settle the takeover', () => {
	const band = { ...snapshot, conservativePrice: 1224489795918367347n, liquidationPrice: 1176470588235294117n, totalCommitmentAttoEth: 200n * unit, demandAttoEth: 195n * unit }
	const source = securityPoolTakeoverSource(band, { rep: (10715n * unit) / 100n, commitment: 100n * unit, batch: 0n, remainingCommitment: 0n })
	expect(source.removed).toBe(5n * unit)
	expect(source.healthy).toBe(false)
	expect(source.maximumTakeoverCommitment).toBeGreaterThan(0n)
})

test('#1570 a partial takeover may not leave the source between the liquidation and conservative price', () => {
	// 5% uncertainty at P = 4.2: liquidation 4.0, conservative 4.421; 400 REP backs 100 with no nominal spare.
	const band = { ...snapshot, conservativePrice: 4421052631578947369n, liquidationPrice: 4n * unit, totalCommitmentAttoEth: 200n * unit, demandAttoEth: 200n * unit }
	const source = securityPoolTakeoverSource(band, { rep: 400n * unit, commitment: 100n * unit, batch: 0n, remainingCommitment: 0n })
	expect(source.removed).toBe(0n)
	// Keeping more than ~95.24 leaves the source below the liquidation price; keeping ~86.17 fully repairs it.
	expect(securityPoolTakeoverTransfer(source, 4n * unit)).toBe(4n * unit)
	expect(securityPoolTakeoverTransfer(source, 10n * unit)).toBeUndefined()
	expect(securityPoolTakeoverTransfer(source, 100n * unit)).toBe(source.maximumTakeoverCommitment)
	expect(securityPoolTakeoverTransfer(source, source.maximumPartialCommitment)).toBe(source.maximumPartialCommitment)
	expect(securityPoolTakeoverTransfer(source, source.maximumPartialCommitment + 1n)).toBeUndefined()
})
