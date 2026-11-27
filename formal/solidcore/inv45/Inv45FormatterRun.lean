import Inv45FractionRun
import Inv45FormatterMath
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
def entry (r : Runtime) (v : Int) (out : Value) :=
  r.withFrame [("value",.int (Signed.word v)),("decimals",.word 18),("_ret0",out)]
theorem runData (fuel : Nat) (c : Context) (r : Runtime) (v : Int) (outId : Nat)
    (V : Signed.inRange v) (cap : c.memoryAllocationLimit?=none) :
    ∃after out, Retains r after ∧ Decimal.Holds after (Text.signed v) out ∧
      Stmt.evalList (fuel+92) model.core.table c (entry r v (.memoryRef outId)).pushScope.pushScope
        ((integerSteps++fraction).map Pattern.value)=pure (.returned after [out]) := by
  let t := model.core.table
  let s := (entry r v (.memoryRef outId)).pushScope.pushScope
  let n := v.natAbs
  let k := n/Text.base
  let q := n%Text.base
  let neg := decide (v<0)
  let b := s.declareLocal "isNegative" (.word (if v<0 then 1 else 0))
  let m := b.declareLocal temp0 (.word n)
  let a := m.declareLocal "absoluteValue" (.word n)
  let d := a.declareLocal "base" (.word Text.base)
  let i := d.declareLocal "integerPart" (.word k)
  let f := i.declareLocal "fractionalPart" (.word q)
  let buf := allocate f []
  have word : n<R := by obtain ⟨lo,hi⟩ := V;dsimp [n];norm_num [R,Signed.H] at *;omega
  have qBound : q<Text.base := Nat.mod_lt _ (by decide)
  have qword : q<R := lt_trans qBound (by decide)
  have signDecl := declareSign (fuel+91) t c s v V rfl
  have init := Inv32FloorStart.zero (fuel+91) t c b temp0
  have abs := Add.fetchMagnitudeLocal (fuel+83) c b v V rfl
  have mag := Add.declareWord (fuel+91) t "absoluteValue" (MulDiv.wordVar c m temp0 n word rfl)
  have radix := Add.declareWord (fuel+91) t "base" (readBase c a rfl)
  have integer := Add.declareWord (fuel+91) t "integerPart" (e:=part true) (readParts c d n word true rfl rfl)
  have frac := Add.declareWord (fuel+91) t "fractionalPart" (e:=part false) (readParts c i n word false rfl rfl)
  have blankMem := Bytes.blank (fuel+91) t c f temp0
  obtain ⟨z,id,keep,idB,cell,call⟩ := fetchDecimal (fuel+4) c buf "integerPart" f.nextMemory k rfl
    (lt_of_le_of_lt (Nat.div_le_self ..) word) cap
  let snapshot := (localsOf z buf).declareLocal temp0 (.memoryRef id)
  let stage := snapshot.declareLocal "integerString" (.memoryRef id)
  have aliasInt := Bytes.aliasExec (fuel+91) t c snapshot "integerString" temp0 id (declarePtr _ _ _)
  have stable : Retains r stage := Bytes.trans (r:=r) (s:=buf) ⟨rfl,Nat.le_succ _,(allocated f []).memory⟩ ⟨keep.state,keep.next,keep.memory⟩
  have Whole : Ref stage "integerString" id (Decimal.decimal k) := ⟨declarePtr _ _ _,cell⟩
  have sane : ∀v∈Decimal.decimal k,v<256 := by intro ch h;have := Decimal.decimalDigits h;omega
  have signBit : stage.lookupLocal? "isNegative"=some (.word (if neg then 1 else 0)) := by
    change some (.word (if v<0 then 1 else 0) : Value)=_;simp [neg]
  have cond := MulDiv.eqZero (MulDiv.wordVar c stage "fractionalPart" q qword rfl) qword
  have rest : ∃after out,Retains r after ∧ Decimal.Holds after (Text.signed v) out ∧
      Stmt.evalList (fuel+92) t c stage ((integerExit::fraction).map Pattern.value)=pure (.returned after [out]) := by
    by_cases Q : q=0
    · rw [if_pos Q] at cond
      obtain ⟨out,hold,sg⟩ := signReturn (fuel+89) t c stage "integerString" neg _ id Whole idB sane signBit
      have br := Inv32Blocks.branch (fuel+91) t c stage _ (sign "integerString").value .skip true (cond _ (by decide))
      refine ⟨stage,out,stable,?_,Inv32FloorFastPath.stop _ _ _ _ _ _ (fraction.map Pattern.value) _ (br.trans sg)⟩
      simpa [Text.signed,Text.numeric,neg,k,q,n,show v.natAbs%Text.base=0 from Q] using hold
    · rw [if_neg Q] at cond
      have sk : Stmt.eval (fuel+92) t c stage integerExit.value=pure (.normal stage) :=
        (MulDiv.branchFalse (fuel+91) t c stage _ _ _ cond).trans (by rw [show Stmt_skip.value=Stmt.skip from rfl,Stmt.eval])
      obtain ⟨after,out,carry,hold,run⟩ := fractionRun (fuel+2) c stage q _ id neg qBound rfl rfl Whole idB sane signBit cap
      refine ⟨after,out,Bytes.trans stable carry,?_,(Inv32FloorStart.seqStep _ _ _ _ _ _ _ sk).trans run⟩
      simpa [Text.signed,Text.numeric,neg,k,q,n,show v.natAbs%Text.base≠0 from Q] using hold
  obtain ⟨after,out,carry,holds,run⟩ := rest
  refine ⟨after,out,carry,holds,?_⟩
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ signDecl).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ init).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ abs).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ mag).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ radix).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ integer).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ frac).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ blankMem).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ call).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ aliasInt).trans
  exact run
end Inv45.Format
