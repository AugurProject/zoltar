import { useId, useState } from 'preact/hooks'
import { formatSlippagePercent, parseSlippagePercent, parseValidityMinutes, SLIPPAGE_PRESETS_BPS, VALIDITY_PRESETS_MINUTES, type TradeSettings } from '../lib/tradeSettings.js'
import * as settingsCopy from '../copy/tradeSettings.js'

function PresetRow({ label, presets, value, format, onSelect }: { label: string; presets: readonly bigint[]; value: bigint; format(value: bigint): string; onSelect(value: bigint): void }) {
	return (
		<div className='trade-settings-presets' role='group' aria-label={label}>
			{presets.map(preset => (
				<button key={preset.toString()} type='button' className='trade-settings-preset' aria-pressed={preset === value} onClick={() => onSelect(preset)}>
					{format(preset)}
				</button>
			))}
		</div>
	)
}

/** Trade settings inside the application settings menu: every Trading form reads these instead of its own protection fields. */
export function TradeSettingsPanel({ settings, onChange }: { settings: TradeSettings; onChange(settings: TradeSettings): void }) {
	const id = useId()
	const [slippageText, setSlippageText] = useState(() => formatSlippagePercent(settings.slippageBps))
	const [validityText, setValidityText] = useState(() => settings.validityMinutes.toString())
	const slippageInvalid = parseSlippagePercent(slippageText) === undefined
	const validityInvalid = parseValidityMinutes(validityText) === undefined
	const selectSlippage = (slippageBps: bigint) => {
		setSlippageText(formatSlippagePercent(slippageBps))
		onChange({ ...settings, slippageBps })
	}
	const selectValidity = (validityMinutes: bigint) => {
		setValidityText(validityMinutes.toString())
		onChange({ ...settings, validityMinutes })
	}
	return (
		<section className='trade-settings' aria-labelledby={`${id}-title`}>
			<h2 id={`${id}-title`} className='trade-settings-title'>
				{settingsCopy.tradeSettings}
			</h2>
			<div className='trade-settings-field'>
				<span className='trade-settings-label'>{settingsCopy.slippageTolerance}</span>
				<PresetRow label={settingsCopy.slippagePresets} presets={SLIPPAGE_PRESETS_BPS} value={settings.slippageBps} format={value => `${formatSlippagePercent(value)}%`} onSelect={selectSlippage} />
				<input
					id={`${id}-slippage`}
					inputMode='decimal'
					aria-label={settingsCopy.customSlippage}
					aria-invalid={slippageInvalid ? true : undefined}
					aria-describedby={slippageInvalid ? `${id}-slippage-error` : undefined}
					value={slippageText}
					onInput={event => {
						const text = event.currentTarget.value
						setSlippageText(text)
						const parsed = parseSlippagePercent(text)
						if (parsed !== undefined) onChange({ ...settings, slippageBps: parsed })
					}}
				/>
			</div>
			{slippageInvalid ? (
				<p id={`${id}-slippage-error`} className='field-error' role='alert'>
					{settingsCopy.slippageValidation}
				</p>
			) : undefined}
			<div className='trade-settings-field'>
				<span className='trade-settings-label'>{settingsCopy.transactionValidFor}</span>
				<PresetRow label={settingsCopy.validityPresets} presets={VALIDITY_PRESETS_MINUTES} value={settings.validityMinutes} format={settingsCopy.minutesLabel} onSelect={selectValidity} />
				<input
					id={`${id}-validity`}
					inputMode='numeric'
					aria-label={settingsCopy.customValidity}
					aria-invalid={validityInvalid ? true : undefined}
					aria-describedby={validityInvalid ? `${id}-validity-error` : undefined}
					value={validityText}
					onInput={event => {
						const text = event.currentTarget.value
						setValidityText(text)
						const parsed = parseValidityMinutes(text)
						if (parsed !== undefined) onChange({ ...settings, validityMinutes: parsed })
					}}
				/>
			</div>
			{validityInvalid ? (
				<p id={`${id}-validity-error`} className='field-error' role='alert'>
					{settingsCopy.validityValidation}
				</p>
			) : undefined}
			<p className='field-help'>{settingsCopy.settingsHelp}</p>
		</section>
	)
}
