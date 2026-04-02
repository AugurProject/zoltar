import { useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'
import { readSecurityPoolQueryParam, readUniverseQueryParam, writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'

type UrlState = {
	activeUniverseId: bigint
	securityPoolAddress: string
}

type UseUrlStateResult = UrlState & {
	setActiveUniverseId: (universeId: bigint | undefined) => void
	setSecurityPoolAddress: (securityPoolAddress: string) => void
}

function readUrlState(search: string): UrlState {
	return {
		activeUniverseId: readUniverseQueryParam(search) ?? 0n,
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

	const setSecurityPoolAddress = (securityPoolAddress: string) => {
		const nextSearch = writeSecurityPoolQueryParam(window.location.search, securityPoolAddress === '' ? undefined : securityPoolAddress)
		replaceCurrentUrl(nextSearch)
		urlState.value = readUrlState(nextSearch)
	}

	return {
		activeUniverseId: urlState.value.activeUniverseId,
		securityPoolAddress: urlState.value.securityPoolAddress,
		setActiveUniverseId,
		setSecurityPoolAddress,
	}
}
