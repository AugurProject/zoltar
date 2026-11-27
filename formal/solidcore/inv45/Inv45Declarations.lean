import Inv45AddReads
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Add
theorem declareWord {c r e val} (n : Nat) (t : FunctionTable) (name : String) (H : Inv40.Reads c r (e : Pattern Source.Expr).value val) :
    Stmt.eval (n+1) t c r (fromVar name e).value=pure (.normal (r.declareLocal name (.word val))) := by
  have E : Expr.eval c r e.value=pure (.word val,r) := H _ (by omega)
  change Stmt.eval (n+1) t c r (.varDecl .uint256 name (some e.value))=_
  rw [Stmt.eval];dsimp only;rw [E];rfl
theorem declareSigned {c r e val} (n : Nat) (t : FunctionTable) (name : String) (H : Reads c r (e : Pattern Source.Expr).value (.int val)) :
    Stmt.eval (n+1) t c r (.varDecl .int256 name (some e.value))=pure (.normal (r.declareLocal name (.int val))) := by
  have E : Expr.eval c r e.value=pure (.int val,r) := H _ (by omega)
  rw [Stmt.eval];dsimp only;rw [E];rfl
theorem returnCast {c r e val} (n : Nat) (t : FunctionTable) (H : Reads c r (Shapes.signedCast (e : Pattern Source.Expr)).value (.int val)) :
    Stmt.eval (n+1) t c r (ret (Shapes.signedCast e)).value=pure (.returned r [.int val]) := by
  have E : Expr.evalReturnValue c r (Shapes.signedCast e).value=pure (.int val,r) := H _ (by omega)
  have list : Expr.evalReturnList c r [(Shapes.signedCast e).value]=pure ([.int val],r) := by
    change Expr.evalReturnListFuel (_+1+1) c r [(Shapes.signedCast e).value]=_
    simp only [Expr.evalReturnListFuel,E,Inv08.Authority.bindPure]
  change Stmt.eval (n+1) t c r (.returnValues [(Shapes.signedCast e).value])=_
  rw [Stmt.eval];dsimp only;rw [list];rfl
theorem limitedOK {c r l m a b} (n : Nat) (t : FunctionTable) (msg : String)
    (L : Inv40.Reads c r (l : Pattern Source.Expr).value a) (M : Inv40.Reads c r (m : Pattern Source.Expr).value b)
    (A : a<R) (B : b<R) (safe : a≤b) : Stmt.eval (n+1) t c r (limited l m msg).value=pure (.normal r) := by
  apply MulDiv.guardYes n t
  apply Inv08.ReleaseQuote.binary L M .le (by intro h;cases h) (by intro h;cases h)
  change Source.BinaryOp.apply false .le (.word a) (.word b) = _
  rw [Inv32WideGuards.leWord _ _ A B,if_pos safe]
theorem posGuardExec (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (addend u : Nat)
    (U : r.lookupLocal? "valueU"=some (.word u)) (A : r.lookupLocal? "addend"=some (.word addend))
    (bound : u+addend<Signed.H) : Stmt.eval (n+2) t c r posGuard.value=pure (.normal r) := by
  have fitU : u<R := by norm_num [Signed.H,R] at *;omega
  have fitA : addend<R := by norm_num [Signed.H,R] at *;omega
  let s0 := r.pushScope
  let s1 := s0.declareLocal "#operand272" (.word addend)
  let s2 := s1.declareLocal "#operand280" (.word (Signed.H-1))
  let s3 := s2.declareLocal "#operand281" (.word u)
  let s4 := s3.declareLocal "#operand282" (.word (Signed.H-1-u))
  have a := declareWord n t "#operand272" (MulDiv.wordVar c s0 "addend" _ fitA A)
  have b := declareWord n t "#operand280" (maxRead c s1)
  have f := declareWord n t "#operand281" (MulDiv.wordVar c s2 "valueU" _ fitU U)
  have mx : Signed.H-1<R := by decide
  have sub := subRead (MulDiv.wordVar c s3 "#operand280" _ mx rfl) (MulDiv.wordVar c s3 "#operand281" _ fitU rfl) mx fitU (by omega)
  have d := declareWord n t "#operand282" sub
  have lim := limitedOK n t "Scalar value addition exceeds int256 maximum" (MulDiv.wordVar c s4 "#operand272" _ fitA rfl)
    (MulDiv.wordVar c s4 "#operand282" _ (lt_of_le_of_lt (Nat.sub_le ..) mx) rfl)
    fitA (lt_of_le_of_lt (Nat.sub_le ..) mx) (by omega)
  change Stmt.eval (n+2) t c r (.block [_,_,_,_,_])=_
  rw [Stmt.eval];dsimp only
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ a,Inv32FloorStart.seqStep _ _ _ _ _ _ _ b,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ f,Inv32FloorStart.seqStep _ _ _ _ _ _ _ d,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ lim,Stmt.evalList]
  rfl
end Inv45.Add
