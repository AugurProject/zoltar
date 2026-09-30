import { useState } from 'preact/hooks'
import * as appCopy from '@zoltar/ui-statoblast-shared/copy/app.js'
import { parseUiPriceOracle, type UiPriceOracle } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'

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
		// Some browsers expose `localStorage` as null when storage is disabled; the default applies then.
		const resolvedStorage: Pick<Storage, 'getItem'> | null | undefined = storage ?? globalThis.localStorage
		const value = parseUiPriceOracle(resolvedStorage?.getItem(PRICE_ORACLE_STORAGE_KEY))
		if (value !== undefined) return value
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
			const storage: Storage | null | undefined = globalThis.localStorage
			if (storage === null || storage === undefined) {
				setError(appCopy.priceOracleSaveFailed)
				return
			}
			storage.setItem(PRICE_ORACLE_STORAGE_KEY, value)
			setError(undefined)
		} catch (caughtError) {
			setError(caughtError instanceof Error ? caughtError.message : appCopy.priceOracleSaveFailed)
		}
	}

	return (
		<label className='app-settings-price-oracle'>
			<span>{appCopy.uiPriceOracle}</span>
			<small>{appCopy.uiPriceOracleScope}</small>
			<select
				value={priceOracle}
				onChange={event => {
					const value = parseUiPriceOracle(event.currentTarget.value)
					if (value !== undefined) savePriceOracle(value)
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
