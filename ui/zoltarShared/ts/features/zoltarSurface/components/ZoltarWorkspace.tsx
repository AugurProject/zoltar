import { createContext, type ComponentChildren } from 'preact'
import { useContext } from 'preact/hooks'
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import type { AccountState } from '../../../types/app.js'
import type { useQuestionCreation } from '../../questions/hooks/useQuestionCreation.js'
import type { ZoltarView } from '../../types.js'

/**
 * Everything the Zoltar route containers read. The operation hooks run once in the application shell so drafts,
 * fork question selection, and pending transactions survive switching views; each container takes only its slice.
 */
export type ZoltarWorkspace = {
	accountState: AccountState
	activeUniverseId: bigint
	currentTimestamp: bigint | undefined
	environmentRefreshKey: number
	isConnectingWallet: boolean
	onConnectWallet: () => void
	onGoToGenesisUniverse: () => void
	onRetryUniverse: () => void
	onSwitchNetwork: () => void
	onViewChange: (view: ZoltarView) => void
	operations: ReturnType<typeof useQuestionCreation>
	universeError: string | undefined
	universeState: LoadableValueState
}

const ZoltarWorkspaceContext = createContext<ZoltarWorkspace | undefined>(undefined)

export function ZoltarWorkspaceProvider({ children, workspace }: { children: ComponentChildren; workspace: ZoltarWorkspace }) {
	return <ZoltarWorkspaceContext.Provider value={workspace}>{children}</ZoltarWorkspaceContext.Provider>
}

export function useZoltarWorkspace() {
	const workspace = useContext(ZoltarWorkspaceContext)
	if (workspace === undefined) throw new Error('Zoltar route containers must render inside ZoltarWorkspaceProvider')
	return workspace
}
