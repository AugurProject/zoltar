import { useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'
import { applyThemePreference, parseThemePreference, readThemePreference, saveThemePreference, type ThemePreference } from '../../lib/themePreference.js'

const themeOptions: ReadonlyArray<{ label: string; value: ThemePreference }> = [
	{ label: appCopy.themeSystem, value: 'system' },
	{ label: appCopy.themeLight, value: 'light' },
	{ label: appCopy.themeDark, value: 'dark' },
]

export function ThemeSetting() {
	const [preference, setPreference] = useState(readThemePreference)
	return (
		<label className='app-settings-theme'>
			<span>{appCopy.theme}</span>
			<select
				value={preference}
				onChange={event => {
					const nextPreference = parseThemePreference(event.currentTarget.value)
					setPreference(nextPreference)
					saveThemePreference(nextPreference)
					applyThemePreference(nextPreference)
				}}
			>
				{themeOptions.map(option => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	)
}
