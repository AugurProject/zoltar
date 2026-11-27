import Inv45CopyLoop
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Pad
open Bytes
theorem lookup {r m i name} (ne : name≠"index") :
    (active r m i).lookupLocal? name=r.lookupLocal? name := by
  simp [active,Decimal.withMemory,Runtime.lookupLocal?,Runtime.pushScope,Runtime.withFrame,
    LocalEnv.lookup?,Frame.lookup?,Ne.symm ne]
theorem scopedLookup {r m i name} (ne : name≠"index") :
    (active r m i).pushScope.lookupLocal? name=r.lookupLocal? name := lookup ne
private theorem literal48 (c : Context) (r : Runtime) :
    Expr.evalMemoryRefPreserving c r (.word 48)=pure (.word 48,r) := by rfl
theorem zeroLoop (fuel : Nat) (c : Context) (r : Runtime) (id len : Nat) (small : len≤18)
    (ptr : r.lookupLocal? "padded"=some (.memoryRef id))
    (pad : r.lookupLocal? "paddingLength"=some (.word (18-len)))
    (cell : r.loadMemory? id=some (.bytes (List.replicate 18 0))) :
    ∃m, SameElsewhere r m id ∧
      (Decimal.withMemory r m).loadMemory? id=some (.bytes (List.replicate (18-len) 48++List.replicate len 0)) ∧
      Stmt.eval (fuel+(18-len)+6) model.core.table c r zeros.value=pure (.normal (Decimal.withMemory r m)) := by
  have word : 18<R := by decide
  let data := List.replicate (18-len) 48
  have size : data.length=18-len := List.length_replicate
  have reads : CopyReads c r id "padded" 0 data (wvar "paddingLength") (varP "index") (num 48) := by
    constructor
    · intro m i _;rw [size];exact MulDiv.wordVar _ _ _ _ (by omega) ((lookup (by decide)).trans pad)
    · intro m i;exact (scopedLookup (by decide)).trans ptr
    · intro m i lt _;simp only [Nat.zero_add];exact Inv08.localReads _ _ _ _ rfl
    · intro m i lt _;simp only [data,List.getElem_replicate];exact literal48 _ _
  have initial : r.loadMemory? id=some (.bytes (copyBuffer [] data (List.replicate len 0) 0)) := by
    simpa [copyBuffer,size,←List.replicate_add,show 18-len+len=18 by omega] using cell
  obtain ⟨m,same,stored,run⟩ := copyLoop fuel _ _ _ id "padded" [] data (List.replicate len 0) _ _ _ reads
    (by simp [size];omega) (by simp) (by intro x h;have := List.eq_of_mem_replicate h;omega)
    (by intro x h;have := List.eq_of_mem_replicate h;omega) initial
  exact ⟨m,same,by simpa [data] using stored,by simpa only [size] using run⟩
theorem appendLoop (fuel : Nat) (c : Context) (r : Runtime) (id src : Nat) (xs : List Nat)
    (small : xs.length≤18) (sane : ∀v∈xs,v<256) (distinct : src≠id)
    (ptr : r.lookupLocal? "padded"=some (.memoryRef id))
    (input : Ref r "valueBytes" src xs) (pad : r.lookupLocal? "paddingLength"=some (.word (18-xs.length)))
    (cell : r.loadMemory? id=some (.bytes (List.replicate (18-xs.length) 48++List.replicate xs.length 0))) :
    ∃m, SameElsewhere r m id ∧ (Decimal.withMemory r m).loadMemory? id=some (.bytes (Text.pad xs)) ∧
      Stmt.eval (fuel+xs.length+6) model.core.table c r copy.value=pure (.normal (Decimal.withMemory r m)) := by
  have word : 18<R := by decide
  let before := List.replicate (18-xs.length) 48
  let idx := Expr_binary BinaryOp_add (varP "paddingLength") (varP "index")
  let rhs := index (varP "valueBytes") (varP "index")
  have source (m i) (same : SameElsewhere r m id) : Ref (active r m i) "valueBytes" src xs :=
    ⟨(lookup (by decide)).trans input.pointer,(same src distinct).trans input.cell⟩
  have reads : CopyReads c r id "padded" before.length xs (size "valueBytes") idx rhs := by
    constructor
    · intro m i same
      exact Inv08.ReleaseQuote.readClean (Bytes.length c _ _ _ _ (source m i same)) (by omega)
    · intro m i;exact (scopedLookup (by decide)).trans ptr
    · intro m i lt _
      apply Inv08.ReleaseQuote.binary (Inv08.localReads _ _ _ _ ((scopedLookup (by decide)).trans pad))
        (Inv08.localReads _ _ "index" i rfl) .add (by intro h;cases h) (by intro h;cases h)
      simp only [before,List.length_replicate]
      exact Inv40.addWords _ _ _ (by omega)
    · intro m i lt same
      have ref : Ref (active r m i).pushScope "valueBytes" src xs :=
        ⟨(scopedLookup (by decide)).trans input.pointer,(same src distinct).trans input.cell⟩
      exact indexPreserved ref (by omega) (Inv08.localReads _ _ "index" i rfl) sane (List.getElem?_eq_getElem lt)
  obtain ⟨m,same,stored,run⟩ := copyLoop fuel _ _ _ id "padded" before xs [] _ _ _ reads
    (by simp [before];omega) (by intro x h;have := List.eq_of_mem_replicate h;omega) sane (by simp)
    (by simpa [before,copyBuffer] using cell)
  exact ⟨m,same,by simpa [Text.pad,before] using stored,run⟩
end Inv45.Pad
