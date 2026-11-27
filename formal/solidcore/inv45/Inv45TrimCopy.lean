import Inv45TrimLoop
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Trim
open Bytes
theorem copyRun (fuel : Nat) (c : Context) (r : Runtime) (dest src : Nat) (xs : List Nat)
    (small : xs.length≤18) (distinct : src≠dest) (input : Ref r "fractionalBytes" src xs) (sane : ∀v∈xs,v<256)
    (trim : r.lookupLocal? "trimIndex"=some (.word (Text.strip xs).length))
    (ptr : r.lookupLocal? "trimmed"=some (.memoryRef dest))
    (cell : r.loadMemory? dest=some (.bytes (List.replicate (Text.strip xs).length 0))) :
    ∃m, SameElsewhere r m dest ∧ (Decimal.withMemory r m).loadMemory? dest=some (.bytes (Text.strip xs)) ∧
      Stmt.eval (fuel+(Text.strip xs).length+6) model.core.table c r prefixCopy.value=pure (.normal (Decimal.withMemory r m)) := by
  let data := Text.strip xs
  have form : data++List.replicate (xs.length-data.length) 48=xs := Text.restore xs
  have bound := congrArg List.length form
  simp only [List.length_append,List.length_replicate] at bound
  have word : 18<R := by decide
  have reads : CopyReads c r dest "trimmed" 0 data (wvar "trimIndex") (varP "index") (index (varP "fractionalBytes") (varP "index")) := by
    constructor
    · intro m i _;exact MulDiv.wordVar _ _ _ _ (by omega) ((Pad.lookup (by decide)).trans trim)
    · intro m i;exact (Pad.scopedLookup (by decide)).trans ptr
    · intro m i _ _;simp only [Nat.zero_add];exact Inv08.localReads _ _ _ _ rfl
    · intro m i inside same
      have ref : Ref (active r m i).pushScope "fractionalBytes" src xs :=
        ⟨(Pad.scopedLookup (by decide)).trans input.pointer,(same src distinct).trans input.cell⟩
      exact indexPreserved ref (by omega) (Inv08.localReads _ _ "index" i rfl) sane
        (by rw [←form,List.getElem?_append_left inside,List.getElem?_eq_getElem inside])
  obtain ⟨m,other,bytes,run⟩ := copyLoop fuel _ _ _ dest _ [] data [] _ _ _ reads (by simp;omega) (by simp)
    (by intro v hin;apply sane v;rw [←form];exact List.mem_append_left _ hin) (by simp)
    (by simpa [copyBuffer,data] using cell)
  exact ⟨m,other,by simpa using bytes,run⟩
end Inv45.Trim
