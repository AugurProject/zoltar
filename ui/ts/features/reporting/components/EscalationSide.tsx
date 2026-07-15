import * as commonCopy from '../../../copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import type { JSX } from 'preact'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { Badge } from '../../../components/Badge.js'
import type { EscalationDeposit } from '../../../types/contracts.js'

type EscalationSideDisplay = {
	balance: bigint | undefined
	label: string
	userDeposits: EscalationDeposit[] | undefined
	userStake: bigint | undefined
}

type EscalationSideProps = {
	bindingCapital: bigint | undefined
	chartScaleMax: bigint
	disabled?: boolean
	isLeading: boolean
	isSelected: boolean
	isTabStop: boolean
	onSelect: () => void
	side: EscalationSideDisplay
}

function getChartRatio(value: bigint | undefined, maxValue: bigint) {
	if (value === undefined || value <= 0n || maxValue <= 0n) return '0%'

	const basisPoints = (value * 10000n) / maxValue
	const wholePercent = basisPoints / 100n
	const fractionalPercent = (basisPoints % 100n).toString().padStart(2, '0')

	return `${wholePercent.toString()}.${fractionalPercent}%`
}

function getArrowKeyDirection(key: string) {
	if (key === 'ArrowRight' || key === 'ArrowDown') return 1
	if (key === 'ArrowLeft' || key === 'ArrowUp') return -1
	return 0
}

function moveSelectionWithArrowKey(event: JSX.TargetedKeyboardEvent<HTMLButtonElement>) {
	const direction = getArrowKeyDirection(event.key)
	if (direction === 0) return
	const currentRadio = event.currentTarget
	if (!(currentRadio instanceof HTMLElement)) return
	const radioGroup = currentRadio.closest('[role="radiogroup"]')
	if (!(radioGroup instanceof HTMLElement)) return
	const enabledRadios = Array.from(radioGroup.querySelectorAll<HTMLElement>('[role="radio"]')).filter(radio => !radio.hasAttribute('disabled') && radio.getAttribute('aria-disabled') !== 'true')
	const currentIndex = enabledRadios.indexOf(currentRadio)
	if (currentIndex === -1 || enabledRadios.length === 0) return
	event.preventDefault()
	const nextRadio = enabledRadios[(currentIndex + direction + enabledRadios.length) % enabledRadios.length]
	nextRadio?.focus()
	nextRadio?.click()
}

export function EscalationSide({ bindingCapital, chartScaleMax, disabled = false, isLeading, isSelected, isTabStop, onSelect, side }: EscalationSideProps) {
	const tabIndex = (() => {
		if (disabled) return undefined
		return isTabStop ? 0 : -1
	})()

	return (
		<button
			aria-checked={isSelected}
			className={`escalation-side ${isSelected ? 'selected' : ''} ${isLeading ? 'leading' : ''}`}
			disabled={disabled}
			onClick={onSelect}
			onKeyDown={moveSelectionWithArrowKey}
			role='radio'
			style={{
				'--binding-ratio': getChartRatio(bindingCapital, chartScaleMax),
				'--side-ratio': getChartRatio(side.balance, chartScaleMax),
				'--user-ratio': getChartRatio(side.userStake, chartScaleMax),
			}}
			tabIndex={tabIndex}
			type='button'
		>
			<div className='escalation-side-row'>
				<div className='escalation-side-copy'>
					<div className='escalation-side-title-row'>
						<span className='panel-label'>{side.label}</span>
						{isLeading || isSelected ? (
							<div className='escalation-side-badges'>
								{isSelected ? <Badge className='escalation-side-selected-badge'>{commonCopy.selected}</Badge> : undefined}
								{isLeading ? <Badge tone='ok'>{forkAuctionCopy.leading}</Badge> : undefined}
							</div>
						) : undefined}
					</div>
				</div>
				<div aria-hidden='true' className='escalation-side-chart'>
					<div className='escalation-side-track'>
						<div className='escalation-side-total-bar' />
						<div className='escalation-side-user-bar' />
						<div className='escalation-side-binding-marker' />
					</div>
				</div>
				<div className='escalation-side-values'>
					<div className='escalation-side-value'>
						<span className='metric-label'>{forkAuctionCopy.totalStake}</span>
						<CurrencyValue copyable={false} value={side.balance} suffix={commonCopy.rep} />
					</div>
					<div className='escalation-side-value'>
						<span className='metric-label'>{forkAuctionCopy.yourStake}</span>
						<CurrencyValue copyable={false} value={side.userStake} suffix={commonCopy.rep} />
					</div>
				</div>
			</div>
		</button>
	)
}
