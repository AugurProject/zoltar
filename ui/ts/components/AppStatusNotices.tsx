import { NoticeStack } from './NoticeStack.js'
import { TimestampValue } from './TimestampValue.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import type { NoticeItem } from '../types/components.js'

type AppStatusNoticesProps = {
	errorMessage: string | undefined
	wrongNetworkMessage: string | undefined
	simulationBootstrapError: string | undefined
	showAugurPlaceHolderDeploymentWarning: boolean
	showZoltarUniverseForkedWarning: boolean
	zoltarUniverse: ZoltarUniverseSummary | undefined
}

export function AppStatusNotices({ errorMessage, wrongNetworkMessage, simulationBootstrapError, showAugurPlaceHolderDeploymentWarning, showZoltarUniverseForkedWarning, zoltarUniverse }: AppStatusNoticesProps) {
	const items: NoticeItem[] = []
	if (simulationBootstrapError !== undefined) {
		items.push({ detail: simulationBootstrapError, id: 'simulation-bootstrap-error', tone: 'blocking', title: 'Simulation bootstrap failed' })
	}
	if (showZoltarUniverseForkedWarning && zoltarUniverse !== undefined) {
		items.push({
			detail: (
				<>
					{formatUniverseLabel(zoltarUniverse.universeId)} has forked on <TimestampValue timestamp={zoltarUniverse.forkTime} />.
				</>
			),
			id: 'zoltar-forked',
			tone: 'blocking',
			title: 'Universe forked',
		})
	}
	if (showAugurPlaceHolderDeploymentWarning) {
		items.push({ detail: 'Finish setup in Deploy before using the app.', id: 'setup-incomplete', tone: 'blocking', title: 'Setup incomplete' })
	}
	if (wrongNetworkMessage !== undefined) {
		items.push({
			detail: `This interface only enables contract interactions on Ethereum mainnet. ${wrongNetworkMessage === 'Switch to Ethereum mainnet.' ? 'Switch the connected wallet network to Ethereum mainnet to continue.' : wrongNetworkMessage}`,
			id: 'wrong-network',
			tone: 'blocking',
			title: 'Wrong network',
		})
	}
	if (errorMessage !== undefined) {
		items.push({ detail: errorMessage, id: 'app-error', tone: 'blocking', title: 'Error' })
	}

	return <NoticeStack items={items} />
}
