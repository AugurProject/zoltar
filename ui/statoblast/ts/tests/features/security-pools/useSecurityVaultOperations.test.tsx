/// <reference types='bun-types' />

import { getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installFakeEnvironmentLifecycle, requireHookState } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { SecurityVaultDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { useSecurityVaultOperations, type UseSecurityVaultOperationsDependencies } from '@zoltar/ui-statoblast-shared/features/security-pools/hooks/useSecurityVaultOperations.js'
import { describe, expect, mock, test } from 'bun:test'
import { h, render } from 'preact'
import { signal } from '@preact/signals'
import { act } from 'preact/test-utils'

type UseSecurityVaultOperationsState = ReturnType<typeof useSecurityVaultOperations>

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')
const SECURITY_POOL_ADDRESS = getAddress('0x0000000000000000000000000000000000000002')
const MANAGER_ADDRESS = getAddress('0x0000000000000000000000000000000000000003')
const REP_TOKEN_ADDRESS = getAddress('0x0000000000000000000000000000000000000004')

function createSecurityVaultDetails(overrides: Partial<SecurityVaultDetails> = {}): SecurityVaultDetails {
	return {
		badDebtAttoEth: 0n,
		statoblastSecurityMultiplierBps: 20_000n,
		currentRetentionRate: 0n,
		disputeStakedAttoRep: 0n,
		managerAddress: MANAGER_ADDRESS,
		totalRepBackingUnits: 1n,
		vaultAttoRepBacking: 10n * 10n ** 18n,
		repToken: REP_TOKEN_ADDRESS,
		underwritingLimitAttoEth: 0n,
		securityPoolAddress: SECURITY_POOL_ADDRESS,
		totalUnderwritingLimitAttoEth: 0n,
		claimableFeesAttoEth: 0n,
		universeId: 1n,
		vaultAddress: WALLET_ADDRESS,
		...overrides,
	}
}

function createSecurityVaultOperationsDependencies(overrides: Partial<UseSecurityVaultOperationsDependencies> = {}): UseSecurityVaultOperationsDependencies {
	return {
		loadSecurityVaultDetails: mock(async () => createSecurityVaultDetails()),
		...overrides,
	}
}

function createHarness(dependencies: UseSecurityVaultOperationsDependencies, onRender: (state: UseSecurityVaultOperationsState) => void) {
	return function SecurityVaultOperationsHarness(parameters: Partial<Parameters<typeof useSecurityVaultOperations>[0]>) {
		const state = useSecurityVaultOperations({ accountAddress: WALLET_ADDRESS, enabled: true, selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS, ...parameters }, dependencies)
		onRender(state)
		return h('div', {})
	}
}

describe('useSecurityVaultOperations', () => {
	const { trackCleanup } = installFakeEnvironmentLifecycle({ accountAddress: WALLET_ADDRESS, installActiveEnvironment: installActiveEnvironmentForTesting })

	test('loads the selected vault of the selected pool', async () => {
		const loadSecurityVaultDetails = mock(async () => createSecurityVaultDetails())
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(createSecurityVaultOperationsDependencies({ loadSecurityVaultDetails }), next => {
			state = next
		})
		trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(loadSecurityVaultDetails).toHaveBeenCalledWith(SECURITY_POOL_ADDRESS, WALLET_ADDRESS)
		expect(requireHookState(state).securityVaultDetails?.vaultAddress).toBe(WALLET_ADDRESS)
		expect(requireHookState(state).securityVaultMissing).toBe(false)
	})

	test.each(['owner', 'pool'] as const)('does not carry a missing vault result into another %s selection', async selection => {
		const dependencies = createSecurityVaultOperationsDependencies({ loadSecurityVaultDetails: async () => undefined })
		let state: UseSecurityVaultOperationsState | undefined
		const observations: boolean[] = []
		const nextAddress = getAddress('0x00000000000000000000000000000000000000a2')
		let switched = false
		const Harness = createHarness(dependencies, next => {
			state = next
			if (switched) observations.push(next.securityVaultMissing)
		})
		const rendered = await renderIntoDocument(h(Harness, {}))
		trackCleanup(rendered.cleanup)
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(requireHookState(state).securityVaultMissing).toBe(true)
		switched = true
		await act(() => {
			if (selection === 'owner') requireHookState(state).setSecurityVaultForm(current => ({ ...current, selectedVaultOwner: nextAddress }))
			else {
				render(h(Harness, { selectedSecurityPoolAddress: nextAddress }), rendered.container)
			}
		})
		expect(observations.length).toBeGreaterThan(0)
		expect(observations).not.toContain(true)
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(requireHookState(state).securityVaultMissing).toBe(true)
	})

	test('reloads the same vault when reads pause during a reload', async () => {
		// A confirmed transaction can briefly make onchain reads unavailable while its follow-up vault reload is in flight.
		let resolvePausedLoad: ((details: SecurityVaultDetails) => void) | undefined
		const loadSecurityVaultDetails = mock(async () => createSecurityVaultDetails())
		let state: UseSecurityVaultOperationsState | undefined
		const Harness = createHarness(createSecurityVaultOperationsDependencies({ loadSecurityVaultDetails }), next => {
			state = next
		})
		const rendered = await renderIntoDocument(h(Harness, {}))
		trackCleanup(rendered.cleanup)
		await act(async () => await requireHookState(state).loadSecurityVault())
		expect(requireHookState(state).securityVaultDetails?.underwritingLimitAttoEth).toBe(0n)
		loadSecurityVaultDetails.mockImplementationOnce(
			() =>
				new Promise<SecurityVaultDetails>(resolve => {
					resolvePausedLoad = resolve
				}),
		)
		loadSecurityVaultDetails.mockImplementation(async () => createSecurityVaultDetails({ underwritingLimitAttoEth: 5n }))
		let pausedLoad: Promise<void> | undefined
		await act(() => {
			pausedLoad = requireHookState(state).loadSecurityVault(WALLET_ADDRESS)
		})
		await act(() => render(h(Harness, { enabled: false }), rendered.container))
		await act(() => render(h(Harness, { enabled: true }), rendered.container))
		await act(async () => {
			resolvePausedLoad?.(createSecurityVaultDetails({ underwritingLimitAttoEth: 1n }))
			await pausedLoad
		})
		await waitFor(() => expect(requireHookState(state).securityVaultDetails?.underwritingLimitAttoEth).toBe(5n))
		expect(requireHookState(state).loadingSecurityVault).toBe(false)
	})

	test('moves the vault owner to a newly connected wallet only when it named the previous wallet', async () => {
		const NEXT_WALLET = getAddress('0x0000000000000000000000000000000000000011')
		const THIRD_WALLET = getAddress('0x0000000000000000000000000000000000000012')
		const TYPED_OWNER = getAddress('0x0000000000000000000000000000000000000013')
		const account = signal<Address | undefined>(WALLET_ADDRESS)
		let state: UseSecurityVaultOperationsState | undefined
		const dependencies = createSecurityVaultOperationsDependencies()
		function Harness() {
			const next = useSecurityVaultOperations({ accountAddress: account.value, enabled: true, selectedSecurityPoolAddress: SECURITY_POOL_ADDRESS }, dependencies)
			state = next
			return h('div', {})
		}
		trackCleanup((await renderIntoDocument(h(Harness, {}))).cleanup)
		expect(requireHookState(state).securityVaultForm.selectedVaultOwner).toBe(WALLET_ADDRESS)
		await act(() => {
			account.value = NEXT_WALLET
		})
		expect(requireHookState(state).securityVaultForm.selectedVaultOwner).toBe(NEXT_WALLET)
		// Disconnecting and reconnecting another wallet still follows the wallet.
		await act(() => {
			account.value = undefined
		})
		await act(() => {
			account.value = THIRD_WALLET
		})
		expect(requireHookState(state).securityVaultForm.selectedVaultOwner).toBe(THIRD_WALLET)
		// An owner typed in for another vault stays put across wallet switches.
		await act(() => requireHookState(state).setSecurityVaultForm(current => ({ ...current, selectedVaultOwner: TYPED_OWNER })))
		await act(() => {
			account.value = WALLET_ADDRESS
		})
		expect(requireHookState(state).securityVaultForm.selectedVaultOwner).toBe(TYPED_OWNER)
	})
})
