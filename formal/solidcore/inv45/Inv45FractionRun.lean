import Inv45FractionTail
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Format
open Bytes
theorem fractionRun (fuel : Nat) (c : Context) (r : Runtime) (q : Nat) (whole : List Nat) (intId : Nat) (negative : Bool)
    (qBound : q<Text.base) (qLoc : r.lookupLocal? "fractionalPart"=some (.word q)) (width : r.lookupLocal? "decimals"=some (.word 18))
    (W : Ref r "integerString" intId whole) (intBound : intId<r.nextMemory) (wholeSane : ∀v∈whole,v<256)
    (signBit : r.lookupLocal? "isNegative"=some (.word (if negative then 1 else 0))) (cap : c.memoryAllocationLimit?=none) :
    let signed := whole++46::Text.strip (Text.pad (Decimal.decimal q))
    ∃after out, Retains r after ∧ Decimal.Holds after (if negative then 45::signed else signed) out ∧
      Stmt.evalList (fuel+90) model.core.table c r (fraction.map Pattern.value)=pure (.returned after [out]) := by
  let t := model.core.table
  let digits := Decimal.decimal q
  let a := allocate r []
  let start := a.declareLocal temp0 (.memoryRef r.nextMemory)
  have first := Bytes.blank (fuel+89) t c r temp0
  obtain ⟨m,did,kd,dBound,dCell,computed⟩ := fetchDecimal (fuel+2) c a "fractionalPart" r.nextMemory q
    ((lookupDecl a _ _ _ (by decide)).trans qLoc) (lt_trans qBound (by decide)) cap
  let d := (localsOf m a).declareLocal temp0 (.memoryRef did)
  let b := allocate d []
  let arg := b.declareLocal temp1 (.memoryRef d.nextMemory)
  have second := Bytes.blank (fuel+89) t c d temp1
  have retainD : Retains r d := Bytes.trans (allocated r []) ⟨kd.state,kd.next,kd.memory⟩
  have retainB : Retains r b := Bytes.trans retainD (allocated d [])
  have dr : Ref arg temp0 did digits :=
    ⟨(lookupDecl b _ _ _ (by decide)).trans (declarePtr _ _ _),((allocated d []).memory did dBound).trans dCell⟩
  have count : arg.lookupLocal? "decimals"=some (.word 18) :=
    (lookupDecl b _ _ _ (by decide)).trans ((lookupDecl (localsOf m a) _ _ _ (by decide)).trans width)
  have sane : ∀v∈digits,v<256 := by intro v h;have := Decimal.decimalDigits h;omega
  obtain ⟨z,pid,kp,pBound,pCell,padded⟩ := fetchPadded (fuel+59) c b d.nextMemory did digits dr count (Text.decimalLength q qBound)
    sane (lt_of_lt_of_le dBound (allocated d []).next) cap
  let p := (localsOf z b).declareLocal temp1 (.memoryRef pid)
  let s := p.declareLocal "fractionalBytes" (.memoryRef pid)
  have aliasExec := Bytes.aliasExec (fuel+89) t c p "fractionalBytes" temp1 pid (declarePtr _ _ _)
  have len : (Text.pad digits).length≤18 := by
    simp only [Text.pad,List.length_append,List.length_replicate];have h := Text.decimalLength q qBound;change digits.length≤18 at h;omega
  have ok : ∀v∈Text.pad digits,v<256 := by
    intro v h;rcases List.mem_append.mp h with z|d
    · have := List.eq_of_mem_replicate z;omega
    · exact sane _ d
  have retain : Retains r s := Bytes.trans retainB ⟨kp.state,kp.next,kp.memory⟩
  have locals (k : String) (p0 : k≠temp0) (p1 : k≠temp1) (f : k≠"fractionalBytes") :
      s.lookupLocal? k=r.lookupLocal? k :=
    (lookupDecl p _ _ _ f).trans ((lookupDecl (localsOf z b) _ _ _ p1).trans (lookupDecl (localsOf m a) _ _ _ p0))
  have input : Ref s "fractionalBytes" pid (Text.pad digits) := ⟨declarePtr _ _ _,pCell⟩
  have integer : Ref s "integerString" intId whole :=
    ⟨(locals _ (by decide) (by decide) (by decide)).trans W.pointer,(retain.memory intId intBound).trans W.cell⟩
  obtain ⟨after,out,kept,holds,run⟩ := finishFraction (fuel+64) c s (Text.pad digits) whole pid intId negative len ok input
    pBound integer (lt_of_lt_of_le intBound retain.next) wholeSane ((locals _ (by decide) (by decide) (by decide)).trans signBit) cap
  refine ⟨after,out,Bytes.trans retain kept,holds,?_⟩
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ first).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ computed).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ second).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ padded).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ aliasExec).trans
  exact run
end Inv45.Format
