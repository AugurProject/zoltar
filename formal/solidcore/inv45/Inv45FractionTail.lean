import Inv45FormatterText
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Bytes
theorem lookupDecl (r : Runtime) (name k : String) (value : Value) (ne : k≠name) :
    (r.declareLocal name value).lookupLocal? k=r.lookupLocal? k := by
  cases h : r.locals <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h,Ne.symm ne]
theorem lookupHere (r : Runtime) (name : String) (v : Value) :
    (r.declareLocal name v).lookupLocal? name=some v := by
  cases h : r.locals <;> simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h]
end Inv45.Bytes
namespace Inv45.Format
open Bytes
theorem finishFraction (fuel : Nat) (c : Context) (r : Runtime) (xs whole : List Nat) (src intId : Nat) (negative : Bool)
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (S : Ref r "fractionalBytes" src xs) (srcBound : src<r.nextMemory)
    (W : Ref r "integerString" intId whole) (intBound : intId<r.nextMemory) (wholeSane : ∀v∈whole,v<256)
    (signBit : r.lookupLocal? "isNegative"=some (.word (if negative then 1 else 0))) (cap : c.memoryAllocationLimit?=none) :
    let signed := whole++46::Text.strip xs
    ∃after out, Retains r after ∧ Decimal.Holds after (if negative then 45::signed else signed) out ∧
      Stmt.evalList (fuel+26) model.core.table c r ((fraction.drop 5).map Pattern.value)=pure (.returned after [out]) := by
  let t := model.core.table
  let len := (Text.strip xs).length
  let id := r.nextMemory
  let s := Trim.atCount r len
  let allocated := allocate s (List.replicate len 0)
  let dst := allocated.declareLocal "trimmed" (.memoryRef id)
  let value := whole++46::Text.strip xs
  have form := Text.restore xs
  have l := congrArg List.length form
  simp only [List.length_append,List.length_replicate] at l
  have L : len≤18 := by dsimp [len];omega
  have fit : xs.length<R := lt_of_le_of_lt small (by decide)
  have dec := Add.declareWord (fuel+25) t "trimIndex" (e:=size "fractionalBytes") (Inv08.ReleaseQuote.readClean (length c r _ _ _ S) fit)
  have loop := Trim.loopRun (fuel+3) c r src xs small S sane
  have lenPtr : s.lookupLocal? "trimIndex"=some (.word len) := lookupHere _ _ _
  have mem := allocateBytes (fuel+25) t c s "trimmed" "trimIndex" len lenPtr (by omega) cap
  have dlen : dst.lookupLocal? "trimIndex"=some (.word len) :=
    (lookupDecl allocated _ _ _ (by decide)).trans lenPtr
  have ptr : Ref dst "fractionalBytes" src xs :=
    ⟨(lookupDecl allocated _ _ _ (by decide)).trans ((lookupDecl r _ _ _ (by decide)).trans S.pointer),
      ((Bytes.allocated s _).memory src srcBound).trans S.cell⟩
  obtain ⟨m,other,stored,copy⟩ := Trim.copyRun (fuel+20-len) c dst id src xs small (Nat.ne_of_lt srcBound) ptr sane dlen
    (lookupHere _ _ _) (load s _ _)
  let endR := Decimal.withMemory dst m
  have E : fuel+20-len+(Text.strip xs).length+6=fuel+26 := by change fuel+20-len+len+6=_;omega
  rw [E] at copy
  have keep : Retains r endR :=
    ⟨rfl,Nat.le_succ _,fun i earlier => (other _ (Nat.ne_of_lt earlier)).trans ((Bytes.allocated s _).memory i earlier)⟩
  have iw : Ref endR "integerString" intId whole :=
    ⟨(lookupDecl allocated _ _ _ (by decide)).trans ((lookupDecl r _ _ _ (by decide)).trans W.pointer),
      (keep.memory _ intBound).trans W.cell⟩
  have trimmed : Ref endR "trimmed" id (Text.strip xs) := ⟨lookupHere _ _ _,stored⟩
  have saneTrim : ∀v∈Text.strip xs,v<256 := fun v h=>sane v (form ▸ List.mem_append_left _ h)
  let es := [varP "integerString",Decimal.bytesLiteral [46],varP "trimmed"]
  have parts : ByteParts c endR es [whole,[46],Text.strip xs] :=
    .cons (val _ _ _ _ _ iw) wholeSane (.cons (literalBytes _ _ _ (by decide)) (by decide) (.cons (val _ _ _ _ _ trimmed) saneTrim .nil))
  have encoded := preparePacked (fuel+25) t "result" parts
  have concat : [whole,[46],Text.strip xs].flatten=value := by simp [value]
  rw [concat] at encoded
  let outR := (allocate endR value).declareLocal "result" (.memoryRef endR.nextMemory)
  have result : Ref outR "result" endR.nextMemory value := ⟨lookupHere _ _ _,load endR _ _⟩
  have resSign : outR.lookupLocal? "isNegative"=some (.word (if negative then 1 else 0)) :=
    (lookupDecl (allocate endR value) _ _ _ (by decide)).trans
      ((lookupDecl allocated _ _ _ (by decide)).trans ((lookupDecl r _ _ _ (by decide)).trans signBit))
  have saneValue : ∀ch∈value,ch<256 := by
    intro ch h;rcases List.mem_append.mp h with w|q
    · exact wholeSane ch w
    · rcases List.mem_cons.mp q with dot|f
      · omega
      · exact saneTrim _ f
  obtain ⟨out,holds,sg⟩ := signReturn (fuel+24) t c outR "result" negative value endR.nextMemory result (Nat.lt_succ_self _) saneValue resSign
  refine ⟨outR,out,Bytes.trans keep ⟨rfl,Nat.le_succ _,(Bytes.allocated endR _).memory⟩,holds,?_⟩
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ dec).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ loop).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ mem).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ copy).trans
  apply (Inv32FloorStart.seqStep _ _ _ _ _ _ _ encoded).trans
  exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ sg
end Inv45.Format
