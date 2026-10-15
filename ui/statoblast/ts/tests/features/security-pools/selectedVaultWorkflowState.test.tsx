import { expect, test } from 'bun:test'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress, getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import { createAccountState, createOracleManagerDetails, createSelectedPool, createSecurityPoolWorkflowProps, createSecurityVaultProps, createSecurityVaultDetails } from './workflow/builders.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
installTestRouting()
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import type { ComponentChild } from 'preact'
import { useSecurityPoolWorkflowSectionTestDom } from './workflow/testDom.js'

const { setCleanup } = useSecurityPoolWorkflowSectionTestDom()
const renderHarness = async (node: ComponentChild) => {
	const rendered = await renderIntoDocument(node)
	setCleanup(rendered.cleanup)
	return rendered
}

const otherOwner = getAddress('0x0000000000000000000000000000000000000001')
function VaultSelectionHarness({ exists = true, loaded = true, connected = true, accountAddress = zeroAddress, onLoad = (_owner: string) => undefined, error }: { onLoad?: (owner: string) => void; error?: string; exists?: boolean; loaded?: boolean; connected?: boolean; accountAddress?: Address }) {
	const [owner, setOwner] = useState(zeroAddress)
	const [loadedOwner, setLoadedOwner] = useState(zeroAddress)
	const details = exists
		? createSecurityVaultDetails({ vaultAddress: loadedOwner, vaultAttoRepBacking: (loadedOwner === otherOwner ? 17n : 5n) * 10n ** 18n })
		: createSecurityVaultDetails({ vaultAddress: loadedOwner, underwritingLimitAttoEth: 0n, claimableFeesAttoEth: 0n, vaultAttoRepBacking: 0n, disputeStakedAttoRep: 0n, badDebtAttoEth: 0n })
	return (
		<>
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: connected ? accountAddress : undefined }),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool({ hasLoadedVaults: true, vaultCount: 2n, vaults: [createSecurityVaultDetails(), createSecurityVaultDetails({ vaultAddress: otherOwner, vaultAttoRepBacking: 17n * 10n ** 18n })] })],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: loaded ? details : undefined,
						securityVaultError: error,
						onLoadSecurityVault: requestedOwner => {
							const requested = requestedOwner ?? owner
							onLoad(requested)
							setLoadedOwner(getAddress(requested))
						},
						onSecurityVaultFormChange: form => {
							if (form.selectedVaultOwner !== undefined) setOwner(getAddress(form.selectedVaultOwner))
						},
						securityVaultForm: { depositAmount: '', repWithdrawAmount: '', targetHealthFactor: '', securityPoolAddress: zeroAddress, selectedVaultOwner: owner },
					}),
				})}
			/>
			<button onClick={() => setOwner(otherOwner)}>Inspect another vault</button>
		</>
	)
}

test('preserves a user-selected directory and another vault across form rerenders', async () => {
	await renderHarness(<VaultSelectionHarness />)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('true')
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Inspect another vault' })))
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('true')
})

for (const connected of [true, false]) {
	test(`defaults to ${connected ? 'My vault without an existing vault' : 'the directory without a wallet'}`, async () => {
		await renderHarness(<VaultSelectionHarness exists={false} connected={connected} />)
		expect(
			within(document.body)
				.getByRole('button', { name: connected ? 'My vault' : 'All vaults' })
				.getAttribute('aria-pressed'),
		).toBe('true')
	})
}

test('does not switch away from a user-selected directory when the vault read finishes', async () => {
	const rendered = await renderHarness(<VaultSelectionHarness loaded={false} />)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	await act(() => render(<VaultSelectionHarness loaded />, rendered.container))
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('true')
})

test('selects the new wallet vault when the connected account changes', async () => {
	const rendered = await renderHarness(<VaultSelectionHarness />)
	await act(() => render(<VaultSelectionHarness accountAddress={otherOwner} />, rendered.container))
	expect(within(document.body).getByRole('button', { name: 'Copy address ' + otherOwner })).not.toBeNull()
	expect(within(document.body).getByRole('button', { name: 'My vault' }).getAttribute('aria-pressed')).toBe('true')
})

test('opening another directory vault loads and renders that owner’s data', async () => {
	const loads: string[] = []
	await renderHarness(<VaultSelectionHarness onLoad={owner => loads.push(owner)} />)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	const address = within(document.body).getByRole('button', { name: 'Copy address ' + otherOwner })
	const row = address.closest('.vault-position-strip')
	if (!(row instanceof HTMLElement)) throw new Error('Expected vault record')
	await act(() => fireEvent.click(within(row).getByRole('button', { name: 'Open vault' })))
	expect(loads).toContain(otherOwner)
	expect(within(document.body).getByRole('button', { name: 'By address' }).getAttribute('aria-pressed')).toBe('true')
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('false')
	expect(within(document.body).getByRole('button', { name: 'Copy address ' + otherOwner })).not.toBeNull()
	const backing = document.querySelector('.vault-detail-hero')
	expect(backing?.textContent).toContain('17.00')
	expect(backing?.textContent).not.toContain('5.00')
})
test('shows the vault read error and retries without leaving Directory', async () => {
	const loads: string[] = []
	await renderHarness(<VaultSelectionHarness error='Vault read failed' onLoad={owner => loads.push(owner)} />)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	expect(within(document.body).getByText('Vault read failed')).not.toBeNull()
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Retry' })))
	expect(loads).toContain(zeroAddress)
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('true')
})

test('opens an exact owner in By address and returns to the wallet vault', async () => {
	const loads: string[] = []
	await renderHarness(<VaultSelectionHarness onLoad={owner => loads.push(owner)} />)
	const page = within(document.body)
	await act(() => fireEvent.click(page.getByRole('button', { name: 'By address' })))
	expect(page.getByRole('button', { name: 'By address' }).getAttribute('aria-pressed')).toBe('true')
	const input = page.getByRole('textbox', { name: 'Vault owner address' })
	expect(input.closest('details')).toBeNull()
	loads.length = 0
	await act(() => fireEvent.input(input, { target: { value: otherOwner } }))
	expect(loads).toEqual([])
	expect(document.querySelector('.vault-detail-hero')).toBeNull()
	await act(() => fireEvent.click(page.getByRole('button', { name: 'Open vault' })))
	expect(loads).toContain(otherOwner)
	expect(page.getByRole('button', { name: 'By address' }).getAttribute('aria-pressed')).toBe('true')
	expect(page.getByRole('button', { name: 'Copy address ' + otherOwner })).not.toBeNull()
	expect(document.querySelector('.vault-detail-hero')?.textContent).toContain('17.00')
	await act(() => fireEvent.click(page.getByRole('button', { name: 'My vault' })))
	expect(loads).toContain(zeroAddress)
	expect(page.getByRole('button', { name: 'My vault' }).getAttribute('aria-pressed')).toBe('true')
	expect(document.querySelector('.vault-detail-hero')?.textContent).toContain('5.00')
	expect(page.queryByRole('textbox', { name: 'Vault owner address' })).toBeNull()
})

test('follows URL-controlled vault views instead of resetting them to the wallet default', async () => {
	const selectedViews: string[] = []
	const props = createSecurityPoolWorkflowProps({
		accountState: createAccountState({ address: zeroAddress }),
		securityPoolAddress: zeroAddress,
		selectedPoolView: 'vaults',
		securityPools: [createSelectedPool({ hasLoadedVaults: true, vaults: [createSecurityVaultDetails(), createSecurityVaultDetails({ vaultAddress: otherOwner })] })],
		controlledVaultView: 'vault-by-address',
		onVaultViewChange: view => selectedViews.push(view),
		securityVault: createSecurityVaultProps({
			securityVaultForm: { depositAmount: '', repWithdrawAmount: '', targetHealthFactor: '', securityPoolAddress: zeroAddress, selectedVaultOwner: otherOwner },
		}),
	})
	const rendered = await renderHarness(<SecurityPoolWorkflowSection {...props} />)
	expect(within(document.body).getByRole('button', { name: 'By address' }).getAttribute('aria-pressed')).toBe('true')
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	expect(selectedViews).toEqual(['browse-vaults'])
	await act(() => render(<SecurityPoolWorkflowSection {...props} controlledVaultView='browse-vaults' />, rendered.container))
	expect(within(document.body).getByRole('button', { name: 'All vaults' }).getAttribute('aria-pressed')).toBe('true')
	await act(() => render(<SecurityPoolWorkflowSection {...props} controlledVaultView='vault-by-address' />, rendered.container))
	expect(within(document.body).getByRole('button', { name: 'By address' }).getAttribute('aria-pressed')).toBe('true')
})

test('offers directory liquidation only for other vaults and shows why a healthy vault cannot be liquidated', async () => {
	const unhealthyOwner = getAddress('0x0000000000000000000000000000000000000002')
	const walletOwner = getAddress('0x0000000000000000000000000000000000000003')
	const opened: Address[] = []
	await renderHarness(
		<SecurityPoolWorkflowSection
			{...createSecurityPoolWorkflowProps({
				accountState: createAccountState({ address: walletOwner }),
				onOpenLiquidationModal: (_manager, _pool, vaultAddress) => opened.push(vaultAddress),
				poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 10n ** 18n }),
				// The rows' health uses the same UI price estimate as the selected vault's verdict.
				repPerEthPrice: 10n ** 18n,
				securityPoolAddress: zeroAddress,
				securityPools: [
					createSelectedPool({
						hasLoadedVaults: true,
						statoblastSecurityMultiplierBps: 20_000n,
						vaultCount: 3n,
						vaults: [createSecurityVaultDetails({ vaultAddress: walletOwner }), createSecurityVaultDetails({ vaultAddress: otherOwner, vaultAttoRepBacking: 17n * 10n ** 18n }), createSecurityVaultDetails({ vaultAddress: unhealthyOwner, vaultAttoRepBacking: 1n * 10n ** 18n })],
					}),
				],
				selectedPoolView: 'vaults',
			})}
		/>,
	)
	const getRow = (address: Address) => {
		const row = within(document.body)
			.getByRole('button', { name: 'Copy address ' + address })
			.closest('.vault-position-strip')
		if (!(row instanceof HTMLElement)) throw new Error('Expected vault record')
		return within(row)
	}
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	expect(document.querySelector('.vault-more-actions')).toBeNull()
	expect(getRow(walletOwner).queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
	const healthyButton = getRow(otherOwner).getByRole('button', { name: 'Liquidate vault' })
	expect(healthyButton.hasAttribute('disabled')).toBe(true)
	const reason = document.getElementById(healthyButton.getAttribute('aria-describedby') ?? '')
	expect(reason?.textContent).toBe('The target vault is not liquidatable at the current price.')
	const unhealthyButton = getRow(unhealthyOwner).getByRole('button', { name: 'Liquidate vault' })
	expect(unhealthyButton.hasAttribute('disabled')).toBe(false)
	// The underwater vault leads the list with its verdict, and its liquidation is the row's main action.
	const rows = Array.from(document.querySelectorAll('.vault-position-strip'))
	expect(rows.map(row => row.querySelector('.vault-health')?.textContent)).toEqual(['Underwater', 'Healthy', 'Healthy'])
	expect(rows[0]?.classList.contains('is-underwater')).toBe(true)
	expect(within(rows[0] instanceof HTMLElement ? rows[0] : document.body).getByRole('button', { name: 'Liquidate vault' })).toBe(unhealthyButton)
	expect(unhealthyButton.classList.contains('primary')).toBe(true)
	expect(healthyButton.classList.contains('secondary')).toBe(true)
	expect(getRow(walletOwner).getByText('Owned')).not.toBeNull()
	await act(() => fireEvent.click(unhealthyButton))
	expect(opened).toEqual([unhealthyOwner])
})

test('keeps a blocked liquidation secondary even when the UI price reads the vault as underwater', async () => {
	const unhealthyOwner = getAddress('0x0000000000000000000000000000000000000002')
	await renderHarness(
		<SecurityPoolWorkflowSection
			{...createSecurityPoolWorkflowProps({
				// The protocol guard uses the oracle price, at which the vault stays healthy, so the UI estimate's verdict cannot make liquidation the row's main action.
				poolOracleManagerDetails: createOracleManagerDetails({ lastPrice: 10n ** 16n }),
				repPerEthPrice: 10n ** 18n,
				securityPoolAddress: zeroAddress,
				securityPools: [
					createSelectedPool({
						hasLoadedVaults: true,
						statoblastSecurityMultiplierBps: 20_000n,
						vaultCount: 1n,
						vaults: [createSecurityVaultDetails({ vaultAddress: unhealthyOwner, vaultAttoRepBacking: 1n * 10n ** 18n })],
					}),
				],
				selectedPoolView: 'vaults',
			})}
		/>,
	)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	expect(document.querySelector('.vault-position-strip .vault-health')?.textContent).toBe('Underwater')
	const liquidateButton = within(document.body).getByRole('button', { name: 'Liquidate vault' })
	expect(liquidateButton.hasAttribute('disabled')).toBe(true)
	expect(liquidateButton.classList.contains('secondary')).toBe(true)
})

test('shows no health verdicts or risk ordering in an ended pool, where liquidation no longer applies', async () => {
	const unhealthyOwner = getAddress('0x0000000000000000000000000000000000000002')
	await renderHarness(
		<SecurityPoolWorkflowSection
			{...createSecurityPoolWorkflowProps({
				repPerEthPrice: 10n ** 18n,
				securityPoolAddress: zeroAddress,
				securityPools: [
					createSelectedPool({
						hasLoadedVaults: true,
						questionOutcome: 'yes',
						statoblastSecurityMultiplierBps: 20_000n,
						vaultCount: 2n,
						vaults: [createSecurityVaultDetails({ vaultAddress: otherOwner, vaultAttoRepBacking: 17n * 10n ** 18n }), createSecurityVaultDetails({ vaultAddress: unhealthyOwner, vaultAttoRepBacking: 1n * 10n ** 18n })],
					}),
				],
				selectedPoolView: 'vaults',
			})}
		/>,
	)
	await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'All vaults' })))
	const rows = Array.from(document.querySelectorAll('.vault-position-strip'))
	expect(rows).toHaveLength(2)
	expect(document.querySelector('.vault-position-strip .vault-health')).toBeNull()
	expect(document.querySelector('.vault-position-strip.is-underwater')).toBeNull()
	// Rows keep the registry's order rather than leading with the riskiest.
	expect(rows[0]?.textContent).toContain(otherOwner.slice(-4))
})

test('removes the liquidation launcher from the connected wallet’s own vault', async () => {
	await renderHarness(<VaultSelectionHarness />)
	expect(within(document.body).getByRole('button', { name: 'My vault' }).getAttribute('aria-pressed')).toBe('true')
	expect(within(document.body).queryByRole('button', { name: 'Liquidate vault' })).toBeNull()
	expect(document.body.textContent).not.toContain('Choose another vault to liquidate.')
})
