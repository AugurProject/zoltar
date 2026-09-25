import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import { useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import type { SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { setCoverageOffer } from '../../../protocol/coverage.js'
import * as copy from '../../../copy/securityPool.js'

export function CoverageOfferForm({ details, account, blocker, onSaved }: { details: SecurityVaultDetails | undefined; account: Address | undefined; blocker: string | undefined; onSaved: () => void }) {
	const [limitInput, setLimitInput] = useState<string | undefined>(undefined)
	const [healthInput, setHealthInput] = useState<string | undefined>(undefined)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string | undefined>(undefined)
	const [saved, setSaved] = useState(false)
	const limit = limitInput ?? formatCurrencyInputBalance(details?.coverageOffer?.maximumObligationAttoEth ?? 0n, 18)
	const health = healthInput ?? formatCurrencyInputBalance(details?.coverageOffer?.minimumHealthFactorBps || 10_000n, 4)
	const amount = tryParseDecimalInput(limit, 18) ?? 0n
	const factor = tryParseDecimalInput(health, 4) ?? 0n
	const owner = account !== undefined && details?.vaultAddress.toLowerCase() === account.toLowerCase()
	const prerequisite = blocker ?? (!owner || details?.coverageOffer === undefined ? copy.coverageOfferUnavailable : undefined)
	const validation = amount <= 0n || factor < 10_000n ? copy.coverageOfferInvalid : undefined
	const save = async (enabled: boolean) => {
		if (pending || prerequisite !== undefined || account === undefined || details === undefined || (enabled && validation !== undefined)) return
		setPending(true)
		setSaved(false)
		setError(undefined)
		try {
			await setCoverageOffer(createWalletWriteClient(account), details.securityPoolAddress, enabled, enabled ? amount : (details.coverageOffer?.maximumObligationAttoEth ?? 0n), enabled ? factor : (details.coverageOffer?.minimumHealthFactorBps ?? 10_000n))
			setSaved(true)
			onSaved()
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause))
		} finally {
			setPending(false)
		}
	}
	return (
		<div className='form-grid'>
			<p className='detail'>{details?.coverageOffer?.enabled ? copy.coverageOfferEnabled : copy.coverageOfferDisabled}</p>
			<p className='detail'>{copy.coverageOfferHelp}</p>
			<label className='field'>
				<span>{copy.coverageOfferLimit}</span>
				<FormInput
					inputMode='decimal'
					value={limit}
					disabled={pending}
					onInput={event => {
						setLimitInput(event.currentTarget.value)
						setSaved(false)
						setError(undefined)
					}}
				/>
			</label>
			<label className='field'>
				<span>{copy.coverageOfferHealth}</span>
				<FormInput
					inputMode='decimal'
					value={health}
					disabled={pending}
					onInput={event => {
						setHealthInput(event.currentTarget.value)
						setSaved(false)
						setError(undefined)
					}}
				/>
			</label>
			<div className='actions'>
				<TransactionActionButton
					idleLabel={details?.coverageOffer?.enabled ? copy.saveCoverageOffer : copy.enableCoverageOffer}
					pendingLabel={copy.savingCoverageOffer}
					pending={pending}
					availability={{ disabled: pending || prerequisite !== undefined || validation !== undefined, reason: prerequisite ?? validation }}
					onClick={() => void save(true)}
				/>
				<TransactionActionButton
					tone='secondary'
					idleLabel={copy.disableCoverageOffer}
					pendingLabel={copy.savingCoverageOffer}
					pending={pending}
					availability={{ disabled: pending || prerequisite !== undefined || details?.coverageOffer?.enabled !== true, reason: prerequisite ?? (details?.coverageOffer?.enabled === true ? undefined : copy.coverageOfferDisabled) }}
					onClick={() => void save(false)}
				/>
			</div>
			{saved ? <p role='status'>{copy.coverageOfferSaved}</p> : undefined}
			<ErrorNotice message={error} />
		</div>
	)
}
