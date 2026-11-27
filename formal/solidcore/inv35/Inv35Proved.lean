import Inv35Arithmetic
import Inv35Public

/-! INV-35 for the public Solidity spot-price harness, including reserve sums wider than uint256. -/
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Dispatch Inv32Observed
open Inv32RatioLoop (answer)
namespace Inv35Source

/-- Observe the sole returned word of the generated public function. -/
def price (x y : Nat) : Option Nat := do
  let result ← TypeCheck.CheckedContract.call? 50000 model (.name "conditionalYesBps") State.empty [.word x,.word y]
  let .returned _ [.word value] := result | none
  pure value

private theorem parameters : fn.params = Inv32Internal.wordBindings ["yesReserve","noReserve"] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
private theorem outputs : fn.returns = Inv32Internal.wordBindings ["_ret0"] :=
  Inv32Internal.wordBindingsOf _ _ (by native_decide)
private theorem initialFrame (x y : Nat) :
    fn.initialFrame? [.word x,.word y] = some (frame x y) := by
  unfold FunctionDef.initialFrame? FunctionDef.returnDefaultBindings
  rw [parameters,outputs]
  simp [Inv32Internal.wordBindings,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,
    Ty.coerceValue?,Ty.defaultValue,frame]

private theorem dispatchPrice (x y : Nat) :
    model.core.resolveCallFunction? (.name "conditionalYesBps") [.word x,.word y] = some fn := by
  have chosen : model.core.findFunctionByName? "conditionalYesBps" = some fn := (Option.some_get _).symm
  obtain ⟨nameOk,before,after,decomp,skip⟩ := List.find?_eq_some_iff_append.mp chosen
  apply List.find?_eq_some_iff_append.mpr
  refine ⟨?_,before,after,decomp,?_⟩
  · simp only [nameOk,Bool.true_and,initialFrame,Option.isSome_some]
  · intro f mem
    have h := skip f mem
    simp_all

theorem priceFormula (x y : Nat) (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    price x y = some (answer 10000 y x) := by
  let q := answer 10000 y x
  let src := initial.withFrame (frame x y)
  have run := publicBody 49713 ctx initial x y hx hy pos
  have accepts : fn.acceptsValue ctx.value = true := by native_decide
  have entry : fn.evalBodyEntry 50000 model.core.table ctx State.empty [.word x,.word y] =
      some (Stmt.eval 50000 model.core.table ctx src fn.body) := by
    unfold FunctionDef.evalBodyEntry
    rw [if_pos accepts,initialFrame]; rfl
  have obs : fn.callBodyResult State.empty (.returned src [.word q]) =
      .returned {src.state with constructorOutput? := none} [.word q] := by
    simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,outputs,Inv32Internal.wordBindings,
      coerceReturnBindings,coerceReturnBindings.coerce,Ty.coerceValue?,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Bind.bind,Except.bind,Value.untagFixedBytes]
  unfold price TypeCheck.CheckedContract.call? Source.ABI.Contract.callSelfDispatch? Source.ABI.Contract.callWithSelfDispatch
  rw [dispatchPrice]
  change (do let v ← fn.call? 50000 model.core.table ctx State.empty [.word x,.word y]
             let .returned _ [.word amount] := v | none
             pure amount) = _
  unfold FunctionDef.call? FunctionDef.call
  rw [entry]
  change Stmt.eval 50000 model.core.table ctx src fn.body = _ at run
  rw [run]
  change (match fn.callBodyResult State.empty (.returned src [.word q]) with
    | .returned _ [.word v] => some v | _ => none) = _
  rw [obs]

/-- Both directional prices exist. Their sum and its integral-price boundary are exact. -/
theorem mirroredPrices (x y : Nat) (hx : x<R) (hy : y<R) (pos : 0<x+y) :
    ∃ a b, price x y = some a ∧ price y x = some b ∧
      (a+b = 9999 ∨ a+b = 10000) ∧ (a+b = 10000 ↔ (x+y) ∣ 10000*y) :=
  ⟨_,_,priceFormula _ _ hx hy pos,priceFormula _ _ hy hx (by omega),Inv35Arithmetic.complement x y pos⟩

/-- Scaling the reserves preserves both displayed prices whenever both scaled words fit. -/
theorem scaledPrices (x y k : Nat) (hk : 0<k) (hx : k*x<R) (hy : k*y<R) (pos : 0<x+y) :
    price (k*x) (k*y) = price x y ∧ price (k*y) (k*x) = price y x := by
  have xle : x ≤ k*x := by simpa using Nat.mul_le_mul_right x hk
  have yle : y ≤ k*y := by simpa using Nat.mul_le_mul_right y hk
  rw [priceFormula _ _ hx hy (by omega),priceFormula _ _ (by omega) (by omega) pos,
    priceFormula _ _ hy hx (by omega),priceFormula y x (by omega) (by omega) (by omega),
    Inv35Arithmetic.scale x y k hk,Inv35Arithmetic.scale y x k hk]
  exact ⟨rfl,rfl⟩
end Inv35Source

open Lean in
run_cmd
  let allowed := #[``propext, ``Classical.choice, ``Quot.sound, ``Lean.ofReduceBool, ``Lean.trustCompiler]
  for thm in #[``Inv35Source.mirroredPrices, ``Inv35Source.scaledPrices] do
    for dep in ← collectAxioms thm do
      unless allowed.contains dep do throwError "Unexpected axiom {dep} in {thm}"
#print axioms Inv35Source.mirroredPrices
#print axioms Inv35Source.scaledPrices
