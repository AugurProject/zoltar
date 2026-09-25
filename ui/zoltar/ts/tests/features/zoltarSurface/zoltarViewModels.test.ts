/// <reference types="bun-types" />

import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { deriveZoltarOverviewModel, getZoltarUniverseActions, resolveZoltarRouteGate, type ZoltarOverviewInput } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/lib/zoltarViewModels.js'
import { describe, expect, test } from 'bun:test'

const walletAddress = '0x00000000000000000000000000000000000000a1'
const childUniverseId = 5n

function createUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkQuestionDetails: undefined,
		forkThresholdAttoRep: 1n,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		lineage: [{ outcomeLabel: undefined, universeId: 0n }],
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupplyAttoRep: 1n,
		universeId: 0n,
		...overrides,
	}
}

function createInput(overrides: Partial<ZoltarOverviewInput> = {}, account: Partial<ZoltarOverviewInput['account']> = {}): ZoltarOverviewInput {
	return {
		activeUniverseId: 0n,
		universe: createUniverse(),
		universeError: undefined,
		universeState: 'ready',
		...overrides,
		account: { address: walletAddress, isOnActiveChain: true, preparedMigrationRepAttoRep: 0n, repBalanceAttoRep: 10n, ...account },
	}
}

const forkedChild = createUniverse({
	forkTime: 100n,
	hasForked: true,
	lineage: [
		{ outcomeLabel: undefined, universeId: 0n },
		{ outcomeLabel: 'Yes', universeId: childUniverseId },
	],
	parentUniverseId: 0n,
	universeId: childUniverseId,
})

describe('getZoltarUniverseActions', () => {
	test('offers Fork only before a fork and Migrate only after it', () => {
		expect(getZoltarUniverseActions(undefined)).toEqual({ canFork: false, canMigrate: false })
		expect(getZoltarUniverseActions({ hasForked: false })).toEqual({ canFork: true, canMigrate: false })
		expect(getZoltarUniverseActions({ hasForked: true })).toEqual({ canFork: false, canMigrate: true })
	})
})

describe('resolveZoltarRouteGate', () => {
	test('keeps the global question views available whatever the universe state', () => {
		for (const view of ['questions', 'create'] as const) {
			expect(resolveZoltarRouteGate({ universeError: undefined, universe: undefined, universeState: 'missing', view })).toBe('ready')
			expect(resolveZoltarRouteGate({ universeError: undefined, universe: undefined, universeState: 'loading', view })).toBe('ready')
		}
	})

	test('reports a missing universe instead of silently showing another view', () => {
		for (const view of ['overview', 'universes', 'fork', 'migrate'] as const) expect(resolveZoltarRouteGate({ universeError: undefined, universe: undefined, universeState: 'missing', view })).toBe('universe-missing')
	})

	test('reports a failed universe read instead of loading forever', () => {
		for (const view of ['overview', 'universes', 'fork', 'migrate'] as const) expect(resolveZoltarRouteGate({ universe: undefined, universeError: 'RPC unavailable', universeState: 'unknown', view })).toBe('universe-unavailable')
		expect(resolveZoltarRouteGate({ universe: undefined, universeError: 'RPC unavailable', universeState: 'loading', view: 'universes' })).toBe('loading')
		expect(resolveZoltarRouteGate({ universe: undefined, universeError: undefined, universeState: 'unknown', view: 'universes' })).toBe('loading')
		expect(resolveZoltarRouteGate({ universe: undefined, universeError: 'RPC unavailable', universeState: 'unknown', view: 'questions' })).toBe('ready')
	})

	test('waits for the universe and blocks the workflow that does not apply', () => {
		expect(resolveZoltarRouteGate({ universeError: undefined, universe: undefined, universeState: 'loading', view: 'universes' })).toBe('loading')
		expect(resolveZoltarRouteGate({ universeError: undefined, universe: { hasForked: true }, universeState: 'ready', view: 'fork' })).toBe('fork-unavailable')
		expect(resolveZoltarRouteGate({ universeError: undefined, universe: { hasForked: false }, universeState: 'ready', view: 'migrate' })).toBe('migrate-unavailable')
		expect(resolveZoltarRouteGate({ universeError: undefined, universe: { hasForked: false }, universeState: 'ready', view: 'fork' })).toBe('ready')
		expect(resolveZoltarRouteGate({ universeError: undefined, universe: { hasForked: true }, universeState: 'ready', view: 'migrate' })).toBe('ready')
	})
})

describe('deriveZoltarOverviewModel', () => {
	test('sends an operational universe with a connected wallet to the questions', () => {
		const model = deriveZoltarOverviewModel(createInput())
		expect(model).toEqual({
			forkTime: undefined,
			migratableRepAttoRep: undefined,
			needsAttention: false,
			nextStep: { kind: 'browse-questions', view: 'questions' },
			repBalanceAttoRep: 10n,
			status: 'operational',
			universeLabel: 'Genesis',
			wallet: 'connected',
		})
	})

	test('asks for a wallet, then for the right network, before anything wallet-specific', () => {
		const disconnected = deriveZoltarOverviewModel(createInput({}, { address: undefined }))
		expect(disconnected.nextStep).toEqual({ kind: 'connect-wallet' })
		expect(disconnected.repBalanceAttoRep).toBeUndefined()
		const wrongNetwork = deriveZoltarOverviewModel(createInput({ activeUniverseId: childUniverseId, universe: forkedChild }, { isOnActiveChain: false }))
		expect(wrongNetwork.nextStep).toEqual({ kind: 'switch-network' })
		expect(wrongNetwork.needsAttention).toBe(false)
	})

	test('flags REP stranded in a forked universe and points at the Migrate route', () => {
		const model = deriveZoltarOverviewModel(createInput({ activeUniverseId: childUniverseId, universe: forkedChild }, { preparedMigrationRepAttoRep: 5n, repBalanceAttoRep: 10n }))
		expect(model.status).toBe('forked')
		expect(model.forkTime).toBe(100n)
		expect(model.universeLabel).toBe('Genesis › Yes')
		expect(model.migratableRepAttoRep).toBe(15n)
		expect(model.needsAttention).toBe(true)
		expect(model.nextStep).toEqual({ kind: 'migrate-rep', view: 'migrate' })
	})

	test('sends a forked universe with a known zero balance to its outcome universes', () => {
		const model = deriveZoltarOverviewModel(createInput({ activeUniverseId: childUniverseId, universe: forkedChild }, { preparedMigrationRepAttoRep: 0n, repBalanceAttoRep: 0n }))
		expect(model.migratableRepAttoRep).toBe(0n)
		expect(model.needsAttention).toBe(false)
		expect(model.nextStep).toEqual({ kind: 'open-child-universe', view: 'universes' })
	})

	test('sends a forked universe to Migrate while a balance is still unknown', () => {
		for (const account of [{ repBalanceAttoRep: undefined }, { preparedMigrationRepAttoRep: undefined, repBalanceAttoRep: 0n }]) {
			const model = deriveZoltarOverviewModel(createInput({ activeUniverseId: childUniverseId, universe: forkedChild }, account))
			expect(model.migratableRepAttoRep).toBeUndefined()
			expect(model.needsAttention).toBe(false)
			expect(model.nextStep).toEqual({ kind: 'migrate-rep', view: 'migrate' })
		}
	})

	test('offers Genesis for a missing universe and no step while the universe loads', () => {
		const missing = deriveZoltarOverviewModel(createInput({ activeUniverseId: 77n, universe: undefined, universeState: 'missing' }))
		expect(missing.status).toBe('missing')
		expect(missing.nextStep).toEqual({ kind: 'go-to-genesis' })
		expect(missing.universeLabel).toBe('Universe 0x4d')
		const loading = deriveZoltarOverviewModel(createInput({ universe: undefined, universeState: 'loading' }))
		expect(loading.status).toBe('loading')
		expect(loading.nextStep).toBeUndefined()
	})

	test('offers a retry when the universe read failed', () => {
		const model = deriveZoltarOverviewModel(createInput({ universe: undefined, universeError: 'RPC unavailable', universeState: 'unknown' }))
		expect(model.status).toBe('unavailable')
		expect(model.nextStep).toEqual({ kind: 'retry-universe' })
	})

	test('does not describe the active universe with a stale summary of another universe', () => {
		const model = deriveZoltarOverviewModel(createInput({ activeUniverseId: 77n, universe: forkedChild }))
		expect(model.universeLabel).toBe('Universe 0x4d')
		expect(model.status).toBe('loading')
		expect(model.nextStep).toBeUndefined()
	})
})
