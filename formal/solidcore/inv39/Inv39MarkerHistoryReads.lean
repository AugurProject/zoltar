import Inv39MarkerHistory
import Inv39Getters

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Init.MarkerHistory

/-- Both supply getters preserve physical storage under actual successful public dispatch. -/
theorem supplyRead (k : Getter.Kind) (s post : State) (c : Context)
    (out : List Source.Value) (noValue : c.value = 0)
    (fields : c.storageFields = model.core.context.storageFields)
    (fit : WordField.stored s (Getter.field k) < R)
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (Getter.name k))
      c s [] = some (.returned post out)) : post.storage = s.storage := by
  obtain ⟨f, found, ps, rs, bd⟩ := Getter.linked k
  have frame : f.initialFrame? [] = some [("_ret0", .word 0)] := by
    unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
    rw [ps, rs]
    simp [BindingDecl.bindArgs?, Inv32Internal.wordBindings, BindingDecl.defaultBinding, Ty.defaultValue]
  let rt := (CheckedWordCall.initial c s).withFrame [("_ret0", .word 0)]
  have accepts : f.acceptsValue c.value := by
    simp [FunctionDef.acceptsValue, noValue, wordEq]
  have start : f.evalBodyEntry 50000 model.core.table c s [] =
      some (Stmt.eval 50000 model.core.table c rt f.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts, frame]
    rfl
  have run := Getter.run k model.core.table c rt 49997 fields fit
  rw [← bd] at run
  unfold TypeCheck.CheckedContract.callTargetWithContext? at actual
  rw [Child.resolve _ _ _ _ _ found frame] at actual
  change f.call? 50000 model.core.table c s [] = _ at actual
  unfold FunctionDef.call? FunctionDef.call at actual
  rw [start, run] at actual
  change some (f.callBodyResult s (.returned rt _)) = some (.returned post out) at actual
  have abi := Option.some.inj actual
  have storage : ∀ (res : Result), f.callBodyResult s res = .returned post out →
      post.storage = res.runtime.state.storage := by
    intro res abi
    cases res <;> simp only [FunctionDef.callBodyResult] at abi
    all_goals (repeat' first | contradiction | split at abi | (cases abi; rfl))
  exact storage _ abi

theorem supplyReadMarker (k : Getter.Kind) (s post : State) (c : Context)
    (out : List Source.Value) (noValue : c.value = 0)
    (fields : c.storageFields = model.core.context.storageFields)
    (fit : WordField.stored s (Getter.field k) < R)
    (actual : TypeCheck.CheckedContract.callTargetWithContext? 50000 model (.name (Getter.name k))
      c s [] = some (.returned post out)) : post.loadSlot 7 = s.loadSlot 7 := by
  simp only [State.loadSlot, supplyRead k s post c out noValue fields fit actual]

end Inv39.Init.MarkerHistory
