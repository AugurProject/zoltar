import type { StateCatalog, StateTab } from './browser-types.ts'

export interface SystemRouteState {
	data: StateCatalog | undefined
	activeType: StateTab
	selectedKey: string | undefined
	historyOffset: number
	detailRequestVersion: number
	detailContextVersion: number
	demoHistoryAutoLoadConsumed: boolean
}

export const createSystemRouteState = (): SystemRouteState => ({
	data: undefined,
	activeType: 'pools',
	selectedKey: undefined,
	historyOffset: 0,
	detailRequestVersion: 0,
	detailContextVersion: 0,
	demoHistoryAutoLoadConsumed: false,
})
