import { setFormField, type FormStateSetter } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import type { ForkAuctionFormState, ReportingFormState, SecurityPoolFormState, SecurityVaultFormState, TradingFormState } from '@zoltar/ui-statoblast-shared/types/app.js'

type SecurityPoolsRouteForms = {
	setForkAuctionForm: FormStateSetter<ForkAuctionFormState>
	setSecurityPoolForm: FormStateSetter<SecurityPoolFormState>
	setSecurityVaultForm: FormStateSetter<SecurityVaultFormState>
	setTradingForm: FormStateSetter<TradingFormState>
	updateReportingForm: (update: Partial<ReportingFormState>) => void
}

/** Copies the Pools route's URL state into every form that mirrors it; unchanged values keep the current form object. */
export function createSecurityPoolsRouteFormSync({ setForkAuctionForm, setSecurityPoolForm, setSecurityVaultForm, setTradingForm, updateReportingForm }: SecurityPoolsRouteForms) {
	return {
		setSecurityPoolAddress: (securityPoolAddress: string) => {
			setFormField(setSecurityVaultForm, 'securityPoolAddress', securityPoolAddress)
			setFormField(setTradingForm, 'securityPoolAddress', securityPoolAddress)
			setFormField(setForkAuctionForm, 'securityPoolAddress', securityPoolAddress)
			updateReportingForm({ securityPoolAddress })
		},
		setSecurityPoolQuestionId: (questionId: string) => setFormField(setSecurityPoolForm, 'marketId', questionId),
		setSelectedVaultOwner: (selectedVaultOwner: string) => setFormField(setSecurityVaultForm, 'selectedVaultOwner', selectedVaultOwner),
	}
}
