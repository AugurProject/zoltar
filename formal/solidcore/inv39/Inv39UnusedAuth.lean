import Inv39AuthSeq
open SolidCore.Solidity.Source
namespace Inv39.Auth
def unusedFlag (owner : String) := Stmt.requireStmt (.unary .logicalNot (flagExpr owner)) (some "ERC3009 authorization already used")
theorem unused (n o nonce : Nat) (c : Context) (t : FunctionTable) (r : Runtime) (owner : String)
    (pointer : r.lookupLocal? target=some ptr) (O : r.lookupLocal? owner=some (.word o)) (N : r.lookupLocal? "nonce"=some (.fixedBytes 32 nonce)) :
    Fold.Ensures (Stmt.eval (n+1) t c r (unusedFlag owner)) (normal (·=r)) := by
  have val : Frame.Ensures ((Expr.unary .logicalNot (flagExpr owner)).eval c r) (fun q=>q.2=r) := by
    change Frame.Ensures (Expr.evalFuel (8+1) c r (.unary .logicalNot (flagExpr owner))) _
    rw [Expr.evalFuel]; apply Frame.bind (checkFlagRead 3 o nonce c r owner pointer O N)
    rintro ⟨v,mid⟩ read
    apply Frame.liftExcept; intro _; exact Frame.pureValue _ read
  unfold unusedFlag; rw [Stmt.eval]
  apply Fold.bind (Q:=normal (·=r)) (Fold.fromFrame (Frame.caught val))
  rintro (err|⟨v,mid⟩) eq
  · exact Fold.pureValue (Result.reverted r _) _ trivial
  · change mid=r at eq; subst mid; dsimp only
    split <;> first | exact Fold.pureValue (Result.reverted r _) _ trivial | skip
    split <;> first | exact Fold.pureValue (Result.normal r) _ rfl | exact Fold.pureValue (Result.reverted r _) _ trivial
end Inv39.Auth
