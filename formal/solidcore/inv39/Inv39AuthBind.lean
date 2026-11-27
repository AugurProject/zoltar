import Inv39AuthWorld
open SolidCore.Solidity.Source Inv32FloorStart
namespace Inv39.Auth
def binds : List Stmt := [.storageAlias result emptyRef,.captureReturn [result] (.internalCall [result] helper []),.storageAliasFrom target result]
def boundRoot (r : Runtime) := (r.declareLocal result ptr).declareLocal target ptr
private theorem returnsCaptured (r : Runtime) : internalCallAssign (r.declareLocal result empty) [result] [ptr] =
    pure (Result.normal (r.declareLocal result ptr)) := by
  cases r with
  | mk s ls m n a b=>cases ls <;> rfl
theorem justDeclared (r : Runtime) (k : String) (v : Value) : (r.declareLocal k v).lookupLocal? k=some v := by
  cases r with | mk s ls m n a b=>cases ls <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
theorem otherDeclared (r : Runtime) (k other : String) (v : Value) (diff : k≠other) :
    (r.declareLocal k v).lookupLocal? other=r.lookupLocal? other := by
  cases r with | mk s ls m n a b=>cases ls <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,diff]
theorem bindThen (n : Nat) (c : Context) (r : Runtime) (ss : List Stmt) :
    Stmt.evalList (n+5) model.core.table c r (binds++ss)=Stmt.evalList (n+5) model.core.table c (boundRoot r) ss := by
  let t := model.core.table
  let first := r.declareLocal result empty
  let actual := r.declareLocal result ptr
  have a : Stmt.eval (n+5) t c r (.storageAlias result emptyRef)=pure (.normal first) := by rw [Stmt.eval]; rfl
  have b := Inv32Internal.capture (n+4) t c first actual [result] _ ((call n c first [result]).trans (returnsCaptured r))
  have pointer : actual.lookupStorageBase? result=some root := by simp [actual,Runtime.lookupStorageBase?,justDeclared,ptr,root]
  have d : Stmt.eval (n+5) t c actual (.storageAliasFrom target result)=pure (.normal (boundRoot r)) := by
    rw [Stmt.eval]; dsimp only; rw [pointer]; rfl
  exact (seqStep _ _ _ _ _ _ _ a).trans ((seqStep _ _ _ _ _ _ _ b).trans (seqStep _ _ _ _ _ _ _ d))
theorem boundSafety (r : Runtime) (hr : safeEnv r.locals) (live : r.locals≠[]) :
    safeEnv (boundRoot r).locals ∧ (boundRoot r).locals≠[] := by
  let first := r.declareLocal result ptr
  have mid : Relative (fun _=>false) model.core.context r first :=
    ⟨.inl rfl,(declare (fun _=>false) r _ _ rfl (.inl (.inr rfl)) hr live).2,(declare (fun _=>false) r _ _ rfl (.inl (.inr rfl)) hr live).1⟩
  have pre : first.locals≠[] := active mid live
  have done := declare (fun _=>false) first target ptr rfl (.inl (.inl rfl)) mid.safe pre
  exact ⟨done.1,active (c:=model.core.context) (r:=first) (q:=boundRoot r) (w:=fun _=>false) ⟨.inl rfl,done.2,done.1⟩ pre⟩
end Inv39.Auth
