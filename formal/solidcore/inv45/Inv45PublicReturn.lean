import Inv45PublicShape
import Inv45Observed
open SolidCore.Solidity SolidCore.Solidity.Source
namespace Inv45.Public
set_option maxRecDepth 100000
set_option maxHeartbeats 4000000
set_option linter.unusedSimpArgs false
private def metadataCheck (f : FunctionDef) : Bool :=
  f.name == "getAnswerOptionName" && f.selector? == some 2895153088 && !f.payable &&
  match f.params, f.returns with
  | [⟨"questionId",.uint256,false⟩,⟨"answer",.uint256,false⟩], [⟨"_ret0",.bytesCalldata,false⟩] => true
  | _, _ => false

theorem metadata : getter.name="getAnswerOptionName" ∧ getter.selector?=some 2895153088 ∧ getter.payable=false ∧
    getter.params=[⟨"questionId",.uint256,false⟩,⟨"answer",.uint256,false⟩] ∧
    getter.returns=[⟨"_ret0",.bytesCalldata,false⟩] := by
  have h : metadataCheck getter=true := by native_decide
  unfold metadataCheck at h
  simp only [Bool.and_eq_true, beq_iff_eq, Bool.not_eq_true'] at h
  rcases h with ⟨⟨⟨hn,hs⟩,hp⟩,h⟩
  refine ⟨hn,hs,hp,?_⟩
  generalize getter.params=ps at *
  generalize getter.returns=rs at *
  split at h <;> simp_all

theorem selectorDispatch : model.core.findFunctionBySelector? 2895153088=some getter := by
  let p := fun (f : FunctionDef) => match f.selector? with | some x => wordEq x 2895153088 | none => false
  let q := fun (f : FunctionDef) => f.name == "getAnswerOptionName"
  have checked : model.core.functions.all (fun f => p f == q f)=true := by native_decide
  have same : ∀ f ∈ model.core.functions, p f=q f := by
    simpa only [beq_iff_eq] using (List.all_eq_true.mp checked)
  have congruent (xs : List FunctionDef) (h : ∀ f ∈ xs, p f=q f) : xs.find? p=xs.find? q := by
    induction xs with
    | nil => rfl
    | cons f fs ih =>
      simp only [List.find?_cons]
      rw [h f (by simp)]
      split
      · rfl
      · exact ih (fun x hx => h x (by simp [hx]))
  change model.core.functions.find? p=some getter
  rw [congruent _ same]
  exact (Option.some_get getterPresent).symm

theorem initialFrame (question answer : Nat) : getter.initialFrame? [.word question,.word answer]=
    some [("questionId",.word question),("answer",.word answer),("_ret0",.bytes [])] := by
  obtain ⟨_,_,_,ps,rs⟩ := metadata
  simp [FunctionDef.initialFrame?,FunctionDef.returnDefaultBindings,ps,rs,BindingDecl.bindArgs?,BindingDecl.bindArg?,BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue]

theorem publicReturn (before : State) (after : Runtime) (bs : List Nat) (out : Value)
    (holds : Decimal.Holds after bs out) :
    getter.callBodyResult before (.returned after [out]) =
      .returned {after.state with constructorOutput? := none} [.bytes bs] := by
  obtain ⟨_,_,_,_,rs⟩ := metadata
  cases holds with
  | direct => simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,rs,coerceReturnBindings,coerceReturnBindings.coerce,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Value.untagFixedBytes,Bind.bind,Except.bind]
  | ref bound cell =>
    cases hm : after.nextMemory with
    | zero => simp [hm] at bound
    | succ m => simp [FunctionDef.callBodyResult,FunctionDef.coerceReturnValues,rs,coerceReturnBindings,coerceReturnBindings.coerce,Runtime.derefMemoryValueDeep,hm,Runtime.derefMemoryValueWithFuel,cell,Ty.coerceValue?,Value.untagFixedBytes,Bind.bind,Except.bind]

/-- Lift a successful evaluation of the actual generated body to its public result. -/
theorem successfulBody (fuel : Nat) (c : Context) (entry after : Runtime)
    (before : State) (bs : List Nat) (out : Value)
    (body : Stmt.eval fuel model.core.table c entry getter.body = pure (.returned after [out]))
    (holds : Decimal.Holds after bs out) :
    (Functor.map (getter.callBodyResult before)
      (Stmt.eval fuel model.core.table c entry getter.body)) =
      (pure (.returned {after.state with constructorOutput? := none} [.bytes bs]) : SolI CallResult) := by
  rw [body]
  change (pure (getter.callBodyResult before (.returned after [out])) : SolI CallResult) = _
  rw [publicReturn before after bs out holds]

#print axioms metadata
#print axioms selectorDispatch
#print axioms initialFrame
#print axioms publicReturn
#print axioms successfulBody
end Inv45.Public
