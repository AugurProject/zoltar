import { ViewTabs } from './ViewTabs.js'
import type { ViewTabOption } from '../types/components.js'

type SectionModeTabsProps<TValue extends string> = {
	ariaLabel: string
	className?: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

export function SectionModeTabs<TValue extends string>({ ariaLabel, className = '', onChange, options, value }: SectionModeTabsProps<TValue>) {
	return <ViewTabs ariaLabel={ariaLabel} className={`section-mode-switch ${className}`.trim()} size='compact' value={value} variant='subroute' onChange={onChange} options={options} />
}
