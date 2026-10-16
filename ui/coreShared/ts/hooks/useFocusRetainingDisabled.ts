import { useState } from 'preact/hooks'

/**
 * Native `disabled` drops keyboard focus to the page, so a button that disables itself while it holds focus (a pager
 * waiting for its page, Connect waiting for the wallet, a transaction waiting for its receipt) stays focusable and is
 * only marked aria-disabled. `keepFocusable` keeps it focusable even without focus, such as while its own action is
 * pending. Activation goes through `guardClick`, which ignores a disabled button and keeps it from submitting a form.
 */
export function useFocusRetainingDisabled(disabled: boolean, { keepFocusable = false }: { keepFocusable?: boolean } = {}) {
	const [holdsFocus, setHoldsFocus] = useState(false)
	const ariaDisabledOnly = disabled && (keepFocusable || holdsFocus)
	return {
		buttonProps: {
			'aria-disabled': ariaDisabledOnly ? ('true' as const) : undefined,
			disabled: disabled && !ariaDisabledOnly,
			onBlur: () => setHoldsFocus(false),
			onFocus: () => setHoldsFocus(true),
		},
		guardClick: (onClick: () => void) => (event: MouseEvent) => {
			if (disabled) {
				event.preventDefault()
				return
			}
			onClick()
		},
	}
}
