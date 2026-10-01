import { expect, test } from 'bun:test'
import type { FormStateSetter } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { getDefaultForkAuctionFormState, getDefaultSecurityPoolFormState, getDefaultSecurityVaultFormState, getDefaultTradingFormState } from '@zoltar/ui-statoblast-shared/features/markets/lib/marketForm.js'
import type { ReportingFormState } from '@zoltar/ui-statoblast-shared/types/app.js'
import { createSecurityPoolsRouteFormSync } from '../../app/lib/routeFormSync.js'

function createFormStore<T>(initial: T) {
	let current = initial
	const setForm: FormStateSetter<T> = updater => {
		current = updater(current)
	}
	return { read: () => current, setForm }
}

function createForms() {
	const forkAuction = createFormStore(getDefaultForkAuctionFormState())
	const securityPool = createFormStore(getDefaultSecurityPoolFormState())
	const securityVault = createFormStore(getDefaultSecurityVaultFormState())
	const trading = createFormStore(getDefaultTradingFormState())
	const reportingUpdates: Partial<ReportingFormState>[] = []
	const formSync = createSecurityPoolsRouteFormSync({
		setForkAuctionForm: forkAuction.setForm,
		setSecurityPoolForm: securityPool.setForm,
		setSecurityVaultForm: securityVault.setForm,
		setTradingForm: trading.setForm,
		updateReportingForm: update => reportingUpdates.push(update),
	})
	return { forkAuction, formSync, reportingUpdates, securityPool, securityVault, trading }
}

test('copies the route pool address into every pool form', () => {
	const { forkAuction, formSync, reportingUpdates, securityVault, trading } = createForms()
	const securityPoolAddress = '0x1111111111111111111111111111111111111111'

	formSync.setSecurityPoolAddress(securityPoolAddress)

	expect(securityVault.read().securityPoolAddress).toBe(securityPoolAddress)
	expect(trading.read().securityPoolAddress).toBe(securityPoolAddress)
	expect(forkAuction.read().securityPoolAddress).toBe(securityPoolAddress)
	expect(reportingUpdates).toEqual([{ securityPoolAddress }])
})

test('keeps the current form objects when the route values are unchanged', () => {
	const { forkAuction, formSync, securityPool, securityVault, trading } = createForms()
	const before = { forkAuction: forkAuction.read(), securityPool: securityPool.read(), securityVault: securityVault.read(), trading: trading.read() }

	formSync.setSecurityPoolAddress(before.securityVault.securityPoolAddress)
	formSync.setSecurityPoolQuestionId(before.securityPool.marketId)
	formSync.setSelectedVaultOwner(before.securityVault.selectedVaultOwner)

	expect(forkAuction.read()).toBe(before.forkAuction)
	expect(securityPool.read()).toBe(before.securityPool)
	expect(securityVault.read()).toBe(before.securityVault)
	expect(trading.read()).toBe(before.trading)
})

test('copies the route question and vault owner into their forms', () => {
	const { formSync, securityPool, securityVault } = createForms()

	formSync.setSecurityPoolQuestionId('0x42')
	formSync.setSelectedVaultOwner('0x2222222222222222222222222222222222222222')

	expect(securityPool.read().marketId).toBe('0x42')
	expect(securityVault.read().selectedVaultOwner).toBe('0x2222222222222222222222222222222222222222')
})
