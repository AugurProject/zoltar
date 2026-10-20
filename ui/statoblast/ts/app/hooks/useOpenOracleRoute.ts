import type { PriceRequestStatusProps } from '@zoltar/ui-statoblast-shared/features/open-oracle/components/PriceRequestStatusSection.js'
import { useSettledPoolOracleManagerRefresh } from './useSettledPoolOracleManagerRefresh.js'
import { useOpenOracleOperations } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleOperations.js'
import { selectOpenOracleReport } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleRouteSync.js'
import { useOpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOraclePriceCoordinator.js'
import { setFormField } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import type { WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { StatoblastRoute } from '@zoltar/ui-statoblast-shared/types/app.js'

export function useOpenOracleRoute({
	accountState,
	canReadOnchainData,
	navigate,
	route,
	setOpenOracleReport,
	urlOpenOracleReportId,
	walletScopedHookConfig,
}: {
	accountState: PriceRequestStatusProps['accountState']
	canReadOnchainData: boolean
	navigate: (route: Exclude<StatoblastRoute, 'not-found'>) => void
	route: string
	setOpenOracleReport: (reportId: string, historyMode?: 'push' | 'replace') => void
	urlOpenOracleReportId: string
	walletScopedHookConfig: WriteOperationsParameters
}) {
	const openOraclePriceCoordinator = useOpenOraclePriceCoordinator(walletScopedHookConfig)
	const { loadPoolOracleManager, poolOracleManagerDetails } = openOraclePriceCoordinator
	const onReportSettled = useSettledPoolOracleManagerRefresh(poolOracleManagerDetails?.managerAddress, loadPoolOracleManager)
	const { loadOracleReport, openOracleSectionState, openOracleForm, setOpenOracleForm, settleReport } = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: (route === 'open-oracle' || route === 'pools') && canReadOnchainData,
		onReportSettled,
	})
	const onViewPendingReport = (reportId: bigint) => {
		// Open the request status route first, then record the report on that entry, so Back returns to the pool page that linked here.
		navigate('open-oracle')
		setOpenOracleReport(reportId.toString(), 'replace')
		setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
	}
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
		onViewPendingReport,
		openOracleRouteContentProps,
		openOraclePriceCoordinator,
		setOpenOracleReportId: (reportId: string) => setFormField(setOpenOracleForm, 'reportId', reportId),
	}
}
