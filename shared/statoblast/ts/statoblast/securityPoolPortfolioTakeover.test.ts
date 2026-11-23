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

test('half-hour quotes account for the source REP bonus before sizing the commitment transfer', () => {
	const state = { ...snapshot, timestamp: 2800n, conservativePrice: unit, liquidationPrice: unit, securityMultiplierBps: 20_000n, totalCommitmentAttoEth: 100n * unit }
	const target = { ...position, rep: 150n * unit, commitment: 100n * unit, liquidationStarted: 1000n, liquidationAwarded: 0n }
	expect(portfolioTakeoverSource(state, target)).toMatchObject({ maximumTakeoverAward: 75n * unit, maximumTakeoverCommitment: (625n * unit) / 10n })
	const remainder = { ...target, rep: (1125n * unit) / 10n, commitment: (6875n * unit) / 100n, liquidationAwarded: (375n * unit) / 10n }
	expect(portfolioTakeoverSource(state, remainder)).toMatchObject({ maximumTakeoverAward: (375n * unit) / 10n, maximumTakeoverCommitment: (3125n * unit) / 100n })
})
