import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { strictEqualTypeSafe } from '../../testSupport/simulator/utils/testUtils'
import { useAuctionFixture } from './fixture'
import { FINALIZE_GAS_LIMIT, getMaxAvlHeightWithinNodeCap, MAX_DISTINCT_TICK_COUNT } from './model'

describe('UniformPriceDualCapBatchAuction: Lifecycle & Finalization gas bounds', () => {
	const fixture = useAuctionFixture()
	const { estimateWithdrawGasWithManyRefundedPredecessors, estimateFinalizeGasWithBidDistribution, estimateFinalizeGasForSyntheticWorstCaseDepth, estimateUnderfundedFinalizeGasForSyntheticWorstCaseDepth } = fixture

	test('withdraw gas for a same-tick bid with many refunded predecessors avoids linear growth', async () => {
		const gasWithSixteenBids = await estimateWithdrawGasWithManyRefundedPredecessors(16n, 1)
		const gasWithOneHundredTwentyEightBids = await estimateWithdrawGasWithManyRefundedPredecessors(128n, 2)

		assert.ok(gasWithOneHundredTwentyEightBids < gasWithSixteenBids * 4n, `withdraw gas should stay sublinear in the number of refunded same-tick predecessors: 16 bids=${gasWithSixteenBids.toString()}, 128 bids=${gasWithOneHundredTwentyEightBids.toString()}`)
	})

	test('finalize gas stays bounded when many bids land on the same tick', async () => {
		const gasWithSixteenBids = await estimateFinalizeGasWithBidDistribution(16n, false, 3)
		const gasWithOneHundredTwentyEightBids = await estimateFinalizeGasWithBidDistribution(128n, false, 4)

		assert.ok(gasWithOneHundredTwentyEightBids < gasWithSixteenBids * 2n, `finalize gas should track price levels rather than raw bid count when bids share a tick: 16 bids=${gasWithSixteenBids.toString()}, 128 bids=${gasWithOneHundredTwentyEightBids.toString()}`)
	})

	test('distinct-tick finalize gas stays close to same-tick finalize gas after subtree pruning', async () => {
		const gasWithThirtyTwoSameTickBids = await estimateFinalizeGasWithBidDistribution(32n, false, 5)
		const gasWithThirtyTwoDistinctTicks = await estimateFinalizeGasWithBidDistribution(32n, true, 6)

		assert.ok(gasWithThirtyTwoDistinctTicks < gasWithThirtyTwoSameTickBids * 2n, `distinct price levels should stay close to same-tick finalize gas after subtree pruning: same tick=${gasWithThirtyTwoSameTickBids.toString()}, distinct ticks=${gasWithThirtyTwoDistinctTicks.toString()}`)
	})

	test('finalize stays under 20 million gas on a synthetic max-depth clearing path for the full tick domain', async () => {
		const maxAvlHeightWithinTickDomain = getMaxAvlHeightWithinNodeCap(MAX_DISTINCT_TICK_COUNT)
		strictEqualTypeSafe(maxAvlHeightWithinTickDomain, 28n, 'unexpected AVL height bound for the tick domain')

		const finalizeGas = await estimateFinalizeGasForSyntheticWorstCaseDepth(maxAvlHeightWithinTickDomain, 1)
		console.info(`auction max-depth funded finalize gas: ${finalizeGas.toString()} (height=${maxAvlHeightWithinTickDomain.toString()}, limit=${FINALIZE_GAS_LIMIT.toString()})`)

		assert.ok(finalizeGas < FINALIZE_GAS_LIMIT, `finalize gas should stay below ${FINALIZE_GAS_LIMIT.toString()} for the synthetic max-depth clearing path: gas=${finalizeGas.toString()}, height=${maxAvlHeightWithinTickDomain.toString()}`)
	})

	test('underfunded finalize stays under 20 million gas on a synthetic max-depth tick domain', async () => {
		const maxAvlHeightWithinTickDomain = getMaxAvlHeightWithinNodeCap(MAX_DISTINCT_TICK_COUNT)
		strictEqualTypeSafe(maxAvlHeightWithinTickDomain, 28n, 'unexpected AVL height bound for the tick domain')

		const finalizeGas = await estimateUnderfundedFinalizeGasForSyntheticWorstCaseDepth(maxAvlHeightWithinTickDomain, 1)
		console.info(`auction max-depth underfunded finalize gas: ${finalizeGas.toString()} (height=${maxAvlHeightWithinTickDomain.toString()}, limit=${FINALIZE_GAS_LIMIT.toString()})`)

		assert.ok(finalizeGas < FINALIZE_GAS_LIMIT, `underfunded finalize gas should stay below ${FINALIZE_GAS_LIMIT.toString()} for the synthetic max-depth tree: gas=${finalizeGas.toString()}, height=${maxAvlHeightWithinTickDomain.toString()}`)
	})
})
