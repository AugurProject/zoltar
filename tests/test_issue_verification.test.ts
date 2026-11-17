import { expect } from 'chai'
import { unusedPortfolioFunding } from '../bots/liquidator/src/execution/portfolio-unused-funding'
import type { RuntimeState } from '../bots/liquidator/src/state/operator-state'
import type { PortfolioObservation } from '../bots/liquidator/src/monitoring/portfolio-monitor'

/**
 * Minimal mock objects required to exercise `unusedPortfolioFunding`.
 */
function mockObservation(overrides: Partial<PortfolioObservation['snapshot']> = {}): PortfolioObservation {
  const defaultSnapshot = {
    capitalLedger: '0xABCDEF',
    owner: '0xOwner',
    ownerAccount: { freeAttoRep: 10_000n },
    withdrawableAttoRep: 8_000n,
    holdingFeeAttoRep: 0n,
    // The real type contains many more fields; we only need the ones accessed by the function.
  } as any

  return {
    snapshot: { ...defaultSnapshot, ...overrides },
    pendingOperationReport: undefined,
    // other fields are irrelevant for this test
  } as any
}

function mockState(fundingAmount: bigint, target?: string): RuntimeState {
  return {
    portfolioFunding: {
      '0xabcdef:0xowner': { amount: fundingAmount, target }
    },
    sponsoredReports: undefined,
    // The rest of RuntimeState fields are not used by `unusedPortfolioFunding`.
  } as any
}

describe('unusedPortfolioFunding – holding fee handling', () => {
  it('subtracts holding fee from the withdrawable amount', () => {
    const observation = mockObservation({ holdingFeeAttoRep: 2_000n })
    const state = mockState(15_000n, 'someTarget')
    const result = unusedPortfolioFunding(state, observation)
    // raw withdrawable = min(tracked=15_000, free=10_000, withdrawable=8_000) = 8_000
    // after subtracting holding fee 2_000 => 6_000
    expect(result.amount).to.equal(6_000n)
    expect(result.key).to.equal('0xabcdef:0xowner')
    expect(result.target).to.equal('someTarget')
  })

  it('does not return a negative amount when holding fee exceeds withdrawable', () => {
    const observation = mockObservation({ holdingFeeAttoRep: 9_000n })
    const state = mockState(20_000n, 'target')
    const result = unusedPortfolioFunding(state, observation)
    // raw withdrawable = min(20_000, 10_000, 8_000) = 8_000
    // holding fee 9_000 > 8_000 => amount should be 0
    expect(result.amount).to.equal(0n)
  })

  it('returns zero when there is a pending operation report', () => {
    const observation = mockObservation()
    ;(observation as any).pendingOperationReport = {} // simulate pending report
    const state = mockState(10_000n, 't')
    const result = unusedPortfolioFunding(state, observation)
    expect(result.amount).to.equal(0n)
  })

  it('returns zero when the portfolio is already sponsored', () => {
    const observation = mockObservation()
    const state = mockState(10_000n, 't') as any
    state.sponsoredReports = [{ fundingKey: '0xabcdef:0xowner' }]
    const result = unusedPortfolioFunding(state, observation)
    expect(result.amount).to.equal(0n)
  })
})
