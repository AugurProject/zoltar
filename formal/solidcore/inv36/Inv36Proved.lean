import Inv36Public

/-! INV-36 for the public initializer and spot-price entry points on the generated Solidity model. -/
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Dispatch Inv32Observed
namespace Inv36Source
def initializerQuote (a p : Nat) : Option (Nat × Nat) := do
  let res ← TypeCheck.CheckedContract.call? 50000 model (.name "initialLiquidityAmounts") State.empty [.word a,.word p]
  let .returned _ [.word y,.word n] := res | none
  pure (y,n)

private theorem parameters : fn.params = Inv32Internal.wordBindings [cn,pn] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
private theorem outputs : fn.returns = Inv32Internal.wordBindings [yn,nn] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
private theorem initialFrame (x y : Nat) :
    fn.initialFrame? [.word x,.word y] = some (frm x y 0 0) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [parameters,outputs]
  simp [Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue,frm]

private theorem dispatchInit (x y : Nat) :
    model.core.resolveCallFunction? (.name "initialLiquidityAmounts") [.word x,.word y] = some fn := by
  have chosen : model.core.findFunctionByName? "initialLiquidityAmounts" = some fn := (Option.some_get _).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp chosen
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,Bool.true_and,initialFrame,Option.isSome_some]
  · intro f mem
    have h := skip f mem
    simp_all

theorem formula (a p : Nat) (ha : a<R) (hp : p<R) : initializerQuote a p = quote a p := by
  let src := initial.withFrame (frm a p 0 0)
  have run := publicRun 49976 ctx initial a p ha hp
  have accepts : fn.acceptsValue ctx.value = true := by native_decide
  have entry : fn.evalBodyEntry 50000 model.core.table ctx State.empty [.word a,.word p] =
      some (Stmt.eval 50000 model.core.table ctx src fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts,initialFrame]; rfl
  unfold initializerQuote TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch? Source.ABI.Contract.callWithSelfDispatch
  rw [dispatchInit]
  change (do let res ← fn.call? 50000 model.core.table ctx State.empty [.word a,.word p]
             let .returned _ [.word y,.word n] := res | none
             pure (y,n)) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [entry]
  cases Q : quote a p with
  | none =>
    rw [Q] at run
    obtain ⟨s,e,h⟩ := run
    change Stmt.eval 50000 _ _ src _ = _ at h
    rw [h]; rfl
  | some z =>
    rw [Q] at run
    obtain ⟨s,_,h⟩ := run
    change Stmt.eval 50000 _ _ src _ = pure (.returned s (returns z)) at h
    rw [h]
    have obs : fn.callBodyResult State.empty (.returned s (returns z)) =
        .returned {s.state with constructorOutput? := none} (returns z) := by
      simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,outputs,Inv32Internal.wordBindings,
        coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
        Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes,returns]
    change (match fn.callBodyResult State.empty (.returned s (returns z)) with
      | .returned _ [.word y,.word n] => some (y,n) | _ => none) = _
    rw [obs]
    cases z; rfl

/-- Every successful initializer quote has a successful reflected quote with exchanged
reserves. The price displayed from the original reserves rounds toward its requested side. -/
theorem initializationSymmetry (a p y n : Nat) (ha : a<R) (hp : p<R)
    (success : initializerQuote a p = some (y,n)) :
    initializerQuote a (10000-p) = some (n,y) ∧
    ∃ b, Inv35Source.price y n = some b ∧ (p≤5000 → b≤p) ∧ (5000≤p → p≤b) := by
  rw [formula _ _ ha hp] at success
  unfold quote at success
  split at success
  next valid =>
    obtain ⟨pos,lt,yp,np⟩ := valid
    have reserves := Option.some.inj success
    have bySide := displayed a p ⟨pos,lt⟩ (bounded a p ha ⟨pos,lt⟩).1 (bounded a p ha ⟨pos,lt⟩).2 ⟨yp,np⟩
    rw [reserves] at bySide yp np
    refine ⟨?_,bySide⟩
    rw [formula _ _ ha (lt_of_le_of_lt (Nat.sub_le _ _) (by decide : 10000<R))]
    unfold quote
    rw [reflected a p lt,reserves]
    exact if_pos ⟨by omega,by omega,np,yp⟩
  next => contradiction
end Inv36Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for dep in ← collectAxioms ``Inv36Source.initializationSymmetry do
    unless allowed.contains dep do throwError "Unexpected INV-36 axiom {dep}"
#print axioms Inv36Source.initializationSymmetry
