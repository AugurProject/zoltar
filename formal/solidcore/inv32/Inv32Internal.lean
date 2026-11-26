import Inv32Mul512
open SolidCore.Solidity.Source
namespace Inv32Internal
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
theorem call (fuel : Nat) (t : FunctionTable) (c : Context) (r after inner : Runtime)
    (key : String) (fn : InternalFunction) (args : List Expr) (values : List Value)
    (targets : List String) (saved : LocalEnv) (out : Result)
    (arguments : Expr.evalRefArgList c r args = pure (values, after))
    (found : t.lookup? key = some fn)
    (enter : internalCallEnter? fn values after = some (inner,saved))
    (body : Stmt.eval fuel t {c with checked := true} inner fn.body = pure out) :
    Stmt.eval (fuel+1) t c r (.internalCall targets key args) = internalCallFinish fn targets saved out := by
  rw [Stmt.eval]; dsimp only; rw [arguments]
  change (match t.lookup? key with
    | none => pure (Result.reverted after RevertData.typeMismatch)
    | some f => match internalCallEnter? f values after with
      | none => pure (Result.reverted after RevertData.typeMismatch)
      | some (i,s) => Stmt.eval fuel t {c with checked := true} i f.body >>= internalCallFinish f targets s) = _
  simp only [found,enter,body,pb]

theorem capture (n : Nat) (t : FunctionTable) (c : Context) (r next : Runtime) (names : List String)
    (s : Stmt) (normal : Stmt.eval n t c r s = pure (.normal next)) :
    Stmt.eval (n+1) t c r (.captureReturn names s) = pure (.normal next) := by
  rw [Stmt.eval]; dsimp only; rw [normal]; rfl

open Inv32Bodies.Mul512

def wordBindings (names : List String) : List BindingDecl :=
  names.map (fun n => ⟨n,.uint256,false⟩)
def decode : List BindingDecl → Option (List String)
  | [] => some []
  | ⟨n,.uint256,false⟩ :: rest => (decode rest).map (n :: ·)
  | _ => none

theorem wordBindingsOf (ds : List BindingDecl) (ns : List String)
    (h : decode ds = some ns) : ds = wordBindings ns := by
  induction ds generalizing ns with
  | nil => cases h; rfl
  | cons d ds ih =>
    cases d with | mk n ty ref =>
      cases ty <;> cases ref <;> simp only [decode,reduceCtorEq] at h
      cases rest : decode ds <;> simp [rest] at h
      subst ns
      rw [ih _ rest]; rfl

theorem signature : ∃ fn, Inv32Dispatch.model.core.table.lookup? key = some fn ∧
    fn.params = wordBindings ["a","b"] ∧ fn.returns = wordBindings ["high","low"] ∧ fn.body = body := by
  have sig : ((Inv32Dispatch.model.core.table.lookup? key).bind fun f => do
    let ps ← decode f.params
    let rs ← decode f.returns
    pure (ps,rs)) = some (["a","b"],["high","low"]) := by native_decide
  have b := checkedBody
  cases h : Inv32Dispatch.model.core.table.lookup? key with
  | none => simp [h] at b
  | some f =>
    simp only [h,Option.bind_some] at sig
    cases hp : decode f.params <;> simp [hp] at sig
    cases hr : decode f.returns <;> simp [hr] at sig
    obtain ⟨rfl,rfl⟩ := sig
    exact ⟨f,rfl,wordBindingsOf _ _ hp,wordBindingsOf _ _ hr,by simpa [h] using b⟩
end Inv32Internal
