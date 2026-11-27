import Inv48PublicTokenDeltaPublic
import Inv48ObservedEscrowResponderCore
import Inv48PublicObservedQuoteActual
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.CanonicalEscrowDispatch
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Scheduled environment and independent child limits. No suspension state or
calldata is selected by this schedule. -/
structure Schedule where
  environment : Context
  fuel : Nat
  childBudget : Nat
  childRows : ScriptedResponder
  parentRows : ScriptedResponder

def recognizes (s : Schedule) (r : CallRequest) : Prop :=
  r.kind = .call ∧ r.caller = wordToAddress s.environment.self ∧
  r.recipient = wordToAddress s.environment.self ∧
  r.codeAddress = wordToAddress s.environment.self ∧
  ABI.readSelector? (byteArrayToBytes r.calldata) = some 2391489481 ∧
  r.transferValue = wordToU256 0

def inputState (s : Schedule) (w : SolidCore.Solidity.Shared.OpenWorld) : State :=
  adoptWorld w s.environment State.empty

def serve (s : Schedule) (w : SolidCore.Solidity.Shared.OpenWorld) (r : CallRequest) :=
  Inv48.NestedResponder.serve s.fuel s.childBudget s.childRows
    s.environment (inputState s w) (byteArrayToBytes r.calldata)

noncomputable def policy (s : Schedule) : Inv48.ObservedEscrowResponder.Policy := by
  classical
  exact fun q => match q with
    | .external w (.call r) =>
      if recognizes s r then (serve s w r).map
        (fun child => Inv48.NestedResponder.response s.environment (inputState s w) child.result)
      else Inv48.NestedResponder.answer s.parentRows (.external w (.call r))
    | .external w (.create r) => Inv48.NestedResponder.answer s.parentRows (.external w (.create r))
    | .resource r => Inv48.NestedResponder.answer s.parentRows (.resource r)

theorem staticAnswer (s : Schedule) (w : SolidCore.Solidity.Shared.OpenWorld)
    (r : CallRequest) (kind : r.kind = .staticcall) :
    policy s (.external w (.call r)) =
      Inv48.NestedResponder.answer s.parentRows (.external w (.call r)) := by
  classical
  have no : ¬ recognizes s r := by
    intro h
    have h := h.1
    rw [kind] at h
    cases h
  simp [policy,no]

/-- Extract the computed child at any recognized actual event. -/
theorem atEvent (s : Schedule) (w : SolidCore.Solidity.Shared.OpenWorld)
    (r : CallRequest) (a : CallResponse) (recognized : recognizes s r)
    (matched : policy s (.external w (.call r)) = some a) :
    ∃ child, serve s w r = some child ∧
      a = Inv48.NestedResponder.response s.environment (inputState s w) child.result := by
  classical
  simp only [policy,if_pos recognized] at matched
  cases h : serve s w r with
  | none => simp [h] at matched
  | some child =>
    simp only [h,Option.map_some,Option.some.injEq] at matched
    exact ⟨child,rfl,matched.symm⟩

/-- Fold only the retained quote slice of the single original observation.
The three static calls are separated structurally from escrow CALL dispatch. -/
theorem quoteMatches {α : Type} (s : Schedule) (budget : Nat)
    (root : SolI α) (observed : Inv48.NestedResponder.Observation root)
    (computed : Inv48.ObservedEscrowResponder.observe budget (policy s) root = some observed)
    (before trace after : Interaction.Transcript)
    (split : observed.trace = before ++ trace ++ after)
    {n : Nat} {c : Context} {physical : Runtime} {p a b : Nat} {final : Runtime}
    (w : Inv48.WholeQuoteEvents.Witness n c physical p a b trace final)
    (e : Inv48.WholeQuoteEvents.Environment w) :
    Inv48.ChildExtraction.Matches s.parentRows trace := by
  have aligned := Inv48.ObservedEscrowResponder.observedMatches budget _ root observed computed
  obtain ⟨ac,ar,ag,events⟩ := Inv48.WholeQuoteEvents.events w e
  intro event member
  have matched := aligned event (by
    rw [split]
    exact List.mem_append_left after (List.mem_append_right before member))
  rw [events] at member
  simp only [List.mem_cons,List.not_mem_nil,or_false] at member
  rcases member with rfl | rfl | rfl
  all_goals
    dsimp only at matched ⊢
    simp only [Inv48.MinimumFullTrace.collateralQuery, Inv48.MinimumFullTrace.repQuery, Inv48.WholeQuoteEvents.aggregateQuery] at matched ⊢
    rw [staticAnswer] at matched
    · exact matched
    · rfl
end Inv48.CanonicalEscrowDispatch
