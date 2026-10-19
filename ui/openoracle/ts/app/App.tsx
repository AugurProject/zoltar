import { AppHeaderShell } from '@zoltar/ui-core-shared/app/components/AppHeaderShell.js'
import { AppPageHeading } from '@zoltar/ui-core-shared/app/components/AppPageHeading.js'
import { AppStatusNotices } from '@zoltar/ui-core-shared/app/components/AppStatusNotices.js'
import { NotFoundSection } from '@zoltar/ui-core-shared/app/components/NotFoundSection.js'
import { OverviewPanels } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { ProtocolAppFrame } from '@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js'
import { useHashRoute } from '@zoltar/ui-core-shared/app/hooks/useHashRoute.js'
import { useMissingDeploymentRedirect } from '@zoltar/ui-core-shared/app/hooks/useMissingDeploymentRedirect.js'
import { useUrlSearchState } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { formatAppDocumentTitle } from '@zoltar/ui-core-shared/app/lib/appTitle.js'
import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as oracleAppCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { resolveEnumValue } from '@zoltar/ui-core-shared/forms/viewState.js'
import { setFormField } from '@zoltar/ui-core-shared/hooks/useFormState.js'
import { createSecondaryNavigation, withDeploymentTab } from '@zoltar/ui-core-shared/navigation/appNavigation.js'
import { buildRouteHref, getCurrentRouteHash, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { readOpenOracleReportIdQueryParam, readOpenOracleViewQueryParam, writeOpenOracleReportIdQueryParam, writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import { hasInvalidViewQueryParam } from '@zoltar/ui-core-shared/navigation/viewQueryParam.js'
import { useProtocolAppShell } from '@zoltar/ui-zoltar-shared/features/appShell/hooks/useProtocolAppShell.js'
import { DeploymentRouteContent } from '@zoltar/ui-zoltar-shared/features/deployment/components/DeploymentRouteContent.js'
import { getStatoblastDeploymentSections } from '@zoltar/ui-statoblast-shared/features/deployment/deploymentSections.js'
import { OpenOracleSection } from '../features/open-oracle/components/OpenOracleSection.js'
import { useOpenOracleOperations } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleOperations.js'
import { selectOpenOracleReport, useOpenOracleRouteSync } from '@zoltar/ui-statoblast-shared/features/open-oracle/hooks/useOpenOracleRouteSync.js'
import type { OpenOracleView } from '@zoltar/ui-statoblast-shared/features/oracleTypes.js'
import { initializeOpenOracleActiveEnvironment } from './activeEnvironment.js'
import { onchainStateDependencies } from './onchainStateDependencies.js'
import { openOracleRouting } from './routing.js'
import { applicationTitle } from '../copy/app.js'

const views: readonly OpenOracleView[] = ['browse', 'create', 'selected-report']
const viewLabels = { browse: appCopy.browseReports, create: appCopy.createReport, 'selected-report': appCopy.viewReport }
const viewTitles = { browse: appCopy.browseReports, create: oracleAppCopy.createOracleReport, 'selected-report': oracleAppCopy.oracleReportDetails }
const formatDocumentTitle = (title: string) => formatAppDocumentTitle(title, applicationTitle)
const readUrlState = (search: string) => ({ reportId: readOpenOracleReportIdQueryParam(search) ?? '', view: readOpenOracleViewQueryParam(search) ?? '' })

export function App() {
	const { route, navigate } = useHashRoute()
	const { state, navigate: navigateUrl } = useUrlSearchState(readUrlState)
	const invalidView = hasInvalidViewQueryParam({ allowedRoutes: ['open-oracle'], allowedViews: views, key: 'openOracleView', resolvedRoute: route, search: getRouteHashSearch(), value: state.view })
	const activeRoute = invalidView ? 'not-found' : route
	const shell = useProtocolAppShell({
		deploymentRoute: { deploymentCompleteHref: '#/open-oracle', deploymentCompleteLabel: appCopy.browseReports, getSections: getStatoblastDeploymentSections },
		initializeEnvironment: options => initializeOpenOracleActiveEnvironment(window.location, options),
		isDeploymentRoute: route === 'deploy',
		onchainStateDependencies,
	})
	const oracle = useOpenOracleOperations({ ...shell.walletScopedHookConfig, enabled: shell.canReadOnchainData && activeRoute === 'open-oracle' })
	const view = resolveEnumValue(state.view, state.reportId === '' ? 'browse' : 'selected-report', views)
	const setView = (next: OpenOracleView) => navigateUrl('#/open-oracle', writeOpenOracleViewQueryParam(getRouteHashSearch(), next))
	const loadReport = (reportId = oracle.openOracleForm.reportId) => {
		selectOpenOracleReport({
			reportId,
			selectedReportId: state.reportId,
			selectionVisible: view === 'selected-report',
			onSelectReport: id => navigateUrl(getCurrentRouteHash(), writeOpenOracleReportIdQueryParam(writeOpenOracleViewQueryParam(getRouteHashSearch(), 'selected-report'), id)),
			onRefreshReport: id => void oracle.loadOracleReport(id),
		})
	}
	useOpenOracleRouteSync({
		activeEnvironmentNonce: shell.activeEnvironmentNonce,
		environmentReady: shell.canReadOnchainData,
		isOpenOracleRoute: activeRoute === 'open-oracle',
		loadOracleReport: oracle.loadOracleReport,
		reportId: state.reportId,
		setOpenOracleFormReportId: reportId => setFormField(oracle.setOpenOracleForm, 'reportId', reportId),
	})
	useMissingDeploymentRedirect({ isDeploymentRoute: route === 'deploy', missing: shell.applicationDeploymentMissing, navigateToDeployment: () => navigate('deploy') })
	const pageTitle = (() => {
		if (activeRoute === 'deploy') return appCopy.deployContracts
		if (activeRoute === 'open-oracle') return viewTitles[view]
		return appCopy.pageNotFoundTitle
	})()
	const tabs = withDeploymentTab({ deploymentMissing: shell.applicationDeploymentMissing, deploymentIncomplete: shell.showDeployTab, deploymentTab: { hash: '#/deploy', label: commonCopy.deploy, route: 'deploy' }, route: activeRoute, tabs: [{ hash: '#/open-oracle', label: applicationTitle, route: 'open-oracle' }] })
	return (
		<ProtocolAppFrame
			accountAddress={shell.walletScopedAccountAddress}
			currentBlockNumber={shell.currentBlockNumber}
			currentTimestamp={shell.currentTimestamp}
			header={
				<AppHeaderShell
					renderOverview={({ navigation, settingsMenu }) => (
						<OverviewPanels
							{...shell.overviewWalletProps}
							applicationTitle={applicationTitle}
							activeUniverseId={undefined}
							universeRepBalanceAttoRep={undefined}
							isLoadingUniverseRepBalance={false}
							universePresentation={undefined}
							onGoToGenesisUniverse={() => undefined}
							showWethBalance
							navigation={navigation}
							settingsMenu={settingsMenu}
						/>
					)}
					simulationController={shell.simulationController}
					tabNavigation={{ route: activeRoute, tabs, onRouteChange: navigate }}
					secondaryNavigation={
						activeRoute !== 'open-oracle'
							? undefined
							: createSecondaryNavigation({ ariaLabel: oracleAppCopy.oracleReportViews, value: view, onChange: setView, options: views.map(value => ({ value, label: viewLabels[value], href: buildRouteHref('#/open-oracle', writeOpenOracleViewQueryParam(getRouteHashSearch(), value)) })) })
					}
					onEnvironmentChanged={shell.refreshActiveEnvironment}
					onRefresh={shell.refreshSimulationView}
				/>
			}
			heading={<AppPageHeading formatDocumentTitle={formatDocumentTitle} pageTitle={pageTitle} />}
			notices={
				<AppStatusNotices
					errorMessages={shell.errorMessages}
					onRetryReadBackend={() => void shell.retryReadBackend()}
					readBackendMessage={shell.readBackendMessage}
					readBackendStatus={shell.readBackendStatus}
					simulationBootstrapError={shell.environmentBootstrapError}
					showApplicationDeploymentWarning={shell.applicationDeploymentMissing}
				/>
			}
			routeContentDisabled={shell.routeContentBlocked}
			transactionRouteKey={`${activeRoute}:${view}`}
			transactionState={shell.transactionTray.transactionState.value}
			walletActions={shell.overviewWalletProps}
		>
			{activeRoute === 'deploy' ? <DeploymentRouteContent {...shell.deployRouteContentProps} /> : undefined}
			{activeRoute === 'open-oracle' ? (
				<OpenOracleSection
					{...oracle.openOracleSectionState}
					accountState={shell.accountState}
					activeView={view}
					environmentReady={shell.canReadOnchainData}
					environmentRefreshKey={shell.activeEnvironmentNonce}
					onActiveViewChange={setView}
					onApproveToken1={amount => void oracle.approveToken1(amount)}
					onApproveToken2={amount => void oracle.approveToken2(amount)}
					onCancelOpenOracleWithdrawalBalanceCheck={oracle.cancelWithdrawalBalanceCheck}
					onCreateOpenOracleGame={() => void oracle.createOpenOracleGame()}
					onDisputeReport={() => void oracle.disputeReport()}
					onLoadOracleReport={loadReport}
					onOpenOracleCreateFormChange={update => oracle.setOpenOracleCreateForm(current => ({ ...current, ...update }))}
					onOpenOracleFormChange={update => oracle.setOpenOracleForm(current => ({ ...current, ...update }))}
					onSettleReport={() => void oracle.settleReport()}
					onWithdrawOpenOracleBalance={(balance, amount) => void oracle.withdrawBalance(balance, amount)}
					openOracleForm={oracle.openOracleForm}
				/>
			) : undefined}
			{activeRoute !== 'open-oracle' && activeRoute !== 'deploy' ? <NotFoundSection links={[{ href: openOracleRouting.getHash('open-oracle'), label: applicationTitle }]} /> : undefined}
			<TransactionStepsModal contextKey={`${shell.activeEnvironmentNonce}:${shell.walletScopedAccountAddress ?? ''}`} />
		</ProtocolAppFrame>
	)
}
