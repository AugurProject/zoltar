import Inv48EscrowTraceTree
open SolidCore.Solidity.Source
open EvmCompiler.Simulation
namespace Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Successful branch of the real open interaction tree, with its exact transcript. -/
abbrev ExecutesOK {α : Type} (tree : SolI α)
    (trace : Interaction.Transcript) (value : α) :=
  Interaction.Executes tree trace (.ok value)

theorem pureResult {α : Type} (value out : α) (trace : Interaction.Transcript)
    (run : ExecutesOK (pure value) trace out) : trace = [] ∧ out = value := by
  cases run
  exact ⟨rfl,rfl⟩

/-- Invert bind without replacing an external request by a pure result. -/
theorem bindSuccessful {α β : Type} (first : SolI α) (next : α → SolI β)
    (trace : Interaction.Transcript) (out : β)
    (run : ExecutesOK (first >>= next) trace out) :
    ∃ value before after, trace = before ++ after ∧
      ExecutesOK first before value ∧ ExecutesOK (next value) after out := by
  rcases Interaction.Executes.bind_cases run with failure | success
  · rcases failure with ⟨err,h,_⟩
    cases h
  · exact success

/-- Every normally completed no-target internal epilogue restores the caller
    environment, independently of the callee state and all external answers. -/
theorem finishNormalLocals (fn : InternalFunction) (saved : LocalEnv)
    (out : Result) (final : Runtime) (trace : Interaction.Transcript)
    (run : ExecutesOK (internalCallFinish fn [] saved out) trace (.normal final)) :
    final.locals = saved := by
  cases out <;> simp only [internalCallFinish] at run
  all_goals try { have h := pureResult _ _ _ run; cases h.2 }
  case normal r =>
    split at run
    · simp only [internalCallAssign,List.isEmpty_nil,if_true] at run
      have h := pureResult _ _ _ run
      cases h.2
      rfl
    · have h := pureResult _ _ _ run
      cases h.2
  case returned r values =>
    split at run
    · simp only [internalCallAssign,List.isEmpty_nil,if_true] at run
      have h := pureResult _ _ _ run
      cases h.2
      rfl
    · have h := pureResult _ _ _ run
      cases h.2

/-- Full arbitrary callee tree followed by its real epilogue. No successful or
    pure-call hypothesis is imposed on the body. -/
theorem bodyThenFinishLocals (fuel : Nat) (t : FunctionTable) (c : Context)
    (inner : Runtime) (fn : InternalFunction) (saved : LocalEnv)
    (trace : Interaction.Transcript) (final : Runtime)
    (run : ExecutesOK
      (Stmt.eval fuel t {c with checked := true} inner fn.body >>=
        internalCallFinish fn [] saved) trace (.normal final)) :
    final.locals = saved := by
  obtain ⟨out,before,after,_,_,finish⟩ := bindSuccessful _ _ _ _ run
  exact finishNormalLocals fn saved out final after finish

/-- Exact framed call tree when argument evaluation is local. In particular,
    the callee body remains an open tree across Collateral.pull's ERC20 calls. -/
theorem internalTree (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (fn : InternalFunction) (inner : Runtime) (saved : LocalEnv)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (found : t.lookup? key = some fn)
    (enter : internalCallEnter? fn values r = some (inner,saved)) :
    Stmt.eval (fuel+1) t c r (.internalCall [] key args) =
      (Stmt.eval fuel t {c with checked := true} inner fn.body >>=
        internalCallFinish fn [] saved) := by
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

/-- The saved environment comes from the actual entry operation. -/
theorem enteredSaved (fn : InternalFunction) (values : List Value)
    (r inner : Runtime) (saved : LocalEnv)
    (enter : internalCallEnter? fn values r = some (inner,saved)) : saved = r.locals := by
  unfold internalCallEnter? at enter
  split at enter
  · contradiction
  · cases enter
    rfl

theorem internalNormalLocals (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (fn : InternalFunction) (inner : Runtime) (saved : LocalEnv)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (found : t.lookup? key = some fn)
    (enter : internalCallEnter? fn values r = some (inner,saved))
    (trace : Interaction.Transcript) (final : Runtime)
    (run : ExecutesOK (Stmt.eval (fuel+1) t c r (.internalCall [] key args))
      trace (.normal final)) : final.locals = r.locals := by
  rw [internalTree fuel t c r key args values fn inner saved arguments found enter] at run
  exact (bodyThenFinishLocals fuel t c inner fn saved trace final run).trans
    (enteredSaved fn values r inner saved enter)

/-- Inversion selects the actual table entry and frame; neither is a premise. -/
theorem internalNormal (fuel : Nat) (t : FunctionTable) (c : Context)
    (r : Runtime) (key : String) (args : List Expr) (values : List Value)
    (arguments : Expr.evalRefArgList c r args = pure (values,r))
    (trace : Interaction.Transcript) (final : Runtime)
    (run : ExecutesOK (Stmt.eval (fuel+1) t c r (.internalCall [] key args))
      trace (.normal final)) : final.locals = r.locals := by
  cases found : t.lookup? key with
  | none =>
    rw [Stmt.eval] at run
    dsimp only at run
    rw [arguments] at run
    simp only [SolI.caught,found] at run
    change ExecutesOK (pure (Result.reverted r RevertData.typeMismatch)) trace (.normal final) at run
    have h := pureResult _ _ _ run
    cases h.2
  | some fn =>
    cases enter : internalCallEnter? fn values r with
    | none =>
      rw [Stmt.eval] at run
      dsimp only at run
      rw [arguments] at run
      change ExecutesOK (match t.lookup? key with
        | none => pure (Result.reverted r RevertData.typeMismatch)
        | some f => match internalCallEnter? f values r with
          | none => pure (Result.reverted r RevertData.typeMismatch)
          | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>=
              internalCallFinish f [] s) trace (.normal final) at run
      simp only [found,enter] at run
      have h := pureResult _ _ _ run
      cases h.2
    | some pair =>
      exact internalNormalLocals fuel t c r key args values fn pair.1 pair.2
        arguments found enter trace final run

#print axioms finishNormalLocals
#print axioms bodyThenFinishLocals
#print axioms internalTree
#print axioms internalNormalLocals
end Inv48.EscrowPrefix

#print axioms Inv48.EscrowPrefix.internalNormal
