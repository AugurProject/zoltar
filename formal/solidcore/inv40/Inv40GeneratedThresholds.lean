import Inv40Bindings

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv40

theorem forkGetter (n : Nat) (c : Context) (r after : Runtime) (i s d : Nat)
    (hi : i<2^248) (hs : s<R) (hd : d<R) (pos : 0<d)
    (events : Trace) (supply : providerReturns .forkThreshold n model.core.table c r after i s events)
    (divisor : after.loadImmutableField c "forkThresholdDivisor" = pure (.word d)) :
    ∃ fn, model.core.findFunctionByName? "getForkThresholdAttoRep" = some fn ∧
      Yields (Stmt.eval (n+5) model.core.table c (entry r i) fn.body) events (.returned (entry after i) [.word (fork s d)]) := by
  have link := publicBody .forkThreshold
  cases found : lookup .forkThreshold with
  | none => rw [found] at link; contradiction
  | some fn =>
    rw [found] at link
    obtain eq := Option.some.inj link
    exact ⟨fn,found,eq.symm ▸ forkBody _ _ _ _ _ _ _ _ hi hs hd pos events supply divisor⟩

/-- Compose the internal fork call from the non-decision getter. Only the
underlying theoretical-supply read and immutable divisor are observations. -/
private theorem nestedFork (n : Nat) (c : Context) (r after : Runtime) (i s d : Nat)
    (hi : i<2^248) (hs : s<R) (hd : d<R) (pos : 0<d) (frames : after.locals = r.locals)
    (events : Trace) (supply : providerReturns .forkThreshold n model.core.table {c with checked := true}
      {providerFrame .nonDecisionThreshold r i with locals := []}
      {providerFrame .nonDecisionThreshold after i with locals := []} i s events)
    (divisor : after.loadImmutableField c "forkThresholdDivisor" = pure (.word d)) :
    providerReturns .nonDecisionThreshold (n+5) model.core.table c r after i (fork s d) events := by
  let pre := providerFrame .nonDecisionThreshold r i
  let empty := {pre with locals := []}
  let post := providerFrame .nonDecisionThreshold after i
  let emptyAfter := {post with locals := []}
  let key := Getter.nonDecisionThreshold.key
  have link := internalFound
  cases found : model.core.table.lookup? key with
  | none => change (model.core.table.lookup? key).map signatureOK = _ at link
            rw [found] at link; contradiction
  | some fn =>
    change (model.core.table.lookup? key).map signatureOK = _ at link
    rw [found] at link
    obtain ⟨ps,rs,body⟩ := signatureSound fn (Option.some.inj link)
    have enter : internalCallEnter? fn [.word i] pre = some (entry empty i,pre.locals) := by
      unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
      rw [ps,rs]
      simp [Inv32Internal.wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,
        BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,
        entry,empty,Runtime.withFrame]
    have ev := forkBody n model.core.table {c with checked := true} empty emptyAfter i s d hi hs hd pos events supply divisor
    rw [← body] at ev
    let targets := [Getter.nonDecisionThreshold.target]
    have assigned : ∃ out, internalCallAssign post targets [.word (fork s d)] = pure out := by
      unfold internalCallAssign
      simp only [targets, List.isEmpty_cons, Bool.false_eq_true, if_false]
      split <;> exact ⟨_,rfl⟩
    obtain ⟨out,assigned⟩ := assigned
    refine ⟨out,assigned,?_⟩
    have args := Inv32FlagCalls.arg c pre Inv32OneArg.argName i rfl
    change Yields (Stmt.eval _ _ _ pre (.internalCall targets key _)) events out
    rw [Stmt.eval]; dsimp only; rw [args]
    change Yields (match model.core.table.lookup? key with
      | none => pure (.reverted pre .typeMismatch)
      | some f => match internalCallEnter? f [.word i] pre with
        | none => pure (.reverted pre .typeMismatch)
        | some (inside,saved) => Stmt.eval _ _ {c with checked := true} inside f.body >>= internalCallFinish f targets saved) events out
    simp only [found,enter]
    apply finishTrace ev
    rw [← assigned]
    simp [internalCallFinish,rs,Inv32Internal.wordBindings,coerceReturnBindingsRef,
      coerceReturnBindingsRef.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,
      Ty.coerceValue?,entry,emptyAfter,Runtime.withFrame,Bind.bind,Except.bind,pre,post,providerFrame,
      Inv32OneArg.temps,Inv32OneArg.store,Runtime.declareLocal,Runtime.pushScope,providerInner,LocalEnv.declare,frames]

theorem nonDecisionGetter (n : Nat) (c : Context) (r after : Runtime) (i s d : Nat)
    (hi : i<2^248) (hs : s<R) (hd : d<R) (pos : 0<d) (frames : after.locals = r.locals)
    (events : Trace) (supply : providerReturns .forkThreshold n model.core.table {c with checked := true}
      {providerFrame .nonDecisionThreshold r i with locals := []}
      {providerFrame .nonDecisionThreshold after i with locals := []} i s events)
    (divisor : after.loadImmutableField c "forkThresholdDivisor" = pure (.word d)) :
    ∃ fn, model.core.findFunctionByName? "getNonDecisionThresholdAttoRep" = some fn ∧
      Yields (Stmt.eval (n+10) model.core.table c (entry r i) fn.body) events (.returned (entry after i) [.word (fork s (2*d))]) := by
  have previous := nestedFork n c r after i s d hi hs hd pos frames events supply divisor
  have link := publicBody .nonDecisionThreshold
  cases found : lookup .nonDecisionThreshold with
  | none => rw [found] at link; contradiction
  | some fn =>
    rw [found] at link
    obtain eq := Option.some.inj link
    rw [← nonDecision_eq _ _ pos]
    exact ⟨fn,found,eq.symm ▸ halfBody _ _ _ _ _ _ _ hi (fork_fits s d hs pos) events previous⟩

/-- Concrete, public ABI calls on a frozen genesis snapshot exercise the
supply read as well as the two getter bodies, on both sides of a common step. -/
private def frozenGenesis (s d : Nat) : Option (Nat × Nat) := do
  let c := model.core.context
  let universes ← c.storageField? "universes"
  let frozen ← c.storageField? "frozenGenesisTheoreticalSupply"
  let state := ((State.empty.storeSlot (mappingStorageSlot universes.slot 0) 1).storeFieldWord
    frozen s).storeImmutable "forkThresholdDivisor" (.word d)
  let get (name : String) := do
    let .returned _ [.word value] ← TypeCheck.CheckedContract.call? 50000 model (.name name) state [.word 0] | none
    return value
  return (← get "getForkThresholdAttoRep", ← get "getNonDecisionThresholdAttoRep")

theorem publicBoundary : frozenGenesis 11 5 = some (3,2) ∧ frozenGenesis 10 5 = some (2,1) ∧
    frozenGenesis 1 5 = some (1,1) ∧ frozenGenesis 0 5 = some (0,0) := by native_decide

end Inv40

open Lean in
run_cmd
  let allowed := #[``propext,``Classical.choice,``Quot.sound,``Lean.ofReduceBool,``Lean.trustCompiler]
  for name in #[``Inv40.forkGetter,``Inv40.nonDecisionGetter,``Inv40.fork_le,``Inv40.bothSteps,``Inv40.nonDecision_eq,``Inv40.publicBoundary] do
    for dep in ← collectAxioms name do
      unless allowed.contains dep do throwError "Unexpected INV-40 axiom {dep}"
