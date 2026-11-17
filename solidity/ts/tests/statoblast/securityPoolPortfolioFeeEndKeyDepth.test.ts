import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as engineArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
} from '../../types/contractArtifact'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

// Regression for dust questions bought at chosen seconds to deepen a victim question's path in the
// fee aggregate maps (keyed by fee-stream end) until its redemption exceeded the transaction cap.
// Ends now round down to the book's granularity, so an attacker can only add neighbours in the
// sibling subtrees of granularity bits and above. The attacker fills every level it can reach at
// once around a victim key whose bits from the granularity up to bit 27 are ones.
const CAP = 16_777_216n
const YEAR = 365n * 86_400n
const LAST_LEVEL = 27n

describe('Statoblast portfolio: fee-stream end keys chosen by dust buyers', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('dust neighbours in every reachable sibling subtree leave complete-set redemption well under the gas cap', async () => {
		const attacker = fixture.owner()
		const victim = fixture.other()
		const window = fixture.base.mockWindow
		const engine = await attacker.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'settlement' })
		const book = await attacker.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await attacker.readContract({ abi: engineArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const feeEnd = async (questionId: bigint) => BigInt((await attacker.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, questionId] }))[0].feeEnd)
		const granularity = await attacker.readContract({ abi: bookArtifact.abi, address: book, functionName: 'feeEndGranularity' })
		const granularityBits = BigInt(granularity.toString(2).length - 1)
		expect(granularity).toBe(1n << 17n)
		const annualFeeBps = await attacker.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'annualFeeBps' })
		const minimumRate = await attacker.readContract({ abi: bookArtifact.abi, address: book, functionName: 'minimumOutcomeExchangeRate' })
		const services = await attacker.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'services' })
		const collateral = await attacker.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'collateralToken' })
		await approveToken(attacker, collateral, services)
		await approveToken(victim, collateral, services)
		await fixture.prepare()

		// Unrounded stream length of a first purchase of n wei into an empty question of a book whose
		// unit price is exactly 1e-9 wei (SecurityPoolPortfolioPurchase.feeStream and the book budget).
		const duration = (n: bigint) => {
			const units = n * 10n ** 9n
			const reservedCash = (n * minimumRate + 10n ** 18n - 1n) / 10n ** 18n
			if (reservedCash >= n) return 0n
			const rate = (units * annualFeeBps) / (10_000n * YEAR)
			return rate === 0n ? 0n : (units - reservedCash * 10n ** 9n) / rate
		}
		// Largest duration(n) <= need for n in [2, 10^12]; duration grows with n up to integer jitter.
		const bestDust = (need: bigint) => {
			let low = 2n
			let high = 10n ** 12n
			if (duration(high) <= need) return high
			while (low < high) {
				const middle = (low + high + 1n) / 2n
				if (duration(middle) <= need) low = middle
				else high = middle - 1n
			}
			let best = low
			for (let n = low > 400n ? low - 400n : 2n; n <= low + 400n; n++) if (duration(n) <= need && duration(n) > duration(best)) best = n
			return best
		}
		const now0 = await window.getTime()
		const makeId = async (title: string) => {
			// Aligning the victim key may move the clock up to 2^28 seconds (8.5 years) forward.
			const data = makeQuestion(title, now0 + 15n * YEAR)
			await createQuestion(attacker, data, fixture.base.outcomes)
			return getQuestionId(data, fixture.base.outcomes)
		}

		// The victim buys at a second whose rounded stream end has ones in bits granularity..27, so every
		// sibling subtree of those levels lies below its key and is reachable by a purchase made now.
		const victimId = await makeId('fee end depth victim')
		await fixture.register(victimId, fixture.portfolio, victim)
		const victimPool = fixture.poolFor(victimId).securityPool
		const victimDuration = duration(10n * unit)
		const mask = (1n << (LAST_LEVEL + 1n)) - granularity
		const earliest = (await window.getTime()) + 2n * granularity + 5_000n + victimDuration
		const key = ((earliest | ((1n << (LAST_LEVEL + 1n)) - 1n)) >> granularityBits) << granularityBits
		expect(key & mask).toBe(mask)
		const victimPurchase = key - victimDuration + granularity / 2n
		await window.setTime(victimPurchase - 700n)
		await fixture.refreshPrice()
		await window.setTime(victimPurchase - 1n)
		await fixture.mint(10n * unit, victimId, { sender: victim })
		expect(await feeEnd(victimId)).toBe(key)
		const redeemWithCap = async () => {
			const hash = await victim.writeContract({ abi: poolArtifact.abi, address: victimPool, functionName: 'redeemCompleteSet', args: [unit], gas: CAP })
			return victim.waitForTransactionReceipt({ hash })
		}
		const snapshot = await window.anvilSnapshot()
		const baseline = await redeemWithCap()
		expect(baseline.status).toBe('success')
		await window.anvilRevert(snapshot)

		const placed: bigint[] = []
		for (let level = granularityBits; level <= LAST_LEVEL; level++) {
			const width = 1n << level
			const lo = ((key >> level) ^ 1n) << level
			await fixture.refreshPrice()
			const when = (await window.getTime()) + 3n
			const amount = bestDust(lo + width - 1n - width / 8n - when)
			expect(when + duration(amount)).toBeGreaterThanOrEqual(lo + width / 8n)
			const id = await makeId(`fee end depth dust ${level}`)
			await fixture.register(id, fixture.portfolio, attacker)
			await window.setTime(when - 1n)
			await fixture.mint(amount, id, { sender: attacker })
			const end = await feeEnd(id)
			expect(end % granularity).toBe(0n)
			expect(end >= lo && end < lo + width).toBe(true)
			placed.push(level)
		}
		expect(placed.length).toBe(Number(LAST_LEVEL - granularityBits + 1n))
		expect(await feeEnd(victimId)).toBe(key)

		await fixture.refreshPrice()
		const receipt = await redeemWithCap()
		console.log({ victimFeeEndKey: key, placedLevels: placed.length, baselineRedeemCompleteSetGas: baseline.gasUsed, attackedRedeemCompleteSetGas: receipt.gasUsed })
		expect(receipt.status).toBe('success')
		// The provable bound (16 branch levels, six fee-map writes) stays near 9.4M gas; see
		// securityPoolSettlementFeeEndDepth.test.ts. This partially attacked tree must stay far below it.
		expect(receipt.gasUsed).toBeLessThan(10_000_000n)
	})
})
