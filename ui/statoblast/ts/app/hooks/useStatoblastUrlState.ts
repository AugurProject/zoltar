import { useCallback } from 'preact/hooks'
import { useUrlSearchState } from '@zoltar/ui-core-shared/app/hooks/useUrlSearchState.js'
import { isHexAddressInput } from '@zoltar/ui-core-shared/lib/address.js'
import { readOpenOracleReportIdQueryParam, readOpenOracleViewQueryParam, writeOpenOracleReportIdQueryParam, writeOpenOracleViewQueryParam } from '@zoltar/ui-core-shared/navigation/openOracleUrlParams.js'
import {
	readSecurityPoolsViewQueryParam,
	readSecurityPoolQuestionIdQueryParam,
	readSecurityPoolQueryParam,
	readSelectedPoolViewQueryParam,
	readUniverseQueryParam,
	writeSecurityPoolsViewQueryParam,
	writeSecurityPoolQuestionIdQueryParam,
	writeSecurityPoolQueryParam,
	writeSelectedPoolViewQueryParam,
	writeUniverseQueryParam,
} from '@zoltar/ui-core-shared/navigation/urlParams.js'

type StatoblastUrlState = {
	activeUniverseId: bigint
	openOracleView: string
	openOracleReportId: string
	securityPoolsView: string
	selectedPoolView: string
	securityPoolAddress: string
	securityPoolQuestionId: string
}

function readStatoblastUrlState(search: string): StatoblastUrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleView: readOpenOracleViewQueryParam(search) ?? '',
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolsView: readSecurityPoolsViewQueryParam(search) ?? '',
		selectedPoolView: readSelectedPoolViewQueryParam(search) ?? '',
		securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
		securityPoolQuestionId: readSecurityPoolQuestionIdQueryParam(search) ?? '',
	}
}

function emptyToUndefined(value: string | undefined) {
	return value === '' ? undefined : value
}

export function useStatoblastUrlState() {
	const { applyUrlStateUpdate, getOwnedSearch, state } = useUrlSearchState(readStatoblastUrlState)
	const writeStringParam = useCallback((write: (search: string, value: string | undefined) => string, value: string | undefined) => applyUrlStateUpdate(write(getOwnedSearch(), emptyToUndefined(value))), [applyUrlStateUpdate, getOwnedSearch])

	const setActiveUniverseId = useCallback((universeId: bigint | undefined) => applyUrlStateUpdate(writeUniverseQueryParam(getOwnedSearch(), universeId)), [applyUrlStateUpdate, getOwnedSearch])
	// Editing keeps one history entry per editing session: the first keystroke away from a complete (or empty) address pushes,
	// later keystrokes replace that entry, and completing an address replaces it too, so Back returns to the previous pool.
	const setSecurityPoolAddress = useCallback(
		(securityPoolAddress: string) => {
			const ownedSearch = getOwnedSearch()
			const currentAddress = readSecurityPoolQueryParam(ownedSearch) ?? ''
			const currentIsPartial = currentAddress !== '' && !isHexAddressInput(currentAddress)
			applyUrlStateUpdate(writeSecurityPoolQueryParam(ownedSearch, emptyToUndefined(securityPoolAddress)), currentIsPartial ? 'replace' : 'push')
		},
		[applyUrlStateUpdate, getOwnedSearch],
	)
	const setSecurityPoolQuestionId = useCallback((questionId: string | undefined) => writeStringParam(writeSecurityPoolQuestionIdQueryParam, questionId), [writeStringParam])
	const setOpenOracleReport = useCallback((reportId: string | undefined) => writeStringParam(writeOpenOracleReportIdQueryParam, reportId), [writeStringParam])
	const setOpenOracleView = useCallback((view: string | undefined) => writeStringParam(writeOpenOracleViewQueryParam, view), [writeStringParam])
	const setSecurityPoolsView = useCallback((view: string | undefined) => writeStringParam(writeSecurityPoolsViewQueryParam, view), [writeStringParam])
	const setSelectedPoolView = useCallback((view: string | undefined) => writeStringParam(writeSelectedPoolViewQueryParam, view), [writeStringParam])

	return {
		...state,
		setActiveUniverseId,
		setOpenOracleReport,
		setOpenOracleView,
		setSecurityPoolsView,
		setSelectedPoolView,
		setSecurityPoolAddress,
		setSecurityPoolQuestionId,
	}
}
