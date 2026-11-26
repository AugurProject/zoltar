import Inv39AuthSeq
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def bump := Source.Expr.incDec .add true (some (.uint 256)) (mapExpr 0 "owner")
def bumpStmt := Stmt.varDecl .uint256 "nonce" (some bump)
theorem nonceWrite (c : Context) (r : Runtime) (o v : Nat) :
    (nonceL o).write c r (.word v)=.ok {r with state:=r.state.storeSlot (nonceSlot o) (Shared.norm v)} := by
  have mat : r.storageMaterializedValue (.word v)=.ok (.word v) := by simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  simp only [ResolvedLValue.write,Runtime.storeStorageBasePathWithDeepClear,mat,noncePath,Bind.bind,Except.bind]; rfl
theorem nonceRead (c : Context) (r : Runtime) (o : Nat) :
    (nonceL o).read c r=.ok (.word (r.state.loadSlot (nonceSlot o))) := by
  simp [ResolvedLValue.read,ResolvedLValue.readRaw,Runtime.loadStorageBasePath,noncePath,State.loadStorageLayoutAt,State.loadStorageLayoutAtFuel,
    loadStorageWordAs,Ty.storageValueFromWord?,Bind.bind,Except.bind,Runtime.derefMemoryValue]
theorem bumpWrites (c : Context) (r : Runtime) (o : Nat) (output : Source.Value × Runtime)
    (ran : (nonceL o).applyIncDecCleanup c r .add true (.uint 256)=.ok output) :
    ∃ v, output=(.word (r.state.loadSlot (nonceSlot o)),{r with state:=r.state.storeSlot (nonceSlot o) v}) := by
  unfold ResolvedLValue.applyIncDecCleanup at ran
  simp only [nonceRead,Bind.bind,Except.bind,Value.oneLike?] at ran
  cases added:BinaryOp.apply c.checked .add (.word (r.state.loadSlot (nonceSlot o))) (.word 1) with
  | error err=>simp [added] at ran
  | ok x=>
    simp only [added] at ran
    cases clean:ValueCleanup.apply c.checked (.uint 256) x with
    | error err=>simp [clean] at ran
    | ok y=>
      obtain ⟨v,rfl⟩ := Frame.cleanupWord _ _ _ _ clean
      simp only [clean,nonceWrite,if_true] at ran; cases ran; exact ⟨_,rfl⟩

theorem bumpDecl (n o : Nat) (c : Context) (r : Runtime) (t : FunctionTable)
    (ref : r.lookupLocal? target=some ptr) (O : r.lookupLocal? "owner"=some (.word o)) :
    Fold.Ensures (Stmt.eval (n+1) t c r bumpStmt) (normal fun q=>∃ v, q=({r with state:=r.state.storeSlot (nonceSlot o) v} : Runtime).declareLocal "nonce" (.word (r.state.loadSlot (nonceSlot o)))) := by
  let P := normal fun q=>∃ v,q=({r with state:=r.state.storeSlot (nonceSlot o) v} : Runtime).declareLocal "nonce" (.word (r.state.loadSlot (nonceSlot o)))
  have rhs : bump.eval c r=(liftM ((nonceL o).applyIncDecCleanup c r .add true (.uint 256)) : SolI (Source.Value × Runtime)) := by
    change Expr.evalFuel (6+1) c r (.incDec .add true (some (.uint 256)) (mapExpr 0 "owner"))=_
    rw [Expr.evalFuel,mapPlace 3 0 o c r "owner" ref O]; rfl
  unfold bumpStmt; rw [Stmt.eval]; dsimp only; rw [rhs]
  cases ran:(nonceL o).applyIncDecCleanup c r .add true (.uint 256) with
  | error err=>exact Fold.pureValue (Result.reverted r err) P trivial
  | ok pair=>
    obtain ⟨v,rfl⟩ := bumpWrites _ _ _ _ ran
    exact Fold.pureValue (Result.normal _) P ⟨v,rfl⟩
end Inv39.Auth
