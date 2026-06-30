import { useEffect, useRef } from 'preact/hooks'

type HiddenSiblingState = {
	ariaHidden: string | undefined
	count: number
	inert: boolean
}

type ElementRef<T extends HTMLElement> = {
	current: T | null
}

type ModalFocusIsolationOptions<TInitialFocusElement extends HTMLElement> = {
	dialogRef: ElementRef<HTMLElement>
	initialFocusRef: ElementRef<TInitialFocusElement>
	isOpen: boolean
	onClose: () => void
}

const hiddenSiblingStates = new WeakMap<HTMLElement, HiddenSiblingState>()

function hideModalSibling(element: HTMLElement) {
	const state = hiddenSiblingStates.get(element)
	if (state !== undefined) {
		state.count += 1
		return
	}
	hiddenSiblingStates.set(element, {
		ariaHidden: element.getAttribute('aria-hidden') ?? undefined,
		count: 1,
		inert: element.hasAttribute('inert'),
	})
	element.setAttribute('aria-hidden', 'true')
	element.setAttribute('inert', '')
}

function restoreModalSibling(element: HTMLElement) {
	const state = hiddenSiblingStates.get(element)
	if (state === undefined) return
	state.count -= 1
	if (state.count > 0) return
	hiddenSiblingStates.delete(element)
	if (state.ariaHidden === undefined) {
		element.removeAttribute('aria-hidden')
	} else {
		element.setAttribute('aria-hidden', state.ariaHidden)
	}
	if (state.inert) {
		element.setAttribute('inert', '')
	} else {
		element.removeAttribute('inert')
	}
}

function getModalIsolationSiblings(backdropElement: HTMLElement) {
	const siblings: HTMLElement[] = []
	const seenSiblings = new Set<HTMLElement>()
	let currentElement: HTMLElement | undefined = backdropElement
	while (currentElement !== undefined) {
		if (currentElement === document.body) break
		const parentElement: HTMLElement | null = currentElement.parentElement
		if (!(parentElement instanceof HTMLElement)) break
		for (const sibling of Array.from(parentElement.children)) {
			if (sibling === currentElement || !(sibling instanceof HTMLElement) || seenSiblings.has(sibling)) continue
			if (sibling.classList.contains('modal-backdrop') && (backdropElement.compareDocumentPosition(sibling) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) continue
			seenSiblings.add(sibling)
			siblings.push(sibling)
		}
		currentElement = parentElement
	}
	return siblings
}

function getTopOtherModalBackdrop(backdropElement: HTMLElement | null | undefined) {
	const modalBackdrops = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop')).filter(modalBackdrop => modalBackdrop !== backdropElement)
	return modalBackdrops[modalBackdrops.length - 1]
}

function isTopModalBackdrop(backdropElement: HTMLElement | null | undefined) {
	if (!(backdropElement instanceof HTMLElement)) return false
	const modalBackdrops = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'))
	return modalBackdrops[modalBackdrops.length - 1] === backdropElement
}

function getFocusableElements(dialogElement: HTMLElement | null) {
	return Array.from(dialogElement?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? [])
}

export function useModalFocusIsolation<TInitialFocusElement extends HTMLElement>({ dialogRef, initialFocusRef, isOpen, onClose }: ModalFocusIsolationOptions<TInitialFocusElement>) {
	const onCloseRef = useRef(onClose)

	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	useEffect(() => {
		if (!isOpen) return
		const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
		const backdropElement = dialogRef.current?.parentElement
		const hiddenSiblings: HTMLElement[] = []
		if (backdropElement instanceof HTMLElement) {
			for (const sibling of getModalIsolationSiblings(backdropElement)) {
				hideModalSibling(sibling)
				hiddenSiblings.push(sibling)
			}
		}
		if (isTopModalBackdrop(backdropElement)) initialFocusRef.current?.focus()
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isTopModalBackdrop(backdropElement)) return
			if (event.key === 'Escape') {
				event.preventDefault()
				event.stopImmediatePropagation()
				onCloseRef.current()
				return
			}
			if (event.key !== 'Tab') return
			event.preventDefault()
			event.stopImmediatePropagation()
			const focusableElements = getFocusableElements(dialogRef.current)
			if (focusableElements.length === 0) return
			if (!(document.activeElement instanceof HTMLElement)) {
				focusableElements[0]?.focus()
				return
			}

			const currentIndex = focusableElements.indexOf(document.activeElement)
			if (currentIndex === -1) {
				focusableElements[0]?.focus()
				return
			}

			if (event.shiftKey) {
				focusableElements[(currentIndex - 1 + focusableElements.length) % focusableElements.length]?.focus()
				return
			}

			focusableElements[(currentIndex + 1) % focusableElements.length]?.focus()
		}
		document.addEventListener('keydown', handleKeyDown)
		return () => {
			document.removeEventListener('keydown', handleKeyDown)
			for (const sibling of hiddenSiblings) {
				restoreModalSibling(sibling)
			}
			const topOtherModalBackdrop = getTopOtherModalBackdrop(backdropElement)
			if (topOtherModalBackdrop !== undefined) {
				getFocusableElements(topOtherModalBackdrop)[0]?.focus()
				return
			}
			previouslyFocusedElement?.focus()
		}
	}, [dialogRef, initialFocusRef, isOpen])
}
