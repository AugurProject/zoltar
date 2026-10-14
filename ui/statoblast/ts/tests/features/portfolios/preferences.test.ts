import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { isPortfolioPositionVisible, mergeTrackedPortfolioOperations, parsePortfolioPreferences, parseTrackedPortfolioOperations, portfolioStorageKey, portfolioOperationKey, type TrackedPortfolioOperation } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/preferences.js'
import { parseAllocationDrafts, parsePortfolioAmount } from '@zoltar/ui-statoblast-shared/features/portfolios/lib/draft.js'

const portfolio = getAddress('0x0000000000000000000000000000000000000011')
const owner = getAddress('0x0000000000000000000000000000000000000022')
const coordinator = getAddress('0x0000000000000000000000000000000000000033')
const pool = getAddress('0x0000000000000000000000000000000000000044')
const operation: TrackedPortfolioOperation = { coordinator, pool, operationId: '7', operation: '3', fromBlock: '12', universeId: '0', questionId: '4' }

describe('portfolio preferences and operation recovery', () => {
	test('isolates persisted preferences and work by backend, chain, portfolio and owner', () => {
		const scope = { backend: 'simulation', chainId: '1', portfolio, owner }
		const key = portfolioStorageKey(scope, 'operations')
		for (const patch of [{ backend: 'injected' }, { chainId: '2' }, { portfolio: pool }, { owner: coordinator }]) expect(portfolioStorageKey({ ...scope, ...patch }, 'operations')).not.toBe(key)
		expect(portfolioStorageKey(scope, 'preferences')).not.toBe(key)
	})
	test('rejects malformed persisted data and out-of-range universe IDs', () => {
		expect(parsePortfolioPreferences('broken')).toEqual({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: [], knownPositionQuestionIds: [] })
		expect(parsePortfolioPreferences(JSON.stringify({ watchedQuestionIds: ['1', '1', '-1', {}, '0x2'], universeIds: ['0', '0', (1n << 248n).toString()] }))).toEqual({ watchedQuestionIds: ['1'], universeIds: ['0'], selectedQuestionIds: [], knownPositionQuestionIds: [] })
		expect(parseTrackedPortfolioOperations(JSON.stringify([operation, { ...operation, operationId: '-1' }, { ...operation, coordinator: 'wrong' }]))).toEqual([operation])
	})
	test('keeps completed or missing queue entries for terminal-evidence recovery after reload', () => {
		expect(mergeTrackedPortfolioOperations([operation], [])).toEqual([operation])
		expect(mergeTrackedPortfolioOperations([operation], [{ ...operation, fromBlock: '100' }])).toEqual([operation])
		expect(mergeTrackedPortfolioOperations([operation], [{ ...operation, coordinator: portfolio }])).toHaveLength(2)
	})
	test('watchlists cannot hide backing, commitment, dispute stakes, debt or pending operations', () => {
		const empty = { claimableFeesAttoEth: 0n, backingUnits: 0n, backingAttoRep: 0n, commitmentAttoEth: 0n, disputeStakedAttoRep: 0n, badDebtAttoEth: 0n, pendingCount: 0 }
		expect(isPortfolioPositionVisible(false, empty)).toBe(false)
		expect(isPortfolioPositionVisible(true, empty)).toBe(true)
		for (const patch of [{ claimableFeesAttoEth: 1n }, { backingUnits: 1n }, { backingAttoRep: 1n }, { commitmentAttoEth: 1n }, { disputeStakedAttoRep: 1n }, { badDebtAttoEth: 1n }, { pendingCount: 1 }]) expect(isPortfolioPositionVisible(false, { ...empty, ...patch })).toBe(true)
	})
})

test('allocation amounts retain full token precision and reject negative, exponential and overprecision values', () => {
	expect(parsePortfolioAmount('9007199254740993.000000000000000001')).toBe(9007199254740993000000000000000001n)
	for (const value of ['-1', '1e3', '0.0000000000000000001']) expect(() => parsePortfolioAmount(value)).toThrow()
	expect(parseAllocationDrafts({ '4': { selected: true, deposit: '1', commitment: '2' }, '5': { selected: false, deposit: 'invalid', commitment: 'invalid' } })).toEqual([{ questionId: 4n, depositAttoRep: 10n ** 18n, commitmentAttoEth: 2n * 10n ** 18n }])
})

test('does not conflate identical operation IDs observed on replacement chains', () => {
	const original = { ...operation, observation: { blockNumber: '12', blockHash: `0x${'11'.repeat(32)}` as const, vault: owner, operator: owner, receiverVault: owner, targetVault: owner, queuedAt: '10', validForSeconds: '300' } }
	const replacement = { ...original, observation: { ...original.observation, blockHash: `0x${'22'.repeat(32)}` as const, operator: portfolio, receiverVault: portfolio, targetVault: portfolio } }
	expect(portfolioOperationKey(original)).not.toBe(portfolioOperationKey(replacement))
})

test('normalizes and validates selected and known question IDs without silently truncating holdings', () => {
	const ids = Array.from({ length: 257 }, (_, index) => String(index + 1))
	const preferences = parsePortfolioPreferences(JSON.stringify({ watchedQuestionIds: [], universeIds: [], selectedQuestionIds: ['001', '1', '-1', (1n << 256n).toString()], knownPositionQuestionIds: ids }))
	expect(preferences.selectedQuestionIds).toEqual(['1'])
	expect(preferences.knownPositionQuestionIds).toEqual(ids)
})

test('bounds repeated unsolicited operation history without evicting vault-authorized observations', () => {
	const observation = { blockNumber: '12', blockHash: `0x${'11'.repeat(32)}` as const, vault: owner, operator: owner, receiverVault: owner, targetVault: pool, queuedAt: '10', validForSeconds: '300' }
	const authorized = { ...operation, observation }
	let entries: TrackedPortfolioOperation[] = [authorized]
	for (let batch = 0; batch < 8; batch++) {
		const spam = Array.from({ length: 100 }, (_, index) => ({ ...operation, operationId: String(100 + batch * 100 + index), observation: { ...observation, operator: pool, receiverVault: pool, targetVault: owner } }))
		entries = mergeTrackedPortfolioOperations(entries, spam)
		expect(entries.length).toBeLessThanOrEqual(256)
		expect(entries).toContainEqual(authorized)
	}
	expect(entries.at(-1)?.operationId).toBe('899')
})

test('bounds previously saved oversized history before it can trigger network reads', () => {
	const oversized = Array.from({ length: 1000 }, (_, index) => ({ ...operation, operationId: String(index) }))
	const parsed = parseTrackedPortfolioOperations(JSON.stringify(oversized))
	expect(parsed).toHaveLength(256)
	expect(parsed[0]?.operationId).toBe('744')
	expect(parsed.at(-1)?.operationId).toBe('999')
})
