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

def ProductLinked (table : FunctionTable) : Prop :=
  ∃ fn, table.lookup? key = some fn ∧
    fn.params = wordBindings ["a","b"] ∧ fn.returns = wordBindings ["high","low"] ∧ fn.body = body

/-- Check the generated argument bindings, return bindings and complete executable body. -/
def linked? (table : FunctionTable) (name : String) (ps rs : List String)
    (shape : Inv32Shapes.Pattern Stmt) : Bool :=
  match table.lookup? name with
  | none => false
  | some fn => decide (decode fn.params = some ps ∧ decode fn.returns = some rs) && shape.test fn.body

theorem linkedOfCheck (table : FunctionTable) (name : String) (ps rs : List String)
    (shape : Inv32Shapes.Pattern Stmt) (checked : linked? table name ps rs shape = true) :
    ∃ fn, table.lookup? name = some fn ∧ fn.params = wordBindings ps ∧
      fn.returns = wordBindings rs ∧ fn.body = shape.value := by
  cases found : table.lookup? name with
  | none => simp [linked?,found] at checked
  | some fn =>
    simp only [linked?,found,Bool.and_eq_true,decide_eq_true_eq] at checked
    exact ⟨fn,rfl,wordBindingsOf _ _ checked.1.1,wordBindingsOf _ _ checked.1.2,
      shape.sound _ checked.2⟩

theorem signature : ProductLinked Inv32Dispatch.model.core.table :=
  linkedOfCheck _ _ _ _ shape (by native_decide)
end Inv32Internal
