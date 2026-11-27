import Inv48GuardArgsFramePrefix
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ReportingGuardFrame
open Inv48.EscrowPrefix Inv48.EscrowJoin Inv48.GuardArgsFrame
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

def capture (names : List String) (out : Result) : SolI Result :=
  match out with
  | .returned r vs =>
    if vs.isEmpty || names.isEmpty then pure (.normal r)
    else match r.assignNamedValues? names vs with
      | some next => pure (.normal next)
      | none => pure (.reverted r .typeMismatch)
  | other => pure other

/-- The actual epilogue restores saved locals before assigning captured values.
The callee and its transcript are unrestricted. -/
theorem finishCapture (fn : InternalFunction) (names : List String) (saved : LocalEnv)
    (out : Result) (final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (internalCallFinish fn names saved out >>= capture names)
      trace (.normal final)) :
    ∃ (r : Runtime) (values : List Value), ExecutesOK (internalCallAssign {r with locals := saved} names values)
      [] (.normal final) := by
  cases out <;> simp only [internalCallFinish] at run
  all_goals try { have h := pureResult _ _ _ run; cases h.2 }
  case normal r =>
    split at run
    next values eq =>
      refine ⟨r,values,?_⟩
      unfold internalCallAssign at run ⊢
      split at run
      next empty =>
        simp only [empty,if_true]
        have h := pureResult _ _ _ run; cases h.2; exact .done _
      next nonempty =>
        simp only [nonempty,Bool.false_eq_true,if_false]
        split at run
        next updated assigned =>
          have h := pureResult _ _ _ run; cases h.2; exact .done _
        next bad => have h := pureResult _ _ _ run; cases h.2
    next err eq => have h := pureResult _ _ _ run; cases h.2
  case returned r vs =>
    split at run
    next values eq =>
      refine ⟨r,values,?_⟩
      unfold internalCallAssign at run ⊢
      split at run
      next empty =>
        simp only [empty,if_true]
        have h := pureResult _ _ _ run; cases h.2; exact .done _
      next nonempty =>
        simp only [nonempty,Bool.false_eq_true,if_false]
        split at run
        next updated assigned =>
          have h := pureResult _ _ _ run; cases h.2; exact .done _
        next bad => have h := pureResult _ _ _ run; cases h.2
    next err eq => have h := pureResult _ _ _ run; cases h.2

theorem capturedNoArgs (n : Nat) (t : FunctionTable) (c : Context)
    (r final : Runtime) (key : String) (names : List String) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+2) t c r
      (.captureReturn names (.internalCall names key []))) trace (.normal final)) :
    ∃ (post : Runtime) (values : List Value), ExecutesOK (internalCallAssign {post with locals := r.locals} names values)
      [] (.normal final) := by
  rw [Stmt.eval] at run
  change ExecutesOK (Stmt.eval (n+1) t c r (.internalCall names key []) >>= capture names)
    trace (.normal final) at run
  rw [Stmt.eval] at run
  have args : Expr.evalRefArgList c r [] = pure ([],r) := rfl
  dsimp only at run
  rw [args] at run
  change ExecutesOK ((match t.lookup? key with
    | none => pure (.reverted r .typeMismatch)
    | some fn => match internalCallEnter? fn [] r with
      | none => pure (.reverted r .typeMismatch)
      | some (inner,saved) => Stmt.eval n t {c with checked := true} inner fn.body >>=
          internalCallFinish fn names saved) >>= capture names) trace (.normal final) at run
  split at run
  · have h := pureResult _ _ _ run; cases h.2
  next fn found =>
    split at run
    · have h := pureResult _ _ _ run; cases h.2
    next inner savedLocals entered =>
      change ExecutesOK (Interaction.bind (Interaction.bind
        (Stmt.eval n t {c with checked := true} inner fn.body)
        (internalCallFinish fn names savedLocals)) (capture names)) trace (.normal final) at run
      rw [Interaction.bind_assoc] at run
      obtain ⟨out,before,after,_,_,finish⟩ := bindSuccessful _ _ _ _ run
      have saved := enteredSaved fn [] r inner savedLocals entered
      simpa only [saved] using finishCapture fn names savedLocals out final after finish

end Inv48.ReportingGuardFrame
