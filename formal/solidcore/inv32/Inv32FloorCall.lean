import Inv32FloorSuccess
open SolidCore.Solidity.Source Inv32Division Inv32Internal Inv32FloorFastPath
namespace Inv32FloorCall
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem args (c : Context) (r : Runtime) (x y d : String) (a b den : Nat)
    (X : r.lookupLocal? x = some (.word a)) (Y : r.lookupLocal? y = some (.word b))
    (D : r.lookupLocal? d = some (.word den)) :
    Expr.evalRefArgList c r [.var x,.var y,.var d] = pure ([.word a,.word b,.word den],r) := by
  change Expr.evalRefArgListFuel (_+1) c r [.var x,.var y,.var d] = _
  simp only [Expr.orderFuel,Expr.listEvalFuel,Nat.reduceAdd,Expr.evalRefArgListFuel,
    Inv32ProductCall.wordArg _ _ _ _ X, Inv32ProductCall.wordArg _ _ _ _ Y,
    Inv32ProductCall.wordArg _ _ _ _ D,pb]
open Inv32Bodies.Floor in
theorem sig : ∃ fn, Inv32Dispatch.model.core.table.lookup? key = some fn ∧
    fn.params = wordBindings ["x","y","denominator"] ∧ fn.returns = wordBindings ["result"] ∧ fn.body = body := by
  have sig : ((Inv32Dispatch.model.core.table.lookup? key).bind fun f => do
    let ps ← decode f.params
    let rs ← decode f.returns
    pure (ps,rs)) = some (["x","y","denominator"],["result"]) := by native_decide
  have b := checkedBody
  cases h : Inv32Dispatch.model.core.table.lookup? key with
  | none => simp [h] at b
  | some f =>
    simp only [h,Option.bind_some] at sig
    cases hp : decode f.params <;> simp [hp] at sig
    cases hr : decode f.returns <;> simp [hr] at sig
    obtain ⟨rfl,rfl⟩ := sig
    exact ⟨f,rfl,wordBindingsOf _ _ hp,wordBindingsOf _ _ hr,by simpa [h] using b⟩

theorem success (fuel : Nat) (c : Context) (r : Runtime) (x y d : String) (targets : List String)
    (a b den : Nat) (ha : a<R) (hb : b<R) (hd : den<R) (pos : 0<den) (fits : a*b/den<R)
    (X : r.lookupLocal? x = some (.word a)) (Y : r.lookupLocal? y = some (.word b))
    (D : r.lookupLocal? d = some (.word den)) (enough : 12≤fuel) :
    Stmt.eval (fuel+1) Inv32Dispatch.model.core.table c r
      (.internalCall targets Inv32Bodies.Floor.key [.var x,.var y,.var d]) =
      internalCallAssign r targets [.word (a*b/den)] := by
  obtain ⟨fn,found,ps,rs,bd⟩ := sig
  let empty := {r with locals := []}
  have enter : internalCallEnter? fn [.word a,.word b,.word den] r = some (scope empty a b den,r.locals) := by
    unfold internalCallEnter? InternalFunction.initialFrame? InternalFunction.returnDefaultBindings
    rw [ps,rs]
    simp [wordBindings,BindingDecl.bindArgsRef?,BindingDecl.bindArgRef?,BindingDecl.bindArg?,
      BindingDecl.defaultBinding,Ty.coerceValue?,Ty.defaultValue,scope,empty,Runtime.withFrame]
  obtain ⟨next,effects,ev⟩ := Inv32FloorSuccess.execution fuel {c with checked := true} empty a b den ha hb hd pos fits enough
  rw [← bd] at ev
  rw [call _ _ _ _ _ _ _ _ _ _ _ _ _ (args _ _ _ _ _ _ _ _ X Y D) found enter ev]
  have restore : {next with locals := r.locals} = r := effects _
  have ret : coerceReturnBindingsRef fn.returns next [.word (a*b/den)] = .ok [.word (a*b/den)] := by
    rw [rs]
    simp [coerceReturnBindingsRef,coerceReturnBindingsRef.coerce,wordBindings,Runtime.derefMemoryValueDeep,
      Runtime.derefMemoryValueWithFuel,Ty.coerceValue?,Bind.bind,Except.bind]
  simp only [internalCallFinish,List.isEmpty_cons,Bool.false_eq_true,if_false,ret,restore]
end Inv32FloorCall
