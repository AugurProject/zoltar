import { expect, test } from 'bun:test'
import { managedPortfolioScopes, portfolioPositionPage, requireCompletePortfolioExposure } from '../../src/monitoring/portfolio-monitor.ts'
import { parsePortfolioScopes } from '../../src/state/portfolio-scopes.ts'
import { portfolioAddress } from '../support/portfolio-observation.ts'

const selection = { address: portfolioAddress, universeId: 0n }
test('bounded historical sweeps cannot be postponed by new registrations and revisit rekeyed old positions', () => {
	const scope = { ...selection, nextPositionId: 1n, sweepEnd: 0n }
	const first = portfolioPositionPage(scope, 5n, 2)
	expect(first.ids).toEqual([1n, 2n])
	const second = portfolioPositionPage(first.nextScope, 100n, 2)
	expect(second.ids).toEqual([3n, 4n])
	const third = portfolioPositionPage(second.nextScope, 200n, 2)
	expect(third.ids).toEqual([5n])
	expect(portfolioPositionPage(third.nextScope, 200n, 2).ids).toEqual([1n, 2n])
})

test('deselected scopes remain in exposure accounting and persisted cursors survive restart', () => {
	const scopes = managedPortfolioScopes([], [selection])
	expect(managedPortfolioScopes(scopes, [])).toEqual(scopes)
	const scope = { ...selection, nextPositionId: 33n, sweepEnd: 150n, retirementObservations: [{ id: 3n, batch: 1n, commitment: 100n, since: 1000n }] }
	const serialized: unknown = JSON.parse(JSON.stringify([scope], (_key, value) => (typeof value === 'bigint' ? value.toString() : value)))
	expect(parsePortfolioScopes(serialized)).toEqual([scope])
	expect(() => parsePortfolioScopes([{ ...selection, universeId: '0', nextPositionId: '0', sweepEnd: '0' }])).toThrow('cursor')
})

import { loadPortfolioObservation } from '../../src/monitoring/portfolio-monitor.ts'
import { portfolioClient } from '../support/portfolio-client.ts'

test('authenticates factory, ledger, index and REP identity and pins every read including wallet funding', async () => {
	const fixture = portfolioClient()
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(result.positions).toHaveLength(1)
	expect(result.snapshot.blockNumber).toBe(123n)
	expect(fixture.reads.length).toBeGreaterThan(30)
	expect(fixture.reads.every(read => read.blockNumber === 123n)).toBe(true)
	fixture.values['getSecurityPool'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('canonical origin')
	fixture.values['getSecurityPool'] = fixture.values['seedPool']
	fixture.values['getRepToken'] = fixture.settings.deployment.zoltar
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, undefined, fixture.observation.nextScope, 123n)).rejects.toThrow('identity')
})

test('monitors underfunded reserve and marks unchanged blocked retirement only after repeated observations', async () => {
	const fixture = portfolioClient({ accountOf: { owner: portfolioAddress, batch: 1n, rep: 1n, commitment: 10n ** 18n, maxHealthyPrice: 1n, releasedRep: 0n, ethFees: 0n, repFees: 0n, remainingCommitment: 0n }, previewRetirement: { status: 3n } })
	const scope = { ...fixture.observation.nextScope, retirementObservations: [{ id: 1n, batch: 1n, commitment: 10n ** 18n, since: 1n }] }
	const result = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, scope, 123n)
	expect(result.positions[0]).toMatchObject({ retirementStatus: 'Earlier requests reserve available capacity', stalledRetirement: true })
	expect(result.positions[0]?.executionReserveAttoEth).toBeLessThan(result.positions[0]?.requiredExecutionReserveAttoEth ?? 0n)
	const reset = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, { ...scope, retirementObservations: [] }, 123n)
	expect(reset.positions[0]?.stalledRetirement).toBe(false)
})

test('rejects a caller-owned factory namespace with counterfeit portfolio runtime', async () => {
	const fixture = portfolioClient()
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'getCode') return async () => '0x6000'
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadPortfolioObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('runtime')
})

test('genuine runtime does not authenticate a hostile fork or protocol authority', async () => {
	const fixture = portfolioClient()
	fixture.values['forkAuthority'] = portfolioAddress
	await expect(loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('fork authority')
	fixture.values['forkAuthority'] = fixture.module('SecurityPoolPortfolioForkCoordinator')
	const client = new Proxy(fixture.client, {
		get(target, property) {
			if (property === 'readContract')
				return async (parameters: Parameters<typeof target.readContract>[0]) => {
					if (parameters.functionName === 'zoltar' && parameters.address === fixture.observation.snapshot.capitalLedger) return portfolioAddress
					return target.readContract(parameters)
				}
			return Reflect.get(target, property, target)
		},
	})
	await expect(loadPortfolioObservation(client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)).rejects.toThrow('another protocol')
})

test('accepts a genuine portfolio whose constructor seed remains a standalone pool', async () => {
	const fixture = portfolioClient({ getSecurityPoolPortfolio: '0x0000000000000000000000000000000000000000' })
	const observation = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(observation.snapshot.portfolio).toBe(portfolioAddress)
})

test('exported managed principal cannot disappear without its authenticated chosen child scope', async () => {
	const fixture = portfolioClient({ exported: true, choices: [2n, true], getChildUniverseId: 7n })
	const parent = await loadPortfolioObservation(fixture.client, fixture.settings, fixture.observation.snapshot.owner, fixture.observation.nextScope, 123n)
	expect(parent.chosenChildUniverseId).toBe(7n)
	expect(() => requireCompletePortfolioExposure([parent])).toThrow('chosen fork universe 7')
	const child = { ...fixture.observation, selection: { ...fixture.observation.selection, universeId: 7n } }
	expect(() => requireCompletePortfolioExposure([parent, child])).not.toThrow()
	expect(managedPortfolioScopes([parent.nextScope], [])).toEqual([parent.nextScope])
})
