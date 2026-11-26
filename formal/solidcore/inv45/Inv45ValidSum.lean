import Inv45GetterHoists
import Inv45PublicShape
open SolidCore.Solidity.Source Inv32Division
namespace Inv45.Public

def cleanedPart (name : String) : Expr := .castOp .uintCleanup 256 (.castOp .uintCast 256 (.var name))
def tickSum : Expr := .castOp .uintCleanup 256 (.castOp .uintCleanup 256 (.binary .add (cleanedPart "firstPart") (cleanedPart "secondPart")))

theorem sumDeclaration (fuel : Nat) (c : Context) (r : Runtime) (n k : Nat)
    (N : n<Answer.radix) (valid : k≤n) (first : r.lookupLocal? "firstPart"=some (.word (n-k)))
    (second : r.lookupLocal? "secondPart"=some (.word k)) :
    Stmt.eval (fuel+1) model.core.table c r (.varDecl .uint256 "sum" (some tickSum))=pure (.normal (r.declareLocal "sum" (.word n))) := by
  have nf : n<R := lt_trans N (by decide)
  have part (name : String) (x : Nat) (fit : x<R) (localValue : r.lookupLocal? name=some (.word x)) :
      Inv40.Reads c r (cleanedPart name) x :=
    Inv08.ReleaseQuote.readClean (Inv08.Authority.castBits (Inv08.localReads _ _ _ _ localValue) 256 (by decide) (by decide) fit) fit
  have eqn : n-k+k=n := Nat.sub_add_cancel valid
  have add := Inv08.ReleaseQuote.binary (part _ _ (lt_of_le_of_lt (Nat.sub_le _ _) nf) first)
    (part _ _ (lt_of_le_of_lt valid nf) second) .add (by intro h;cases h) (by intro h;cases h)
    (Inv40.addWords c.checked (n-k) k (by rw [eqn];exact nf))
  rw [eqn] at add
  have clean := Inv08.ReleaseQuote.readClean (Inv08.ReleaseQuote.readClean add nf) nf
  exact Inv32Hoist.declEval _ _ _ _ _ _ _ _ (clean _ (Nat.le_succ _)) rfl
#print axioms sumDeclaration
end Inv45.Public
