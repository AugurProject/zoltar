import Inv45Magnitude
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
theorem geWord (c : Bool) (a b : Nat) (A : a<R) (B : b<R) :
    Source.BinaryOp.apply c .ge (.word a) (.word b)=.ok (.word (if b≤a then 1 else 0)) := by
  have L := Inv32QuoteExpr.lt c a b A B
  change Except.ok (Value.word (Shared.ltWord a b))=_ at L
  injection L with L;injection L with L
  change Except.ok (Value.word (boolWord (!(wordTruthy (Shared.ltWord a b)))))=_
  rw [L];by_cases lt : a<b
  · rw [if_pos lt,if_neg (by omega : ¬ b≤a)];rfl
  · rw [if_neg lt,if_pos (by omega : b≤a)];rfl
theorem crossExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (mag addend : Nat)
    (A : r.lookupLocal? "addend"=some (.word addend)) (M : r.lookupLocal? "absoluteValue"=some (.word mag))
    (Afit : addend<R) (Mfit : mag<R) (P : addend-mag<Signed.H) :
    Stmt.eval (n+3) t c r cross.value=pure (if mag≤addend then .returned r [.int (addend-mag)] else .normal r) := by
  let cond := Shapes.ge (wvar "addend") (wvar "absoluteValue")
  let diff := MulDiv.sub (wvar "addend") (wvar "absoluteValue")
  let limit := limited (wvar "positiveValue") max "Scalar value positive result exceeds int256 maximum"
  let out := Shapes.signedCast (intConvert (varP "positiveValue"))
  let yes := block [fromVar "positiveValue" diff,limit,ret out]
  have test : Inv40.Reads c r cond.value (if mag≤addend then 1 else 0) :=
    Inv08.ReleaseQuote.binary (MulDiv.wordVar c r "addend" _ Afit A) (MulDiv.wordVar c r "absoluteValue" _ Mfit M)
      .ge (by intro h;cases h) (by intro h;cases h) (geWord _ _ _ Afit Mfit)
  by_cases pos : mag≤addend
  · rw [if_pos pos] at test ⊢
    have branch := Inv32Blocks.branch (n+2) t c r cond.value yes.value .skip true (test _ (by omega))
    let k := addend-mag
    let st := r.pushScope.declareLocal "positiveValue" (.word k)
    have d := subRead (MulDiv.wordVar c r.pushScope "addend" _ Afit A) (MulDiv.wordVar c r.pushScope "absoluteValue" _ Mfit M) Afit Mfit pos
    have declK := declareWord n t "positiveValue" d
    have kw : k<R := lt_trans P (by decide)
    have safe := limitedOK n t "Scalar value positive result exceeds int256 maximum"
      (MulDiv.wordVar c st "positiveValue" _ kw rfl) (maxRead c st) kw (by decide) (by omega)
    have cast := intFromUint (e:=varP "positiveValue") (Inv08.localReads c st "positiveValue" _ rfl) kw
    have val : Reads c st (intConvert (varP "positiveValue")).value (.int (Signed.word (k:Int))) := by rw [wordNonneg];exact cast
    have V : Signed.inRange (k:Int) := by constructor <;> omega
    have end' := returnCast n t (e:=intConvert (varP "positiveValue")) (intClean val V)
    rw [wordNonneg] at end'
    apply branch.trans
    apply Inv32FloorFastPath.blockReturned (n+1) t c r st _
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ declK).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ safe).trans ?_
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ end'
  · rw [if_neg pos] at test ⊢
    have branch := Inv32Blocks.branch (n+2) t c r cond.value yes.value .skip false (test _ (by omega))
    exact branch.trans (by rw [if_neg (by decide),Stmt.eval])
theorem negativeOut (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (mag : Nat)
    (M : r.lookupLocal? "negativeValue"=some (.word mag)) (positive : 0<mag) (bound : mag<Signed.H) :
    Stmt.eval (n+1) t c r (ret negRet).value=pure (.returned r [.int (Signed.word (-(mag:Int)))]) := by
  have fit : mag<R := lt_trans bound (by decide)
  have cast := intFromUint (e:=varP "negativeValue") (Inv08.localReads c r "negativeValue" _ M) fit
  have sign := unary .neg cast (signedNeg c mag positive bound)
  have V : Signed.inRange (-(mag:Int)) := by constructor <;> omega
  exact returnCast n t (e:=Shapes.negative (intConvert (varP "negativeValue"))) (intClean sign V)
end Inv45.Add
