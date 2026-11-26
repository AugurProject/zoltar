import Inv45Declarations
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
theorem positiveExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (u addend : Nat)
    (U : r.lookupLocal? "value"=some (.int u)) (A : r.lookupLocal? "addend"=some (.word addend))
    (bound : u+addend<Signed.H) : Stmt.eval (n+4) t c r first.value=pure (.returned r [.int (u+addend)]) := by
  have fitU : u<R := by norm_num [R,Signed.H] at *;omega
  have fitA : addend<R := by norm_num [R,Signed.H] at *;omega
  have fit : u+addend<R := lt_trans bound (by decide)
  have V : Signed.inRange (u:Int) := by constructor <;> omega
  have P : Signed.inRange (↑(u+addend):Int) := by constructor <;> omega
  have localV : r.lookupLocal? "value"=some (.int (Signed.word (u:Int))) := by simpa [wordNonneg] using U
  have cond := Shapes.conditionReads c r (u:Int) V localV
  rw [if_pos (Int.natCast_nonneg _)] at cond
  let s0 := r.pushScope
  let s1 := s0.declareLocal "valueU" (.word u)
  have input := Shapes.positiveReads c s0 (u:Int) V (Int.natCast_nonneg _) localV
  have declU := declareWord (n+1) t "valueU" input
  have guardU := posGuardExec n t c s1 addend u rfl A bound
  have S := addRead (MulDiv.wordVar c s1 "valueU" u fitU rfl) (MulDiv.wordVar c s1 "addend" addend fitA A) fit
  have T := MulDiv.twiceReads S fit
  have OO : Reads c s1 (MulDiv.twice (extra (wvar "valueU") (wvar "addend"))).value (.word (Signed.word (↑(u+addend):Int))) := by
    rw [wordNonneg];exact T
  have Z := intClean (intFromWord OO P) P
  have st := returnCast (n+1) t (e:=Shapes.signedCast (MulDiv.twice (extra (wvar "valueU") (wvar "addend")))) Z
  rw [wordNonneg] at st
  let ys := [fromVar "valueU" Shapes.positive,posGuard,ret posSum]
  have yes : Stmt.eval (n+3) t c r (block ys).value=pure (.returned r [.int (u+addend)]) := by
    apply Inv32FloorFastPath.blockReturned (n+2) t c r s1 _
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ declU).trans ?_
    refine (Inv32FloorStart.seqStep _ _ _ _ _ _ _ guardU).trans ?_
    exact Inv32FloorFastPath.stop _ _ _ _ _ _ [] _ st
  have branch := Inv32Blocks.branch (n+3) t c r Shapes.nonnegative.value (block ys).value .skip true (cond _ (by omega))
  exact branch.trans yes
end Inv45.Add
