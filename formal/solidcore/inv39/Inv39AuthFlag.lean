import Inv39AuthResolve
import Inv39SigDomain
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
abbrev flagL (o nonce : Nat) := ResolvedLValue.storageSlotPath position layout [.word 1,.word o,.fixedBytes 32 nonce]
abbrev nonceL (o : Nat) := ResolvedLValue.storageSlotPath position layout [.word 0,.word o]
theorem flagStore (c : Context) (r : Runtime) (o nonce : Nat) :
    (flagL o nonce).write c r (.word 1)=.ok {r with state:=r.state.storeSlot (flagSlot o nonce) 1} := by
  have mat : r.storageMaterializedValue (.word 1)=.ok (.word 1) := by simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
  simp only [ResolvedLValue.write,Runtime.storeStorageBasePathWithDeepClear,mat,flagPath,Bind.bind,Except.bind]; rfl
theorem flagSet (n o nonce : Nat) (c : Context) (t : FunctionTable) (r : Runtime) (owner : String)
    (pointer : r.lookupLocal? target=some ptr) (O : r.lookupLocal? owner=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce)) :
    Stmt.eval (n+1) t c r (.assign (flagPlace owner) (.word 1)) =
      pure (.normal {r with state:=r.state.storeSlot (flagSlot o nonce) 1}) := by
  have resolved : (flagPlace owner).resolveWithRuntime c r=pure (flagL o nonce,r) := flagPlaceResolved 4 _ _ _ _ _ pointer O N
  have noMemory : (flagPlace owner).wantsMemoryRefRhs r=false := by
    simp [flagPlace,LValue.wantsMemoryRefRhs,LValue.toExpr,Expr.hasStorageRoot,Expr.hasStorageRefRoot,ptrBase r pointer]
  have word : (Expr.word 1).eval c r=pure (.word 1,r) := rfl
  have okBind {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f)=f v := rfl
  have caught {α : Type} (v : α) : (pure v : SolI α).caught=pure (.ok v) := rfl
  rw [Stmt.eval]; dsimp only
  simp only [noMemory,Bool.false_eq_true,if_false,word,caught,okBind,resolved,flagStore]; rfl

theorem checkFlagRead (n o nonce : Nat) (c : Context) (r : Runtime) (owner : String)
    (pointer : r.lookupLocal? target=some ptr) (O : r.lookupLocal? owner=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce)) :
    Frame.Ensures ((flagExpr owner).evalFuel (n+5) c r) (fun q=>q.2=r) := by
  unfold flagExpr; rw [Expr.evalFuel]
  · have staticRoot : (mapExpr 1 owner).hasStorageRoot=false := rfl
    have known : (mapExpr 1 owner).hasStorageRefRoot r=true := by
      simp [mapExpr,fieldExpr,Expr.hasStorageRefRoot,ptrBase r pointer]
    simp only [staticRoot,Bool.false_eq_true,if_false,known,if_true]
    change Frame.Ensures (do let (loc,mid) ← Expr.resolveLValueFuel (n+4) c r (flagExpr owner); let v ← loc.read c mid; pure (v,mid)) _
    rw [flagPlaceResolved n o nonce c r owner pointer O N]
    change Frame.Ensures ((liftM ((flagL o nonce).read c r) : SolI Source.Value) >>= fun v=>pure (v,r)) _
    apply Frame.liftExcept; intro _; exact Frame.pureValue _ rfl
  · intro name eq; cases eq
end Inv39.Auth
