import Inv48MinimaCeilHoist
import Inv48MinimaAdd
import Inv48MinimaLocals
import Inv48Model
import Inv48MinimaSyntax
open SolidCore.Solidity.Source Inv32Division Inv32Actions Inv32Scalar Inv32Product Inv32FloorStart Inv32Hoist
namespace Inv48.Minima
abbrev operand := "#operand47452"
abbrev exposureLocal := "#view47456"
abbrev ceilLocal := "#view47458"
abbrev sumLocal := "#operand47459"
def collateralTail : List Stmt :=
  [.varDecl .uint256 exposureLocal (some (.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp))),
   .varDecl .uint256 Inv03.Bodies.tmp none,
   (Inv48.MinimaCeil.code exposureLocal).value,
   .varDecl .uint256 ceilLocal (some (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var Inv03.Bodies.tmp)))),
   .varDecl .uint256 sumLocal (some (Inv48.MinimaAdd.checkedSum operand ceilLocal).core),
   .returnValues [.castOp .uintCleanup 256 (.var sumLocal)]]

theorem collateralTail_source :
    (match collateralBody with | .block [_,.block [.block xs]] => xs.drop 3 | _ => []) = collateralTail := by rfl

def tailState (r : Runtime) (x base : Nat) :=
  let rounded := Inv03.ceilQuot x 100
  let a := r.declareLocal exposureLocal (.word x)
  let b := Inv32OneArg.store a Inv03.Bodies.tmp rounded
  let d := b.declareLocal ceilLocal (.word rounded)
  d.declareLocal sumLocal (.word (base+rounded))

theorem collateralTailRun (table : FunctionTable) (ceilLinked : Inv32Library.LinkAt table Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value) (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body) (n : Nat) (c : Context) (r : Runtime) (x base : Nat)
    (small : x<R) (bsmall : base<R) (fits : base+Inv03.ceilQuot x 100<R)
    (checked : c.checked=true)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x))
    (B : r.lookupLocal? operand=some (.word base)) :
    Stmt.evalList (n+16) table c r collateralTail =
      pure (.returned (tailState r x base) [.word (base+Inv03.ceilQuot x 100)]) := by
  let t := table
  let q := Inv03.ceilQuot x 100
  let a := r.declareLocal exposureLocal (.word x)
  let b := Inv32OneArg.store a Inv03.Bodies.tmp q
  let d := b.declareLocal ceilLocal (.word q)
  let final := d.declareLocal sumLocal (.word (base+q))
  have qfit : q<R := lt_of_le_of_lt (Nat.le_add_left q base) fits
  have read : Expr.eval c r (.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)) = pure (.word x,r) :=
    Inv32Guards.clean _ c r (.var Inv03.Bodies.tmp) x small (Inv32Guards.readWord _ c r _ _ X)
  have first := declEval (n+15) t c r exposureLocal .uint256 _ x read (by rw [Ty.coerceValue?])
  have rounded := Inv48.MinimaCeil.hoist table ceilLinked uintLinked n c a exposureLocal x small (by simp [Inv32CeilFlags.h0,localWord,Inv32FloorHoist.start,Inv32OneArg.store,a,exposureLocal,Inv03.Bodies.tmp])
  have copied : Expr.eval c b (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var Inv03.Bodies.tmp))) =
      pure (.word q,b) := by
    exact evalFormula (Inv32QuoteExpr.castCopy Inv03.Bodies.tmp) c b q (by decide)
      (Inv32QuoteExpr.castValue _ _ _ _ qfit (by simp [Inv32CeilFlags.h0,localWord,locals,b,Inv32OneArg.store]))
  have copy := declEval (n+15) t c b ceilLocal .uint256 _ q copied (by rw [Ty.coerceValue?])
  have baseread : locals d operand=some base := by
    simp [Inv32CeilFlags.h0,localWord,locals,d,b,a,Inv32OneArg.store,operand,exposureLocal,ceilLocal,Inv03.Bodies.tmp,B]
  have sumRead := Inv48.MinimaAdd.value (n+15) t c d operand ceilLocal base q bsmall qfit fits checked baseread (by simp [Inv32CeilFlags.h0,localWord,locals,d])
  have sumStep := declEval (n+15) t c d sumLocal .uint256 _ (base+q) sumRead (by rw [Ty.coerceValue?])
  have result := Inv32CompareValues.retOne (n+15) t c final (clean (localWord sumLocal)).core (base+q)
    (evalFormula (clean (localWord sumLocal)) c final (base+q) (by decide)
      (Inv32ProductValues.cleanup _ _ _ _ fits (by simp [Inv32CeilFlags.h0,localWord,locals,final])))
  unfold collateralTail
  exact (seqStep _ _ _ _ _ _ _ first).trans ((seqStep _ _ _ _ _ _ _ (zero (n+15) t c a _)).trans
    ((seqStep _ _ _ _ _ _ _ rounded).trans ((seqStep _ _ _ _ _ _ _ copy).trans
    ((seqStep _ _ _ _ _ _ _ sumStep).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ result)))))


def repTail : List Stmt :=
  [.varDecl .uint256 "#view47476" (some (.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp))),
   .varDecl .uint256 Inv03.Bodies.tmp none,
   (Inv48.MinimaCeil.code "#view47476").value,
   .returnValues [(Inv32QuoteExpr.castCopy Inv03.Bodies.tmp).core]]
theorem repTail_source :
    (match repBody with | .block [_,.block [.block xs]] => xs.drop 5 | _ => []) = repTail := by rfl

theorem repTailRun (table : FunctionTable)
    (ceilLinked : Inv32Library.LinkAt table Inv04.Shapes.ceilKey [.word "a",.word "b"] [.word "_ret0"] Inv04.Shapes.ceilShape.value)
    (uintLinked : Inv32Library.LinkAt table Inv32Bodies.ToUint.key [.flag "b"] [.word "u"] Inv32Bodies.ToUint.body)
    (n : Nat) (c : Context) (r : Runtime) (x : Nat) (small : x<R)
    (X : r.lookupLocal? Inv03.Bodies.tmp=some (.word x)) :
    Stmt.evalList (n+16) table c r repTail =
      pure (.returned (Inv32OneArg.store (r.declareLocal "#view47476" (.word x)) Inv03.Bodies.tmp (Inv03.ceilQuot x 100))
        [.word (Inv03.ceilQuot x 100)]) := by
  let q := Inv03.ceilQuot x 100
  let a := r.declareLocal "#view47476" (.word x)
  let b := Inv32OneArg.store a Inv03.Bodies.tmp q
  have qfit : q<R := by
    have h := (Inv03.ceil_le x 100 x (by decide)).mpr (by omega : x≤x*100)
    exact lt_of_le_of_lt h small
  have read : Expr.eval c r (.castOp .uintCleanup 256 (.var Inv03.Bodies.tmp)) = pure (.word x,r) :=
    Inv32Guards.clean _ c r (.var Inv03.Bodies.tmp) x small (Inv32Guards.readWord _ c r _ _ X)
  have first := declEval (n+15) table c r "#view47476" .uint256 _ x read (by rw [Ty.coerceValue?])
  have round := Inv48.MinimaCeil.hoist table ceilLinked uintLinked n c a "#view47476" x small (by simp [Inv32CeilFlags.h0,localWord,Inv32FloorHoist.start,Inv32OneArg.store,a,Inv03.Bodies.tmp])
  have ret := Inv32CompareValues.retOne (n+15) table c b (Inv32QuoteExpr.castCopy Inv03.Bodies.tmp).core q
    (evalFormula (Inv32QuoteExpr.castCopy Inv03.Bodies.tmp) c b q (by decide)
      (Inv32QuoteExpr.castValue _ _ _ _ qfit (by simp [Inv32CeilFlags.h0,localWord,locals,b,Inv32OneArg.store])))
  exact (seqStep _ _ _ _ _ _ _ first).trans ((seqStep _ _ _ _ _ _ _ (zero (n+15) table c a Inv03.Bodies.tmp)).trans
    ((seqStep _ _ _ _ _ _ _ round).trans (Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ ret)))
end Inv48.Minima
