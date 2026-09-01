/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installZoltarRouting } from '../../lib/routing.js'

describe('Zoltar App route validation', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
		installZoltarRouting()
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	async function renderAppForRoute({ hash, route, zoltarView }: { hash: string; route: 'deploy' | 'not-found' | 'zoltar'; zoltarView: string }) {
		window.location.hash = hash
		mock.module('@zoltar/ui-core-shared/app/components/AppHeaderShell.js', () => ({ AppHeaderShell: ({ overview }: { overview: unknown }) => <div>{overview}</div> }))
		mock.module('@zoltar/ui-core-shared/app/components/AppPageHeading.js', () => ({ AppPageHeading: () => <div>heading</div> }))
		mock.module('@zoltar/ui-core-shared/app/components/AppStatusNotices.js', () => ({ AppStatusNotices: () => <div>notices</div> }))
		mock.module('@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js', () => ({ ProtocolAppFrame: ({ children }: { children: unknown }) => <div>{children}</div> }))
		mock.module('@zoltar/ui-core-shared/app/components/RouteSubNavigation.js', () => ({ RouteSubNavigation: () => <div>subnav</div> }))
		mock.module('../../app/components/AppRouteContent.js', () => ({ AppRouteContent: ({ route: activeRoute }: { route: string }) => <div>{`route:${activeRoute}`}</div> }))
		mock.module('../../app/components/OverviewPanels.js', () => ({ OverviewPanels: () => <div>overview</div> }))
		mock.module('../../app/hooks/useAppRouteEffects.js', () => ({ useAppRouteEffects: () => undefined }))
		mock.module('../../features/deployment/hooks/useDeploymentFlow.js', () => ({ useDeploymentFlow: () => ({ errorMessage: undefined }) }))
		mock.module('../../features/deployment/lib/deploymentRoute.js', () => ({ buildDeploymentRouteContentProps: () => ({}) }))
		mock.module('@zoltar/ui-core-shared/app/hooks/useHashRoute.js', () => ({ useHashRoute: () => ({ navigate: () => undefined, route }) }))
		mock.module('@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js', () => ({
			useProtocolOnchainRuntime: () => ({
				accountState: { address: undefined, chainId: undefined, ethBalanceAttoEth: 0n, wethBalanceAttoEth: 0n },
				activeEnvironmentNonce: 0,
				applicationDeploymentComplete: true,
				baseHookConfig: {},
				canReadOnchainData: true,
				changeWallet: async () => undefined,
				chainClockError: undefined,
				connectWallet: async () => undefined,
				currentBlockNumber: undefined,
				currentTimestamp: undefined,
				deploymentStatusError: undefined,
				deploymentStatuses: [],
				disconnectWallet: async () => undefined,
				environmentBootstrapError: undefined,
				environmentReady: true,
				errorMessages: [],
				hasLoadedDeploymentStatuses: true,
				isConnectingWallet: false,
				isLoadingDeploymentStatuses: false,
				isManagingWallet: false,
				isOnActiveAppChain: true,
				isRefreshing: false,
				readBackendMessage: undefined,
				readBackendReady: true,
				readBackendStatus: 'ready',
				refreshState: async () => undefined,
				setActiveEnvironmentNonce: () => undefined,
				setDeploymentStatuses: () => undefined,
				switchNetwork: async () => undefined,
				transactionTray: { transactionState: { value: undefined } },
				walletBootstrapComplete: true,
				walletScopedHookConfig: {},
			}),
		}))
		mock.module('../../features/questions/hooks/useQuestionCreation.js', () => ({
			useQuestionCreation: () => ({
				approveZoltarForkRep: async () => undefined,
				createChildUniverse: async () => undefined,
				forkZoltar: async () => undefined,
				hasLoadedZoltarQuestions: true,
				loadingZoltarForkAccess: false,
				loadingZoltarQuestionCount: false,
				loadingZoltarQuestion: false,
				loadingZoltarQuestions: false,
				loadingZoltarUniverse: false,
				loadZoltarQuestionPage: async () => undefined,
				loadZoltarQuestion: async () => undefined,
				loadZoltarQuestions: async () => undefined,
				loadZoltarUniverse: async () => undefined,
				migrateInternalRep: async () => undefined,
				prepareRepForMigration: async () => undefined,
				createQuestion: async () => undefined,
				questionCreating: false,
				questionError: undefined,
				questionForm: { answerUnit: '', categoryOutcomes: [''], description: '', displayValueMax: '', displayValueMin: '', endTime: '', feePerCashInAttoCash: '', marketType: 'binary', noShowBondInAttoCash: '', outcomeStructure: 'yes-no', startTime: '', title: '', tickSize: '', yesNoUnknownCount: '2' },
				questionResult: undefined,
				resetQuestion: () => undefined,
				setQuestionForm: () => undefined,
				setZoltarForkQuestionId: () => undefined,
				setZoltarMigrationForm: () => undefined,
				zoltarChildUniverseError: undefined,
				zoltarChildUniversePendingOutcomeIndex: undefined,
				zoltarForkApproval: { error: undefined, loading: false, value: 0n },
				zoltarForkActiveAction: undefined,
				zoltarForkError: undefined,
				zoltarForkPending: false,
				zoltarForkQuestionId: undefined,
				zoltarForkRepBalanceAttoRep: undefined,
				zoltarMigrationChildRepBalancesAttoRep: [],
				zoltarMigrationActiveAction: undefined,
				zoltarMigrationError: undefined,
				zoltarMigrationForm: { amount: '', destinationUniverseIds: '' },
				zoltarMigrationPending: false,
				zoltarMigrationPreparedRepBalanceAttoRep: undefined,
				zoltarQuestionCount: undefined,
				zoltarQuestionLookupError: undefined,
				zoltarQuestionLookupId: undefined,
				zoltarQuestionPage: undefined,
				zoltarQuestions: [],
				zoltarQuestionsError: undefined,
				zoltarUniverse: undefined,
				zoltarUniverseError: undefined,
				zoltarUniverseMissing: false,
			}),
		}))
		mock.module('../../app/hooks/useZoltarUrlState.js', () => ({
			useZoltarUrlState: () => ({
				activeUniverseId: 0n,
				replaceZoltarView: () => undefined,
				setActiveUniverseId: () => undefined,
				setZoltarView: () => undefined,
				zoltarView,
			}),
		}))
		mock.module('@zoltar/ui-core-shared/lib/activeEnvironment.js', () => ({
			getActiveNetworkProfile: () => ({ chainName: 'Ethereum Mainnet' }),
			getActiveSimulationController: () => undefined,
			initializeActiveEnvironment: async () => undefined,
		}))
		mock.module('../../app/lib/appPageTitle.js', () => ({
			formatAppDocumentTitle: (pageTitle: string) => pageTitle,
			getAppPageTitle: ({ route: activeRoute }: { route: string }) => activeRoute,
		}))
		mock.module('../../app/onchainStateDependencies.js', () => ({ onchainStateDependencies: {} }))
		const { App } = await import(`../../app/App.js?case=${crypto.randomUUID()}`)
		const renderedComponent = await renderIntoDocument(<App />)
		cleanupRenderedComponent = renderedComponent.cleanup
		return within(document.body)
	}

	test('renders not found for wrong-route, empty, and unknown zoltar views', async () => {
		for (const [hash, zoltarView] of [
			['#/deploy?zoltarView=questions', 'questions'],
			['#/deploy?zoltarView=', ''],
			['#/deploy?zoltarView=bad-view', 'bad-view'],
		] as const) {
			const documentQueries = await renderAppForRoute({ hash, route: 'deploy', zoltarView })
			expect(documentQueries.getByText('route:not-found')).not.toBeNull()
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			mock.restore()
		}
	})

	test('keeps valid zoltar views on the zoltar route', async () => {
		const documentQueries = await renderAppForRoute({ hash: '#/zoltar?zoltarView=questions', route: 'zoltar', zoltarView: 'questions' })
		expect(documentQueries.getByText('route:zoltar')).not.toBeNull()
	})
})
