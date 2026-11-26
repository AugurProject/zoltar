import Inv39GuardControl
import Inv39ScalarTemplates
import Inv39AuthReads
open SolidCore.Solidity.Source
namespace Inv39.Auth
theorem varDecl (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) (e : Option Expr)
    (supported : scalar ty) (hidden : w k=false) (pureInit : ∀ x,e=some x → Frame.ReadOnly x) : guards allow w t c (.varDecl ty k e) := by
  intro n r hr activeFrame; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    have done (v : Value) (ok : Init.safeTemplate v) : post allow w c r (.normal (r.declareLocal k v)) := by
      have ⟨safe,vis⟩ := declare w r k v hidden (.inr ok) hr activeFrame
      exact ⟨.inl rfl,vis,safe⟩
    cases e with
    | none => rw [Stmt.eval]; exact Fold.pureValue (Result.normal _) _ (done _ (defaultSafe ty supported))
    | some e =>
      rw [Stmt.eval]; apply Fold.bind (Q:=post allow w c r) (Fold.fromFrame (Frame.caught (pureInit e rfl _ c r)))
      rintro (err|⟨val,mid⟩) read
      · exact Fold.pureValue (Result.reverted r _) _ trivial
      · change mid=r at read; subst mid; dsimp only
        cases eq:ty.coerceValue? val with
        | none => exact Fold.pureValue (Result.reverted r _) _ trivial
        | some v => exact Fold.pureValue (Result.normal _) _ (done _ (coerced _ _ _ supported eq))
theorem memDecl (allow : Bool) (w : Watch) (t : FunctionTable) (c : Context) (ty : Ty) (k : String) (hidden : w k=false) :
    guards allow w t c (.memoryVarDecl ty k none) := by
  intro n r hr activeFrame; cases n with
  | zero => rw [Stmt.eval]; exact Fold.reject _ _
  | succ n =>
    rw [Stmt.eval]; dsimp only
    cases out:r.declareMemoryLocal ty k ty.defaultValue with
    | none => exact Fold.pureValue (Result.reverted r _) _ trivial
    | some q =>
      apply Fold.pureValue (Result.normal q)
      unfold Runtime.declareMemoryLocal at out
      cases eq:ty.coerceValue? ty.defaultValue with
      | none => simp [eq] at out
      | some val =>
        simp only [eq] at out; cases out
        let temp := (r.memoryStoredValue val).1
        let ready := (temp.allocMemory (r.memoryStoredValue val).2).1
        have same : ready.locals=r.locals := Init.memoryEnv _ _
        have pre : safeEnv ready.locals := same ▸ hr
        have existsFrame : ready.locals≠[] := same ▸ activeFrame
        have ⟨safe,vis⟩ := declare w ready k (.memoryRef temp.nextMemory) hidden (.inr trivial) pre existsFrame
        exact ⟨.inl (memoryState _ _),vis.trans (congrArg (visible w) same),safe⟩
theorem lookupNormal (c : Context) (r : Runtime) (k : String) (non : ¬aliases k) (hr : safeEnv r.locals) :
    Frame.Ensures ((LValue.var k).resolveWithRuntime c r) (fun q=>q.2=r ∧ q.1=.local k) := by
  change Frame.Ensures (Expr.resolveLValueFuel ((Expr.var k).orderFuel+1) c r (.var k)) _
  simp only [Expr.resolveLValueFuel,noAlias _ _ hr non]; split
  · exact Frame.pureValue (P:=fun q : ResolvedLValue × Runtime=>q.2=r ∧ q.1=.local k) _ ⟨rfl,rfl⟩
  · exact Frame.failure _
end Inv39.Auth
