import Inv48BountyGuardFrameCore
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.BountyGuardFrame
open Inv48.EscrowJoin Inv48.EscrowPrefix Inv48.RequestGuards
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
theorem internalHeadTree (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (fn : InternalFunction) (inner : Runtime) (saved : LocalEnv)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (found : t.lookup? key = some fn)
    (enter : internalCallEnter? fn values r = some (inner,saved)) :
    Stmt.eval (fuel+1) t c r (.internalCall [ret] key args) =
      (Stmt.eval fuel t {c with checked := true} inner fn.body >>=
        internalCallFinish fn [ret] saved) := by
  rw [Stmt.eval]
  dsimp only
  rw [arguments]
  change (match t.lookup? key with
    | none => pure (Result.reverted r RevertData.typeMismatch)
    | some f => match internalCallEnter? f values r with
      | none => pure (Result.reverted r RevertData.typeMismatch)
      | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>=
          internalCallFinish f [ret] s) = _
  simp only [found,enter]

/-- The saved environment comes from the actual entry operation. -/
theorem capturedHead (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (f : Frame) (tail : LocalEnv)
    (shape : r.locals = ((ret,.word 0)::f)::tail)
    (trace : Interaction.Transcript) (final : Runtime)
    (run : ExecutesOK (Stmt.eval (fuel+2) t c r
      (.captureReturn [ret] (.internalCall [ret] key args))) trace (.normal final)) :
    ∃ v, final.locals = ((ret,v)::f)::tail := by
  rw [Stmt.eval] at run
  dsimp only at run
  simp only [List.isEmpty_cons,Bool.false_eq_true,Bool.or_false,if_false] at run
  have run : ExecutesOK (Stmt.eval (fuel+1) t c r (.internalCall [ret] key args) >>=
    captureNext [ret]) trace (.normal final) := by
    convert run using 1
    congr 1
    funext out
    cases out <;> simp [captureNext] <;> rfl
  cases found : t.lookup? key with
  | none =>
    have bad : Stmt.eval (fuel+1) t c r (.internalCall [ret] key args) =
        pure (.reverted r RevertData.typeMismatch) := by
      rw [Stmt.eval]
      dsimp only
      rw [arguments]
      simp only [SolI.caught,found]
      rfl
    rw [bad] at run
    have h := pureResult _ _ _ run
    cases h.2
  | some fn =>
    cases enter : internalCallEnter? fn values r with
    | none =>
      have bad : Stmt.eval (fuel+1) t c r (.internalCall [ret] key args) =
          pure (.reverted r RevertData.typeMismatch) := by
        rw [Stmt.eval]
        dsimp only
        rw [arguments]
        change (match t.lookup? key with
          | none => pure (Result.reverted r RevertData.typeMismatch)
          | some f => match internalCallEnter? f values r with
            | none => pure (Result.reverted r RevertData.typeMismatch)
            | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>=
                internalCallFinish f [ret] s) = _
        simp only [found,enter]
      rw [bad] at run
      have h := pureResult _ _ _ run
      cases h.2
    | some pair =>
      rw [internalHeadTree fuel t c r key args values fn pair.1 pair.2 arguments found enter] at run
      change ExecutesOK (Interaction.bind
        (Interaction.bind (Stmt.eval fuel t {c with checked := true} pair.1 fn.body)
          (internalCallFinish fn [ret] pair.2)) (captureNext [ret])) trace (.normal final) at run
      rw [Interaction.bind_assoc] at run
      obtain ⟨out,before,after,_,_,finish⟩ := bindSuccessful _ _ _ _ run
      apply finishHead fn out pair.2 f tail _ final after finish
      rw [enteredSaved fn values r pair.1 pair.2 enter]
      exact shape

end Inv48.BountyGuardFrame
