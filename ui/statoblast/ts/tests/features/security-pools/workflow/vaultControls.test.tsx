import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { createAccountState, createSecurityVaultForm, createSecurityVaultProps } from './builders.js'
import { useSecurityPoolWorkflowSectionTestDom } from './testDom.js'

installTestRouting()
describe('SecurityPoolWorkflowSection: vault controls', () => {
	const { renderLoadedPool } = useSecurityPoolWorkflowSectionTestDom()

	test('auto-loads the selected vault without presenting manual refresh guidance', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultForm: createSecurityVaultForm(),
			}),
		})

		expect(within(document.body).queryByText('Refresh the vault to use these actions.')).toBeNull()
		expect(loadSecurityVaultCalls).toContain(undefined)
	})

	test('announces automatic vault loading once without rendering manual refresh blockers', async () => {
		await renderLoadedPool({ securityVault: createSecurityVaultProps({ loadingSecurityVault: true, securityVaultDetails: undefined }) })

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status').textContent).toContain('Loading vault details…')
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()
	})

	test('offers an explicit retry after automatic vault loading fails', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultDetails: undefined,
				securityVaultError: 'Failed to load security vault',
			}),
		})

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed to load security vault')).toBeTruthy()
		expect(documentQueries.queryByText('Refresh the vault to use these actions.')).toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry' }))
		})

		expect(loadSecurityVaultCalls).toEqual([undefined])
	})

	test('does not auto-load a vault when no vault is selected and the wallet is disconnected', async () => {
		const loadSecurityVaultCalls: Array<string | undefined> = []
		await renderLoadedPool({
			accountState: createAccountState({ address: undefined }),
			securityVault: createSecurityVaultProps({
				onLoadSecurityVault: vaultAddress => {
					loadSecurityVaultCalls.push(vaultAddress)
				},
				securityVaultForm: createSecurityVaultForm({ selectedVaultOwner: '' }),
			}),
		})

		expect(loadSecurityVaultCalls.every(vaultAddress => vaultAddress === undefined)).toBe(true)
		expect(within(document.body).queryByText('Enter a vault owner address or connect a wallet to inspect vault details.')).toBeNull()
	})
})
