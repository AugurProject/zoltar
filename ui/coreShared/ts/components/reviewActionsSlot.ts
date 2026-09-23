import { createContext } from 'preact'
import type { ComponentChildren } from 'preact'

/**
 * Lets a dialog form hand its action row to the transaction review: while a review is active the form's
 * `TransactionActionGroup` renders the review's confirm and cancel controls in place of its own and claims the
 * row so the rest of the form can go inert around it. The dialog then keeps one action row in one place.
 */
export type ReviewActionsSlot = {
	actions: ComponentChildren
	claim: (element: HTMLElement) => void
	release: () => void
}

export const ReviewActionsSlotContext = createContext<ReviewActionsSlot | undefined>(undefined)
