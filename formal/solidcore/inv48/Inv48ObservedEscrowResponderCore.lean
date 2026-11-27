import Inv48NestedResponderCore
import Inv48RequestQuoteEval
import Inv48ChildExtractionTransfer
import Inv48EscrowDecodeCanonical
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedEscrowResponder
set_option autoImplicit false
set_option maxRecDepth 65536
set_option maxHeartbeats 16000000

abbrev Policy := (q : Query) → Option (Answer q)

def query (c : Context) (state : State) (data : List Byte) : Query :=
  .external (snapshotWorld c state) (.call (buildCallRequest c .call c.self data 0 none))

/-- A nested row is keyed by the entire actual query, including its world.
Its answer is computed before the parent observation; no parent success,
trace, response bytes, or Served witness is an input. -/
noncomputable def policy (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (childRows parentRows : ScriptedResponder) : Policy := by
  classical
  exact fun q => if h : q = query c state data then
    h.symm ▸ ((Inv48.NestedResponder.serve fuel budget childRows c state data).map
      (fun s => Inv48.NestedResponder.response c state s.result))
    else Inv48.NestedResponder.answer parentRows q

/-- Parent interpreter for the nested policy. Child and parent budgets are
separate; a missing child answer remains absence, never a fabricated revert. -/
def observe {α : Type} : Nat → Policy → (tree : SolI α) →
    Option (Inv48.NestedResponder.Observation tree)
  | 0, _, _ => none
  | _+1, _, .done result => some ⟨[],result,.done result⟩
  | n+1, answers, .request q next => do
      let a ← answers q
      let tail ← observe n answers (next a)
      pure ⟨⟨q,a⟩ :: tail.trace,tail.outcome,.request a tail.execution⟩

def Matches (answers : Policy) (trace : Interaction.Transcript) : Prop :=
  ∀ event ∈ trace, answers event.query = some event.answer

theorem observedMatches {α : Type} (n : Nat) (answers : Policy) (tree : SolI α)
    (o : Inv48.NestedResponder.Observation tree) (computed : observe n answers tree = some o) :
    Matches answers o.trace := by
  induction n generalizing tree with
  | zero => simp [observe] at computed
  | succ n ih =>
    cases tree with
    | done out =>
      simp only [observe,Option.some.injEq] at computed
      subst o
      intro event mem
      cases mem
    | request q next =>
      cases ans : answers q with
      | none => simp [observe,ans] at computed
      | some a =>
        cases tail : observe n answers (next a) with
        | none => simp [observe,ans,tail] at computed
        | some obs =>
          simp [observe,ans,tail,Bind.bind,Option.bind,Pure.pure] at computed
          subst o
          intro event mem
          rcases List.mem_cons.mp mem with eq | mem
          · subst event; exact ans
          · exact ih _ obs tail event mem

/-- Serving is a computation identity, not an independently assumed Served. -/
theorem atQuery (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (childRows parentRows : ScriptedResponder) :
    policy c state data fuel budget childRows parentRows (query c state data) =
      (Inv48.NestedResponder.serve fuel budget childRows c state data).map
        (fun s => Inv48.NestedResponder.response c state s.result) := by
  classical
  simp [policy]

/-- Extract the exact event at the open suspension recovered by
CapturedEscrowArgs.observedConcrete. Alignment is with the actual parent
policy, not a free-standing child or a flat scripted response. -/
theorem suspension {α : Type} (c : Context) (state : State) (data : List Byte)
    (fuel budget : Nat) (childRows parentRows : ScriptedResponder)
    (next : LowLevelCallResult × State → SolI α)
    (trace : Interaction.Transcript) (out : Except SolidityFailure α)
    (openWorld : c.selfDispatch? = none)
    (run : Interaction.Executes (selfDispatchCall c state .call c.self data 0 none >>= next) trace out)
    (aligned : Matches (policy c state data fuel budget childRows parentRows) trace) :
    ∃ s : Inv48.NestedResponder.Served c state data fuel budget childRows,
      Inv48.NestedResponder.serve fuel budget childRows c state data = some s ∧
      ∃ rest,
        trace = ⟨query c state data,Inv48.NestedResponder.response c state s.result⟩ :: rest ∧
        Interaction.Executes
          (next (decodeCallResponse (Inv48.NestedResponder.response c state s.result)
            .call c.self data 0 none,
            adoptWorld (Inv48.NestedResponder.response c state s.result).postWorld c state)) rest out := by
  rw [Inv48.EscrowEntry.openDispatchRequest c state c.self data next openWorld] at run
  cases run with
  | request a tail =>
    have matched := aligned ⟨query c state data,a⟩ List.mem_cons_self
    rw [atQuery] at matched
    cases served : Inv48.NestedResponder.serve fuel budget childRows c state data with
    | none => simp [served] at matched
    | some s =>
      simp only [served,Option.map_some,Option.some.injEq] at matched
      subst a
      exact ⟨s,rfl,_,rfl,tail⟩

#print axioms policy
#print axioms suspension
end Inv48.ObservedEscrowResponder
