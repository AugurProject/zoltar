import type { PriceRequestStatusProps } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { useOpenOracleOperations } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleOperations.js'
import { selectOpenOracleReport } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleRouteSync.js'
import { setFormField } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import type { WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'

export function useOpenOracleRoute({
	accountState,
	canReadOnchainData,
	route,
	setOpenOracleReport,
	urlOpenOracleReportId,
	walletScopedHookConfig,
}: {
	accountState: PriceRequestStatusProps['accountState']
	canReadOnchainData: boolean
	route: string
	setOpenOracleReport: (reportId: string, historyMode?: 'push' | 'replace') => void
	urlOpenOracleReportId: string
	walletScopedHookConfig: WriteOperationsParameters
}) {
	const { loadOracleReport, openOracleSectionState, openOracleForm, setOpenOracleForm, settleReport } = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: (route === 'open-oracle' || route === 'pools') && canReadOnchainData,
	})
	const openOracleRouteContentProps: PriceRequestStatusProps = {
		...openOracleSectionState,
		accountState,
		onLoadOracleReport: reportId => {
			const selectedReportId = (reportId ?? openOracleForm.reportId).trim()
			if (route !== 'open-oracle') {
				void loadOracleReport(selectedReportId)
				return
			}
			selectOpenOracleReport({ reportId: selectedReportId, selectedReportId: urlOpenOracleReportId, onSelectReport: setOpenOracleReport, onRefreshReport: id => void loadOracleReport(id) })
		},
		onOpenOracleFormChange: update => setOpenOracleForm(current => ({ ...current, ...update })),
		onSettleReport: () => void settleReport(),
		openOracleForm,
	}
	return {
		loadOracleReport,
		openOracleRouteContentProps,
		setOpenOracleReportId: (reportId: string) => setFormField(setOpenOracleForm, 'reportId', reportId),
	}
}
