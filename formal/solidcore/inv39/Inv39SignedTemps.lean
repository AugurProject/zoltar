import Inv39SignedTerms
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv39.Auth
def hashOf (bs : List Source.Byte) := Shared.norm (keccakWord ((bs.map normByte).map normByte))
def hashExpr (bs : List Source.Byte) := Source.Expr.keccak256 (.byteArray bs)
theorem bytesCoerce (v : Nat) : (Source.Ty.fixedBytes 32).coerceValue? (.fixedBytes 32 v)=some (.fixedBytes 32 (Shared.norm v)) := by
  simp [Source.Ty.coerceValue?,normWord]
theorem fixedDecl (n v : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (newName : String) (expr : Source.Expr)
    (res : expr.eval c r=pure (.fixedBytes 32 v,r)) : Stmt.eval (n+1) t c r (.varDecl (.fixedBytes 32) newName (some expr)) =
      pure (.normal (r.declareLocal newName (.fixedBytes 32 (Shared.norm v)))) := by
  rw [Stmt.eval]; dsimp only; rw [res]
  change (match (Source.Ty.fixedBytes 32).coerceValue? (.fixedBytes 32 v) with
    | some k => (pure (.normal (r.declareLocal newName k)) : SolI Result)
    | none => pure (.reverted r .typeMismatch)) = _
  rw [bytesCoerce]
theorem hashTemp (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (bs : List Source.Byte) :
    Stmt.eval (n+1) t c r (.varDecl (.fixedBytes 32) "_ic_arg_0" (some (hashExpr bs))) =
       pure (.normal (r.declareLocal "_ic_arg_0" (.fixedBytes 32 (hashOf bs)))) := by
  apply fixedDecl
  change Expr.evalFuel 3 c r (.keccak256 (.byteArray bs))=_; rw [Expr.evalFuel,Expr.evalFuel]
  change (do let v ← (liftM (r.materializeForValueUse c (.bytes (bs.map normByte))) : SolI Source.Value)
             match v.asBytes? with
             | some x=>pure (Source.Value.fixedBytes wordBytes (keccakWord x),r)
             | none=>throw (SolidityFailure.revert RevertData.typeMismatch) : SolI (Source.Value × Runtime))=_
  have mat : r.materializeForValueUse c (.bytes (bs.map normByte))=.ok (.bytes (bs.map normByte)) := by simp [Runtime.materializeForValueUse,Runtime.materializeForValueUseFuel]
  rw [mat]; rfl
theorem fixedVarDecl (n v : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (k from_ : String)
    (bound : r.lookupLocal? from_=some (.fixedBytes 32 v)) (fit : v<R) :
    Stmt.eval (n+1) t c r (.varDecl (.fixedBytes 32) k (some (.var from_)))=pure (.normal (r.declareLocal k (.fixedBytes 32 v))) := by
  simpa only [show Shared.norm v=v from Nat.mod_eq_of_lt fit] using fixedDecl n v t c r k (.var from_) (bytesVar 1 v c r from_ bound)
theorem vRead (c : Context) (r : Runtime) (v : Nat) (fit : v<256) (B : r.lookupLocal? "v"=some (.word v)) :
    (Source.Expr.castOp .uintCleanup 8 (.var "v")).eval c r=pure (.word v,r) := by
  have vf : v<R := lt_trans fit (by decide)
  have norm : Shared.norm v=v := Nat.mod_eq_of_lt vf
  have clean : uintCleanup? c.checked 8 (.word v)=.ok (.word v) := by
    simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,norm,Nat.not_le_of_gt fit,Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  change Expr.evalFuel 3 c r _=_
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ B]
  change (liftM (uintCleanup? c.checked 8 (.word v)) : SolI Source.Value) >>= _=_
  rw [clean]; rfl
end Inv39.Auth
