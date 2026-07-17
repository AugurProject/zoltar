import type { ComponentChildren } from 'preact'
import type { Hash } from '@zoltar/shared/ethereum'
import type { Route } from './app.js'

export type ActionAvailability = {
	disabled: boolean
	reason: string | undefined
}

type NoticeTone = 'blocking' | 'warning' | 'pending' | 'success'

export type BadgeTone = 'blocked' | 'danger' | 'muted' | 'ok' | 'pending' | 'warning'

export type NoticeItem = {
	detail: ComponentChildren
	id: string
	title?: ComponentChildren
	tone: NoticeTone
}

type GlobalTransactionTone = 'preparing' | 'awaiting-wallet' | 'pending' | 'success' | 'warning' | 'error'

export type GlobalTransactionRow = {
	label: string
	value: ComponentChildren
}

export type TransactionIntent = {
	action: string
	requiresWalletConfirmation?: boolean | undefined
	rows?: GlobalTransactionRow[]
	source: string
	submittedDetail: ComponentChildren
	submittedTitle: ComponentChildren
}

export type GlobalTransactionPresentation = {
	detail: ComponentChildren
	dismissKey?: string
	hash?: Hash
	rows?: GlobalTransactionRow[]
	title: ComponentChildren
	tone: GlobalTransactionTone
}

export type StickyContextItem = {
	label: string
	value: ComponentChildren
}

export type TransactionContextItem = {
	label: ComponentChildren
	value: ComponentChildren
}

export type LifecycleStagePresentation = {
	availableActions: string[]
	blockedActions: string[]
	detail?: string
	key: string
	label: string
	tone: 'critical' | 'default' | 'success' | 'warning'
}

export type ReadinessBlocker = {
	detail?: string
	key: string
	label: string
	resolved: boolean
}

export type ReadinessAction = {
	actionLabel: string
	blocker?: string
	description?: string
	disabledReasonId?: string
	onAction?: () => void
	readiness: 'blocked' | 'ready' | 'warning'
	key: string
	title: string
}

export type TransactionStatusCardProps = {
	actions?: ComponentChildren
	badge: ComponentChildren
	className?: string
	detail?: ComponentChildren
	metrics?: ComponentChildren
	secondaryDetail?: ComponentChildren
	title: ComponentChildren
}

export type RouteHeaderProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	description?: ComponentChildren
	eyebrow?: ComponentChildren
	summary?: ComponentChildren
	title: ComponentChildren
}

export type SectionBlockProps = {
	actions?: ComponentChildren
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	description?: ComponentChildren
	density?: 'balanced' | 'compact'
	headingLevel?: 2 | 3 | 4
	title?: ComponentChildren
	tone?: 'critical' | 'default' | 'muted'
	variant?: 'default' | 'embedded' | 'plain' | 'surface'
}

export type RouteWorkflowPanelProps = {
	children: ComponentChildren
	className?: string
	description?: ComponentChildren
	showHeader?: boolean
	title: ComponentChildren
}

export type DataGridProps = {
	children: ComponentChildren
	className?: string
	columns?: 2 | 3 | 4 | 'auto'
	dense?: boolean
}

export type MetricGridVariant = 'context' | 'default' | 'question' | 'summary' | 'vault'

export type MetricGridProps = {
	children: ComponentChildren
	className?: string
	columns?: 2 | 3 | 4 | 'auto'
	dense?: boolean
	variant?: MetricGridVariant
}

export type ProgressMeterProps = {
	className?: string
	detail?: ComponentChildren
	label: ComponentChildren
	maxValue?: bigint
	secondaryValue?: ComponentChildren
	tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
	value?: bigint
	valueText: ComponentChildren
}

export type RankedBarListProps = {
	className?: string
	emptyMessage?: ComponentChildren
	items: Array<{
		detail?: ComponentChildren
		key: string
		label: ComponentChildren
		tone?: 'default' | 'danger' | 'muted' | 'success' | 'warning'
		value?: bigint
		valueText: ComponentChildren
	}>
}

export type ViewTabOption<TValue extends string> = {
	disabled?: boolean
	href?: string
	id?: string
	label: ComponentChildren
	panelId?: string
	reason?: string
	value: TValue
}

export type ViewTabsProps<TValue extends string> = {
	ariaLabel: string
	className?: string
	/** When provided, only grouped values are rendered. Duplicate values render at their first grouped position. */
	groups?: Array<{
		ariaLabel: string
		className?: string
		values: readonly TValue[]
	}>
	onChange: (value: TValue) => void
	orientation?: 'horizontal' | 'vertical'
	options: ViewTabOption<TValue>[]
	semantics?: 'navigation' | 'switcher' | 'tabs'
	size?: 'compact' | 'default'
	value: TValue
	variant?: 'route' | 'subroute'
}

export type TransactionActionButtonProps = {
	availability?: ActionAvailability
	className?: string
	disabled?: boolean
	idleLabel: ComponentChildren
	onClick: () => void
	pending?: boolean
	pendingLabel: ComponentChildren
	showDisabledReason?: boolean
	tone?: 'primary' | 'secondary'
	type?: 'button' | 'submit'
}

export type OperationModalProps = {
	children: ComponentChildren
	context?: TransactionContextItem[]
	description?: ComponentChildren
	isOpen: boolean
	onClose: () => void
	title: ComponentChildren
}

export type TabNavigationProps = {
	route: Route
	showDeployTab?: boolean
	augurPlaceHolderDeployed: boolean
	deployRoute: string
	marketRoute: string
	openOracleRoute: string
	securityPoolsRoute: string
	onRouteChange: (route: Exclude<Route, 'not-found'>) => void
}
