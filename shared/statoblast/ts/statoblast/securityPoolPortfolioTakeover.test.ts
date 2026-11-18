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
