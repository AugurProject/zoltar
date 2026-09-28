type SkeletonListProps = {
	className?: string
	/** Announced once to assistive technology in place of the placeholder shapes. */
	label: string
	rows?: number
}

/**
 * Placeholder rows that hold a list's shape during its first load, so the layout does not jump when data arrives.
 * Later refreshes keep the previous rows visible instead of returning to the skeleton.
 */
export function SkeletonList({ className = '', label, rows = 3 }: SkeletonListProps) {
	return (
		<div className={`skeleton-list ${className}`.trim()} role='status' aria-live='polite'>
			<span className='visually-hidden'>{label}</span>
			{Array.from({ length: rows }, (_, index) => (
				<div key={index} className='skeleton-row' aria-hidden='true'>
					<span className='skeleton-line skeleton-line-title' />
					<span className='skeleton-line skeleton-line-detail' />
				</div>
			))}
		</div>
	)
}
