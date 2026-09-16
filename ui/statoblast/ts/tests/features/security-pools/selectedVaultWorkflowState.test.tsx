import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { expect, test } from 'bun:test'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress, getAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { SecurityPoolWorkflowSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolWorkflowSection.js'
import { createAccountState, createSelectedPool, createSecurityPoolWorkflowProps, createSecurityVaultProps, createSecurityVaultDetails } from './workflow/builders.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
installTestRouting()
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'

const otherOwner = getAddress('0x0000000000000000000000000000000000000001')
function VaultSelectionHarness({ exists = true, loaded = true, connected = true, accountAddress = zeroAddress }: { exists?: boolean; loaded?: boolean; connected?: boolean; accountAddress?: Address }) {
	const [owner, setOwner] = useState(zeroAddress)
	const details = exists ? createSecurityVaultDetails({ vaultAddress: owner }) : createSecurityVaultDetails({ vaultAddress: owner, capacityOwnershipAttoRep: 0n, claimableFeesAttoEth: 0n, vaultAttoRepBacking: 0n, disputeStakedAttoRep: 0n, badDebtAttoEth: 0n })
	return (
		<>
			<output>{owner}</output>
			<SecurityPoolWorkflowSection
				{...createSecurityPoolWorkflowProps({
					accountState: createAccountState({ address: connected ? accountAddress : undefined }),
					securityPoolAddress: zeroAddress,
					securityPools: [createSelectedPool()],
					securityVault: createSecurityVaultProps({
						securityVaultDetails: loaded ? details : undefined,
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
	const dom = installDomEnvironment()
	const rendered = await renderIntoDocument(<VaultSelectionHarness />)
	try {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Directory' })))
		expect(within(document.body).getByRole('button', { name: 'Directory' }).getAttribute('aria-pressed')).toBe('true')
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Inspect another vault' })))
		expect(within(document.body).getByText(otherOwner)).not.toBeNull()
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

for (const connected of [true, false]) {
	test(`defaults to the directory without ${connected ? 'an existing vault' : 'a connected wallet'}`, async () => {
		const dom = installDomEnvironment()
		const rendered = await renderIntoDocument(<VaultSelectionHarness exists={false} connected={connected} />)
		try {
			expect(within(document.body).getByRole('button', { name: 'Directory' }).getAttribute('aria-pressed')).toBe('true')
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

test('does not switch away from a user-selected directory when the vault read finishes', async () => {
	const dom = installDomEnvironment()
	const rendered = await renderIntoDocument(<VaultSelectionHarness loaded={false} />)
	try {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Directory' })))
		await act(() => render(<VaultSelectionHarness loaded />, rendered.container))
		expect(within(document.body).getByRole('button', { name: 'Directory' }).getAttribute('aria-pressed')).toBe('true')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('selects the new wallet vault when the connected account changes', async () => {
	const dom = installDomEnvironment()
	const rendered = await renderIntoDocument(<VaultSelectionHarness />)
	try {
		await act(() => render(<VaultSelectionHarness accountAddress={otherOwner} />, rendered.container))
		expect(within(document.body).getByText(otherOwner)).not.toBeNull()
		expect(within(document.body).getByRole('button', { name: 'My vault' }).getAttribute('aria-pressed')).toBe('true')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
