import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { useEffect, useRef } from 'preact/hooks'
import * as collateralCopy from '../../../copy/collateral.js'
import * as copy from '../../../copy/trading.js'
import type { useTradingCollateral } from '../hooks/useTradingCollateral.js'

type ShareMintAmountFieldProps = {
	funding: ReturnType<typeof useTradingCollateral> | undefined
	sharedBacking: boolean
	hint: string | undefined
	maximumMintAmount: bigint | undefined
	onChange: (amount: string) => void
	value: string
}

export function ShareMintAmountField({ funding, sharedBacking, hint, maximumMintAmount, onChange, value }: ShareMintAmountFieldProps) {
	const collateral = funding?.collateral
	const scope = `${collateral?.securityPool}:${collateral?.universeId}:${collateral?.questionId}:${collateral?.owner}:${value}`
	const currentScope = useRef<string | undefined>(scope)
	currentScope.current = scope
	useEffect(
		() => () => {
			currentScope.current = undefined
		},
		[],
	)
	const findMaximum = funding?.findMaximumMintAmount
	const finding = sharedBacking && funding?.findingMaximumMintAmount === true
	const resolveMaximum = async () => {
		if (collateral === undefined || findMaximum === undefined) return
		const amount = await findMaximum()
		if (amount !== undefined && currentScope.current === scope) onChange(formatCurrencyInputBalance(amount, collateral.decimals))
	}
	const availableHint = sharedBacking ? funding?.maximumMintAmountError : hint
	const find = collateral === undefined || findMaximum === undefined ? undefined : () => void resolveMaximum()
	return (
		<AmountField
			hint={finding ? copy.checkingMintMaximum : availableHint}
			fillMax={sharedBacking ? { amount: undefined, onFind: find, pending: finding } : { amount: maximumMintAmount }}
			label={copy.mintCompleteSetsAmount}
			onChange={onChange}
			unit={collateral?.symbol ?? collateralCopy.fallback}
			decimals={collateral?.decimals ?? 18}
			value={value}
		/>
	)
}
