import { useOpenOracleOperations } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleOperations.js'
import { usePriceOracleManager } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/usePriceOracleManager.js'
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
	navigate: (route: 'deploy' | 'open-oracle' | 'security-pools', preservedParams?: Set<string>) => void
	openOracleView: string
	route: string
	setOpenOracleReport: (reportId: string) => void
	setOpenOracleView: (view: OpenOracleView) => void
	urlOpenOracleReportId: string
	walletScopedHookConfig: WriteOperationsParameters
}) {
	const priceOracleManager = usePriceOracleManager(walletScopedHookConfig)
	const { loadPoolOracleManager, poolOracleManagerDetails } = priceOracleManager
	const { approveToken1, approveToken2, cancelWithdrawalBalanceCheck, createOpenOracleGame, disputeReport, loadOracleReport, openOracleSectionState, openOracleForm, setOpenOracleCreateForm, setOpenOracleForm, settleReport, withdrawBalance } = useOpenOracleOperations({
		...walletScopedHookConfig,
		enabled: route === 'open-oracle' && canReadOnchainData,
		onReportSettled: async () => {
			if (poolOracleManagerDetails?.managerAddress !== undefined) await loadPoolOracleManager(poolOracleManagerDetails.managerAddress)
		},
	})
	const openOracleViews: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']
	const derivedOpenOracleView = resolveFirstMatchingValue<OpenOracleView>([[urlOpenOracleReportId !== '' || openOracleForm.reportId !== '', 'selected-report']], 'browse')
	const activeOpenOracleView = resolveEnumValue<OpenOracleView>(openOracleView, derivedOpenOracleView, openOracleViews)
	const onViewPendingReport = (reportId: bigint) => {
		setOpenOracleReport(reportId.toString())
		setOpenOracleForm(current => ({ ...current, reportId: reportId.toString() }))
		navigate('open-oracle', new Set(['securityPool', 'securityPoolsView', 'selectedPoolView']))
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
		onLoadOracleReport: reportId => void loadOracleReport(reportId),
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
		priceOracleManager,
		setOpenOracleForm,
	}
}
