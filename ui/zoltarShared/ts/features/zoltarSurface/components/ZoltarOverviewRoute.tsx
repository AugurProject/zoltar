import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { deriveZoltarOverviewModel, type ZoltarNextStep, type ZoltarOverviewModel } from '../lib/zoltarViewModels.js'
import type { ZoltarView } from '../../types.js'
import { useZoltarWorkspace } from './ZoltarWorkspace.js'

type NextStepPresentation = { actionLabel: string; detail: string; title: string }

function getNextStepPresentation(nextStep: ZoltarNextStep): NextStepPresentation {
	switch (nextStep.kind) {
		case 'go-to-genesis':
			return { actionLabel: commonCopy.goToGenesisUniverse, detail: zoltarCopy.goToGenesisDetail, title: zoltarCopy.goToGenesisTitle }
		case 'connect-wallet':
			return { actionLabel: commonCopy.connectWallet, detail: zoltarCopy.connectWalletDetail, title: zoltarCopy.connectWalletTitle }
		case 'switch-network':
			return { actionLabel: zoltarCopy.switchNetworkTitle, detail: zoltarCopy.switchNetworkDetail, title: zoltarCopy.switchNetworkTitle }
		case 'migrate-rep':
			return { actionLabel: zoltarCopy.migrateRep, detail: zoltarCopy.migrateRepDetail, title: zoltarCopy.migrateRepTitle }
		case 'open-child-universe':
			return { actionLabel: zoltarCopy.browseUniversesAction, detail: zoltarCopy.openChildUniverseDetail, title: zoltarCopy.openChildUniverseTitle }
		case 'browse-questions':
			return { actionLabel: zoltarCopy.browseQuestionsTitle, detail: zoltarCopy.browseQuestionsDetail, title: zoltarCopy.browseQuestionsTitle }
		default:
			return assertNever(nextStep)
	}
}

type ZoltarOverviewViewProps = {
	currentTimestamp?: bigint | undefined
	isConnectingWallet: boolean
	model: ZoltarOverviewModel
	onConnectWallet: () => void
	onGoToGenesisUniverse: () => void
	onSwitchNetwork: () => void
	onViewChange: (view: ZoltarView) => void
}

function NextStepAction({ isConnectingWallet, nextStep, onConnectWallet, onGoToGenesisUniverse, onSwitchNetwork, onViewChange }: Omit<ZoltarOverviewViewProps, 'model'> & { nextStep: ZoltarNextStep }) {
	const presentation = getNextStepPresentation(nextStep)
	const onClick = () => {
		if (nextStep.kind === 'go-to-genesis') onGoToGenesisUniverse()
		else if (nextStep.kind === 'connect-wallet') onConnectWallet()
		else if (nextStep.kind === 'switch-network') onSwitchNetwork()
		else onViewChange(nextStep.view)
	}
	return (
		<div className={`zoltar-next-step ${nextStep.kind === 'migrate-rep' ? 'needs-attention' : ''}`.trim()}>
			<div className='zoltar-next-step-copy'>
				<strong>{presentation.title}</strong>
				<p className='detail'>{presentation.detail}</p>
			</div>
			<button className='primary' type='button' disabled={nextStep.kind === 'connect-wallet' && isConnectingWallet} onClick={onClick}>
				{presentation.actionLabel}
			</button>
		</div>
	)
}

function renderRepBalance(model: ZoltarOverviewModel) {
	if (model.wallet !== 'connected') return zoltarCopy.connectToSeeRep
	return <CurrencyValue value={model.repBalanceAttoRep} loading={model.repBalanceAttoRep === undefined} suffix={commonCopy.rep} />
}

function renderMigrationStatus(model: ZoltarOverviewModel) {
	if (model.status !== 'forked') return zoltarCopy.migrationAfterFork
	if (model.migratableRepAttoRep === undefined || model.migratableRepAttoRep === 0n) return zoltarCopy.migrationNoDeadline
	return (
		<>
			<CurrencyValue value={model.migratableRepAttoRep} suffix={commonCopy.rep} />
			<span className='detail zoltar-migration-deadline'>{zoltarCopy.migrationNoDeadline}</span>
		</>
	)
}

/** The Overview route body: the protocol model in three sentences, the user's status, and one next step. */
function ZoltarOverviewView({ currentTimestamp, model, ...actions }: ZoltarOverviewViewProps) {
	return (
		<>
			<RouteHeader description={zoltarCopy.overviewDescription} title={zoltarCopy.overview} />
			<SectionBlock title={zoltarCopy.yourStatus} variant='plain'>
				{model.status === 'loading' ? (
					<StateHint presentation={{ key: 'loading', badgeLabel: commonCopy.loading, badgeTone: 'loading', detail: commonCopy.loadingUniverseDetails, detailIsLoading: true }} />
				) : (
					<MetricGrid variant='summary'>
						<MetricField label={commonCopy.universe}>
							<span className='zoltar-overview-universe'>
								{model.universeLabel} {model.status === 'missing' ? <Badge tone='danger'>{commonCopy.notFound}</Badge> : <Badge tone={model.status === 'forked' ? 'warning' : 'ok'}>{model.status === 'forked' ? commonCopy.forked : commonCopy.operational}</Badge>}
							</span>
						</MetricField>
						<MetricField label={zoltarCopy.forkStatus}>{model.forkTime === undefined ? zoltarCopy.notForked : <TimestampValue timestamp={model.forkTime} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} />}</MetricField>
						<MetricField label={zoltarCopy.universeRep}>{renderRepBalance(model)}</MetricField>
						<MetricField label={zoltarCopy.migrationStatus}>{renderMigrationStatus(model)}</MetricField>
					</MetricGrid>
				)}
			</SectionBlock>
			{model.nextStep === undefined ? undefined : (
				<SectionBlock title={zoltarCopy.nextStep} variant='plain'>
					<NextStepAction {...actions} nextStep={model.nextStep} />
				</SectionBlock>
			)}
			<SectionBlock title={zoltarCopy.howZoltarWorks} variant='plain'>
				<ol className='zoltar-model-steps'>
					<li>{zoltarCopy.modelQuestions}</li>
					<li>{zoltarCopy.modelFork}</li>
					<li>{zoltarCopy.modelMigrate}</li>
				</ol>
			</SectionBlock>
		</>
	)
}

/** Default Zoltar landing: reads the selected universe and wallet from the workspace and derives the overview model. */
export function ZoltarOverviewRoute() {
	const { accountState, activeUniverseId, currentTimestamp, isConnectingWallet, onConnectWallet, onGoToGenesisUniverse, onSwitchNetwork, onViewChange, operations, universeState } = useZoltarWorkspace()
	const model = deriveZoltarOverviewModel({
		account: {
			address: accountState.address,
			isOnActiveChain: isActiveAppChain(accountState.chainId),
			preparedMigrationRepAttoRep: operations.zoltarMigrationPreparedRepBalanceAttoRep,
			repBalanceAttoRep: operations.zoltarForkRepBalanceAttoRep,
		},
		activeUniverseId,
		universe: operations.zoltarUniverse,
		universeState,
	})
	return <ZoltarOverviewView currentTimestamp={currentTimestamp} isConnectingWallet={isConnectingWallet} model={model} onConnectWallet={onConnectWallet} onGoToGenesisUniverse={onGoToGenesisUniverse} onSwitchNetwork={onSwitchNetwork} onViewChange={onViewChange} />
}
