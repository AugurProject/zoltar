import Inv45Newton
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
def stageList := allSteps.map Pattern.value
def reducedDen (d : Nat) := d/(bv d &&& -(bv d)).toNat
theorem stagesForm : stageList = [(.varDecl .uint256 "prod0" none),(.varDecl .uint256 "prod1" none),
    productBlock.value,narrow.value,wideOK.value,(.varDecl .uint256 "remainder" none),remainderBlock.value,
    (decl "twos" (Option_some twos)).value,divideTwos.value] ++ tail := rfl
theorem gtRead {c r x y a b} (X : Inv40.Reads c r (x : Pattern Source.Expr).value a)
    (Y : Inv40.Reads c r (y : Pattern Source.Expr).value b) (A : a<R) (B : b<R) (bigger : b<a) :
    Inv40.Reads c r (op BinaryOp_gt x y).value 1 := by
  apply Inv08.ReleaseQuote.binary X Y .gt (by intro h;cases h) (by intro h;cases h)
  rw [Inv32QuoteExpr.gt _ _ _ A B,if_pos bigger]
theorem guardYes {c r test msg} (n : Nat) (t : FunctionTable)
    (D : Inv40.Reads c r (test : Pattern Source.Expr).value 1) :
    Stmt.eval (n+1) t c r (guard test msg).value=pure (.normal r) :=
  Inv32QuoteGuard.requireEval n t c r _ true msg (D _ (by omega))
theorem widePath (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (x y d : Nat)
    (X : x<R) (Y : y<R) (D : d<R) (wide : 0<x*y/R) (fits : x*y/R<d) (un : c.checked=false) :
    Stmt.eval (n+4) t c (outer r x y d 0) (.block stageList) =
      pure (.normal (outer r x y (reducedDen d) (x*y/d))) := by
  let p := x*y
  let h := p/R
  let l := p%R
  let rem := p%d
  let top := h-(if l<rem then 1 else 0)
  let low := (l+R-rem)%R
  let m := (bv d &&& -(bv d)).toNat
  let flip := ((R-m)/m+1)%R
  let qd := d/m
  let ql := low/m
  let merged := bv ql ||| bv top*bv flip
  let inverse := Inv32Newton.iterate (bv qd) 6
  let start := outer r x y d 0
  let pr := registers start h l
  let post := Inv32NewtonBody.put (withFactor r x y qd (merged*inverse).toNat top merged.toNat rem flip) inverse
  have hr : h<R := lt_trans fits D
  have lr : l<R := Nat.mod_lt _ (by decide)
  have df : 0<d := lt_trans wide fits
  have mm : m<R := (bv d &&& -(bv d)).isLt
  have mp : 0<m := Inv32WideEntry.lowBitPos _ (by simpa only [Inv32WideAdapters.toNat _ D] using df)
  have tr : top<R := lt_of_le_of_lt (Nat.sub_le ..) hr
  have dr : qd<R := lt_of_le_of_lt (Nat.div_le_self ..) D
  have qr : ql<R := lt_of_le_of_lt (Nat.div_le_self ..) (Nat.mod_lt _ (by decide))
  have fr : flip<R := Nat.mod_lt _ (by decide)
  have product := evalProductBlock n t c start x y rfl rfl X Y un
  have no := eqZero (wordVar c pr "prod1" h hr rfl) hr
  rw [if_neg (Nat.ne_of_gt wide)] at no
  let retLo := block [ret (div (v "prod0") (v "denominator"))]
  have dropN : Stmt.eval (n+3) t c pr narrow.value = pure (.normal pr) := by
    have b := branchFalse (n+2) t c pr retLo Stmt_skip _ no
    exact b.trans (by rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval])
  have guardExec := guardYes (msg:="mulDiv result would overflow uint256") (n+2) t
    (gtRead (wordVar c pr "denominator" d D rfl) (wordVar c pr "prod1" h hr rfl) D hr fits)
  have borrow := evalBorrow n t c r x y d h l X Y D df hr wide lr un
  have tw := declareTwos (n+2) t c (withRem r x y d 0 top low rem) (bv d) un
    (by rw [Inv32WideAdapters.toNat _ D];rfl)
  have reduc := reduceTwos n t c r x y d top low rem m D (Nat.mod_lt _ (by decide)) mm mp un
  have finishRun := newtonRun (n+2) t c r x y rem (bv qd) (bv top) (bv ql) (bv flip) un
  simp only [Inv32WideAdapters.toNat _ dr,Inv32WideAdapters.toNat _ tr,Inv32WideAdapters.toNat _ qr,Inv32WideAdapters.toNat _ fr] at finishRun
  have finalRun : Stmt.evalList (n+3) t c start.pushScope stageList=pure (.normal post) := by
    rw [stagesForm]
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) t c start.pushScope "prod0")).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) t c _ "prod1")).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ product).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ dropN).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ guardExec).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32FloorStart.zero (n+2) t c pr "remainder")).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ borrow).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ tw).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ reduc).trans ?_
    exact finishRun
  have correct : (merged*inverse).toNat=x*y/d := Inv32WideMath.result x y d D wide fits
  change Stmt.eval (n+4) t c start (.block stageList)=_
  rw [Stmt.eval];dsimp only;rw [finalRun]
  change (pure (Result.normal (outer r x y qd (merged*inverse).toNat)) : SolI Result)=_
  rw [correct];rfl
end Inv45.MulDiv
