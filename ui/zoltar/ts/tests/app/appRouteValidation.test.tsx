/// <reference types="bun-types" />

import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installModuleMocks } from '@zoltar/ui-core-shared/tests/testUtils/moduleMocks.js'
import { within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installZoltarRouting } from '@zoltar/ui-zoltar-shared/lib/routing.js'
import { describe, expect, mock, test } from 'bun:test'

describe('Zoltar App route validation', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	const moduleMocks = installModuleMocks(specifier => import.meta.resolve(specifier))

	installDomTestLifecycle({
		beforeTest: () => {
			installZoltarRouting()
			restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend())
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			restoreActiveEnvironment?.()
			restoreActiveEnvironment = undefined
		},
	})

	async function renderAppForRoute({ hash, route, zoltarView }: { hash: string; route: 'deploy' | 'not-found' | 'zoltar'; zoltarView: string }) {
		window.location.hash = hash
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/components/AppHeaderShell.js', () => ({ AppHeaderShell: ({ overview }: { overview: unknown }) => <div>{overview}</div> }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/components/AppPageHeading.js', () => ({ AppPageHeading: () => <div>heading</div> }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/components/AppStatusNotices.js', () => ({ AppStatusNotices: () => <div>notices</div> }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/components/ProtocolAppFrame.js', () => ({ ProtocolAppFrame: ({ children }: { children: unknown }) => <div>{children}</div> }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/components/RouteSubNavigation.js', () => ({ RouteSubNavigation: () => <div>subnav</div> }))
		await moduleMocks.mockModule('../../app/components/AppRouteContent.js', () => ({ AppRouteContent: ({ route: activeRoute }: { route: string }) => <div>{`route:${activeRoute}`}</div> }))
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/overview/OverviewPanels.js', () => ({ OverviewPanels: () => <div>overview</div> }))
		await moduleMocks.mockModule('../../app/hooks/useAppRouteEffects.js', () => ({ useAppRouteEffects: () => undefined }))
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/deployment/hooks/useDeploymentFlow.js', () => ({ useDeploymentFlow: () => ({ errorMessage: undefined }) }))
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/deployment/lib/deploymentRoute.js', () => ({ buildDeploymentRouteContentProps: () => ({}) }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/hooks/useHashRoute.js', () => ({ useHashRoute: () => ({ navigate: () => undefined, route }) }))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js', () => ({
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
		await moduleMocks.mockModule('@zoltar/ui-zoltar-shared/features/questions/hooks/useQuestionCreation.js', () => ({
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
				zoltarMigrationChildSplitAmountsAttoRep: [],
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
		await moduleMocks.mockModule('../../app/hooks/useZoltarUrlState.js', () => ({
			useZoltarUrlState: () => ({
				activeUniverseId: 0n,
				replaceZoltarView: () => undefined,
				setActiveUniverseId: () => undefined,
				setZoltarView: () => undefined,
				zoltarView,
			}),
		}))
		await moduleMocks.mockModule('@zoltar/ui-core-shared/lib/activeEnvironment.js', () => ({
			getActiveSimulationController: () => undefined,
			initializeActiveEnvironment: async () => undefined,
		}))
		await moduleMocks.mockModule('../../app/lib/appPageTitle.js', () => ({
			formatAppDocumentTitle: (pageTitle: string) => pageTitle,
			getAppPageTitle: ({ route: activeRoute }: { route: string }) => activeRoute,
		}))
		await moduleMocks.mockModule('../../app/onchainStateDependencies.js', () => ({ onchainStateDependencies: {} }))
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
