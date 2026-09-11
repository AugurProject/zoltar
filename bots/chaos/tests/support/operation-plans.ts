import { evaluateOperationCatalog, type EcosystemSnapshot, type OperationPlan, type PlanningOptions } from '../../src/operations/catalog.ts'

export function eligibleOperationPlans(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlan[] {
	return evaluateOperationCatalog(snapshot, options)
		.map(operation => operation.plan)
		.filter((plan): plan is OperationPlan => plan !== undefined)
}

export function urgentOperationPlans(snapshot: EcosystemSnapshot, options: PlanningOptions): OperationPlan[] {
	return eligibleOperationPlans(snapshot, options)
		.filter(plan => plan.obligation)
		.sort((left, right) => {
			if (left.deadlineTimestamp === undefined) return right.deadlineTimestamp === undefined ? 0 : 1
			if (right.deadlineTimestamp === undefined) return -1
			const leftDeadline = BigInt(left.deadlineTimestamp)
			const rightDeadline = BigInt(right.deadlineTimestamp)
			if (leftDeadline < rightDeadline) return -1
			if (leftDeadline > rightDeadline) return 1
			return 0
		})
}
