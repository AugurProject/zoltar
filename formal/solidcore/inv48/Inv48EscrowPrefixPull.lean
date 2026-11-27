import Inv48EscrowPrefixTree
open SolidCore.Solidity.Source
open EvmCompiler.Simulation
namespace Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

theorem scalarRefArg (c : Context) (r : Runtime) (name : String) (word : Nat)
    (bound : r.lookupLocal? name = some (.word word)) :
    Expr.evalRefArg c r (.var name) = pure (.word word,r) := by
  simp only [Expr.evalRefArg,Runtime.lookupStorageBase?,Runtime.lookupMemoryRef?,bound]
  exact Inv32Guards.readWord _ _ _ _ _ bound

theorem fourScalarArgs (c : Context) (r : Runtime) (a b d e : Nat)
    (A : r.lookupLocal? "_ic_arg_0" = some (.word a))
    (B : r.lookupLocal? "_ic_arg_1" = some (.word b))
    (D : r.lookupLocal? "_ic_arg_2" = some (.word d))
    (E : r.lookupLocal? "_ic_arg_3" = some (.word e)) :
    Expr.evalRefArgList c r [.var "_ic_arg_0",.var "_ic_arg_1",.var "_ic_arg_2",.var "_ic_arg_3"] =
      pure ([.word a,.word b,.word d,.word e],r) := by
  unfold Expr.evalRefArgList
  simp only [Expr.listEvalFuel,Expr.orderFuel]
  rw [Expr.evalRefArgListFuel,scalarRefArg c r _ a A]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,scalarRefArg c r _ b B]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,scalarRefArg c r _ d D]
  simp only [pb]
  rw [Expr.evalRefArgListFuel,scalarRefArg c r _ e E]
  simp only [pb]
  rw [Expr.evalRefArgListFuel]
  rfl

def captureEmpty (out : Result) : SolI Result :=
  match out with
  | .returned r _ => pure (.normal r)
  | other => pure other

/-- Empty capture cannot turn a failed internal epilogue into a normal result. -/
theorem capturedFinishNormal (fn : InternalFunction) (saved : LocalEnv)
    (out : Result) (final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (internalCallFinish fn [] saved out >>= captureEmpty)
      trace (.normal final)) : final.locals = saved := by
  cases out <;> simp only [internalCallFinish] at run
  all_goals try { have h := pureResult _ _ _ run; cases h.2 }
  case normal r =>
    split at run
    · simp only [internalCallAssign,List.isEmpty_nil,if_true,pb,captureEmpty] at run
      have h := pureResult _ _ _ run
      cases h.2
      rfl
    · have h := pureResult _ _ _ run
      cases h.2
  case returned r values =>
    split at run
    · simp only [internalCallAssign,List.isEmpty_nil,if_true,pb,captureEmpty] at run
      have h := pureResult _ _ _ run
      cases h.2
      rfl
    · have h := pureResult _ _ _ run
      cases h.2

theorem capturedInternalNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (trace : Interaction.Transcript) (final : Runtime)
    (run : ExecutesOK (Stmt.eval (fuel+2) t c r
      (.captureReturn [] (.internalCall [] key args))) trace (.normal final)) :
    final.locals = r.locals := by
  rw [Stmt.eval] at run
  dsimp only at run
  simp only [List.isEmpty_nil,Bool.or_true,if_true] at run
  change ExecutesOK (Stmt.eval (fuel+1) t c r (.internalCall [] key args) >>=
    captureEmpty) trace (.normal final) at run
  cases found : t.lookup? key with
  | none =>
    have bad : Stmt.eval (fuel+1) t c r (.internalCall [] key args) =
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
      have bad : Stmt.eval (fuel+1) t c r (.internalCall [] key args) =
          pure (.reverted r RevertData.typeMismatch) := by
        rw [Stmt.eval]
        dsimp only
        rw [arguments]
        change (match t.lookup? key with
          | none => pure (Result.reverted r RevertData.typeMismatch)
          | some f => match internalCallEnter? f values r with
            | none => pure (Result.reverted r RevertData.typeMismatch)
            | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>=
                internalCallFinish f [] s) = _
        simp only [found,enter]
      rw [bad] at run
      have h := pureResult _ _ _ run
      cases h.2
    | some pair =>
      rw [internalTree fuel t c r key args values fn pair.1 pair.2 arguments found enter] at run
      change ExecutesOK (Interaction.bind
        (Interaction.bind (Stmt.eval fuel t {c with checked := true} pair.1 fn.body)
          (internalCallFinish fn [] pair.2)) captureEmpty) trace (.normal final) at run
      rw [Interaction.bind_assoc] at run
      obtain ⟨out,before,after,_,_,finish⟩ := bindSuccessful _ _ _ _ run
      exact (capturedFinishNormal fn pair.2 out final after finish).trans
        (enteredSaved fn values r pair.1 pair.2 enter)

#print axioms fourScalarArgs
#print axioms capturedInternalNormal
end Inv48.EscrowPrefix
