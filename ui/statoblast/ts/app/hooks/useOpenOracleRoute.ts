import { useSettledPoolOracleManagerRefresh } from './useSettledPoolOracleManagerRefresh.js'
import { useOpenOracleOperations } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleOperations.js'
import { useOpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOraclePriceCoordinator.js'
import { resolveEnumValue, resolveFirstMatchingValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import type { WriteOperationsParameters } from '@zoltar/ui-zoltar-shared/types/app.js'
import type { OpenOracleSectionProps, OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'

export function useOpenOracleRoute({
	accountState,
	activeEnvironmentNonce,
	canReadOnchainData,
	navigate,
	openOracleView,
	route,
	setOpenOracleReport,
	setOpenOracleView,
	urlOpenOracleReportId,
	walletScopedHookConfig,
}: {
	accountState: OpenOracleSectionProps['accountState']
	activeEnvironmentNonce: number
	canReadOnchainData: boolean
	navigate: (route: 'deploy' | 'open-oracle' | 'pools') => void
	openOracleView: string
	route: string
	setOpenOracleReport: (reportId: string, historyMode?: 'push' | 'replace') => void
	setOpenOracleView: (view: OpenOracleView) => void
	urlOpenOracleReportId: string
	walletScopedHookConfig: WriteOperationsParameters
}) {
	const openOraclePriceCoordinator = useOpenOraclePriceCoordinator(walletScopedHookConfig)
	const { loadPoolOracleManager, poolOracleManagerDetails } = openOraclePriceCoordinator
	const onReportSettled = useSettledPoolOracleManagerRefresh(poolOracleManagerDetails?.managerAddress, loadPoolOracleManager)
	const { approveToken1, approveToken2, cancelWithdrawalBalanceCheck, createOpenOracleGame, disputeReport, loadOracleReport, openOracleSectionState, openOracleForm, setOpenOracleCreateForm, setOpenOracleForm, settleReport, withdrawBalance } = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: (route === 'open-oracle' || route === 'pools') && canReadOnchainData,
		onReportSettled,
	})
	const openOracleViews: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, openOracleViews)
	const onViewPendingReport = (reportId: bigint) => {
		// Open the Advanced route first, then record the report on that entry, so Back returns to the pool page that linked here.
		navigate('open-oracle')
		setOpenOracleReport(reportId.toString(), 'replace')
		setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
		void loadOracleReport(reportId.toString())
	}
	const openOracleRouteContentProps: OpenOracleSectionProps = {
		...openOracleSectionState,
		accountState,
		activeView: activeOpenOracleView,
		environmentReady: canReadOnchainData,
		environmentRefreshKey: activeEnvironmentNonce,
		onActiveViewChange: view => setOpenOracleView(view),
		onApproveToken1: amount => void approveToken1(amount),
		onApproveToken2: amount => void approveToken2(amount),
		onCancelOpenOracleWithdrawalBalanceCheck: () => cancelWithdrawalBalanceCheck(),
		onCreateOpenOracleGame: () => void createOpenOracleGame(),
		onDisputeReport: () => void disputeReport(),
		onLoadOracleReport: reportId => {
			const selectedReportId = (reportId ?? openOracleForm.reportId).trim()
			if (route === 'open-oracle' && selectedReportId !== '' && selectedReportId !== urlOpenOracleReportId) setOpenOracleReport(selectedReportId)
			void loadOracleReport(selectedReportId)
		},
		onOpenOracleFormChange: update => setOpenOracleForm(current => ({ ...current, ...update })),
		onOpenOracleCreateFormChange: update => setOpenOracleCreateForm(current => ({ ...current, ...update })),
		onSettleReport: () => void settleReport(),
		onWithdrawOpenOracleBalance: (balance, reviewedAmount) => void withdrawBalance(balance, reviewedAmount),
		openOracleForm,
	}
	return {
		activeOpenOracleView,
		loadOracleReport,
		onViewPendingReport,
		openOracleRouteContentProps,
		openOraclePriceCoordinator,
		setOpenOracleForm,
	}
}
