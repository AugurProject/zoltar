import { useState } from 'preact/hooks'
import * as appCopy from '../copy/app.js'
import type { UiPriceOracle } from '../features/security-pools/lib/uiPriceOracle.js'

const PRICE_ORACLE_STORAGE_KEY = 'statoblast.uiPriceOracle'
const priceOracleDescriptions: Record<UiPriceOracle, string> = {
	uniswap: appCopy.uniswapUiPriceDetail,
	'open-oracle': appCopy.openOracleUiPriceDetail,
	'open-oracle-fallback': appCopy.openOracleFallbackUiPriceDetail,
}

function isExpectedStorageReadError(error: unknown) {
	return error instanceof DOMException && error.name === 'SecurityError'
}

export function readUiPriceOracle(storage?: Pick<Storage, 'getItem'>): UiPriceOracle {
	try {
		const resolvedStorage = storage ?? globalThis.localStorage
		const value = resolvedStorage.getItem(PRICE_ORACLE_STORAGE_KEY)
		if (value === 'uniswap' || value === 'open-oracle' || value === 'open-oracle-fallback') return value
	} catch (error) {
		if (!isExpectedStorageReadError(error)) throw error
	}
	return 'open-oracle-fallback'
}

export function UiPriceOracleSettings({ priceOracle, onPriceOracleChange }: { priceOracle: UiPriceOracle; onPriceOracleChange: (value: UiPriceOracle) => void }) {
	const [error, setError] = useState<string | undefined>(undefined)
	const savePriceOracle = (value: UiPriceOracle) => {
		onPriceOracleChange(value)
		try {
			globalThis.localStorage.setItem(PRICE_ORACLE_STORAGE_KEY, value)
			setError(undefined)
		} catch (caughtError) {
			setError(caughtError instanceof Error ? caughtError.message : appCopy.priceOracleSaveFailed)
		}
	}

	return (
		<label className='app-settings-price-oracle'>
			<span>{appCopy.uiPriceOracle}</span>
			<select
				value={priceOracle}
				onChange={event => {
					const value = event.currentTarget.value as UiPriceOracle
					savePriceOracle(value)
				}}
			>
				<option value='uniswap'>{appCopy.uniswap}</option>
				<option value='open-oracle'>{appCopy.latestOpenOraclePrice}</option>
				<option value='open-oracle-fallback'>{appCopy.openOracleThenUniswap}</option>
			</select>
			<small>{priceOracleDescriptions[priceOracle]}</small>
			{error === undefined ? undefined : (
				<small className='field-error' role='alert'>
					{error}
				</small>
			)}
		</label>
	)
}
