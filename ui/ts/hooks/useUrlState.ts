import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import type { SupportedNetworkKey } from '../shared/networkConfig.js'
import { readNetworkQueryParam, readOpenOracleReportIdQueryParam, readSecurityPoolQueryParam, readUniverseQueryParam, writeNetworkQueryParam, writeOpenOracleReportIdQueryParam, writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'

type UrlState = {
	activeNetworkKey: SupportedNetworkKey
	activeUniverseId: bigint
	openOracleReportId: string
	securityPoolAddress: string
}

type UseUrlStateResult = UrlState & {
	setActiveNetworkKey: (networkKey: SupportedNetworkKey) => void
	setActiveUniverseId: (universeId: bigint | undefined) => void
	setOpenOracleReport: (reportId: string | undefined) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
}

function readUrlState(search: string): UrlState {
	return {
		activeNetworkKey: readNetworkQueryParam(search),
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
		openOracleReportId: readOpenOracleReportIdQueryParam(search) ?? '',
		securityPoolAddress: readSecurityPoolQueryParam(search) ?? '',
	}
}

function replaceCurrentUrl(nextSearch: string) {
	window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}${window.location.hash}`)
}

export function useUrlState(): UseUrlStateResult {
	const urlState = useSignal<UrlState>(readUrlState(window.location.search))

	useEffect(() => {
		const onPopState = () => {
			urlState.value = readUrlState(window.location.search)
		}

		window.addEventListener('popstate', onPopState)
		return () => {
			window.removeEventListener('popstate', onPopState)
		}
	}, [])

	const setActiveUniverseId = (universeId: bigint | undefined) => {
		const nextSearch = writeUniverseQueryParam(window.location.search, universeId)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	const setActiveNetworkKey = (networkKey: SupportedNetworkKey) => {
		const currentSearch = window.location.search
		const currentNetworkKey = readNetworkQueryParam(currentSearch)
		if (currentNetworkKey === networkKey) return

		let nextSearch = writeNetworkQueryParam(currentSearch, networkKey)
		nextSearch = writeSecurityPoolQueryParam(nextSearch, undefined)
		nextSearch = writeOpenOracleReportIdQueryParam(nextSearch, undefined)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	const setSecurityPoolAddress = (securityPoolAddress: string) => {
		const nextSearch = writeSecurityPoolQueryParam(window.location.search, securityPoolAddress === '' ? undefined : securityPoolAddress)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	const setOpenOracleReport = (reportId: string | undefined) => {
		const nextSearch = writeOpenOracleReportIdQueryParam(window.location.search, reportId === '' ? undefined : reportId)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	return {
		activeNetworkKey: urlState.value.activeNetworkKey,
		activeUniverseId: urlState.value.activeUniverseId,
		openOracleReportId: urlState.value.openOracleReportId,
		securityPoolAddress: urlState.value.securityPoolAddress,
		setActiveNetworkKey,
		setActiveUniverseId,
		setOpenOracleReport,
		setSecurityPoolAddress,
	}
}
