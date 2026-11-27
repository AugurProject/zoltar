import Inv45DivisionState
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.MulDiv
abbrev W := BitVec 256
theorem notRaw (w : W) : Shared.notWord w.toNat=(~~~w).toNat := by
  have H : w.toNat<R := w.isLt
  have positive : 0<R := by decide
  change Shared.subWord (R-1) w.toNat=_
  rw [Signed.subRaw _ _ (by decide) w.isLt,BitVec.toNat_not]
  have q : (R-1)+R-w.toNat=(R-1-w.toNat)+R := by omega
  rw [q,Nat.add_mod_right,Nat.mod_eq_of_lt (by exact lt_of_le_of_lt (Nat.sub_le _ _) (show R-1<R by omega))]
theorem readTwos (c : Context) (r : Runtime) (d : W) (un : c.checked=false)
    (D : r.lookupLocal? "denominator"=some (.word d.toNat)) :
    Inv40.Reads c r twos.value (d &&& -d).toNat := by
  have den := wordVar c r _ _ d.isLt D
  have not : Inv40.Reads c r (negBits (v "denominator")).value (~~~d).toNat :=
    Inv45.unary .bitNot den (by change Except.ok (Value.word (Shared.notWord d.toNat))=_;rw [notRaw])
  have neg := twiceReads (e:=negBits (v "denominator")) not (~~~d).isLt
  have add : Inv40.Reads c r (op BinaryOp_add (twice (negBits (v "denominator"))) one).value (-d).toNat := by
    apply Inv08.ReleaseQuote.binary neg (Inv08.Authority.literal c r 1 (by decide)) .add (by intro h;cases h) (by intro h;cases h)
    rw [un,BitVec.neg_eq_not_add];exact Inv32WideWords.addWord _ 1
  apply Inv08.ReleaseQuote.readClean _ (d &&& -d).isLt
  exact Inv08.ReleaseQuote.binary den (twiceReads add (-d).isLt) .bitAnd (by intro h;cases h) (by intro h;cases h)
    (by rw [un];exact Inv32WideWords.andWord d (-d))
theorem declareTwos (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (d : W) (un : c.checked=false)
    (D : r.lookupLocal? "denominator"=some (.word d.toNat)) :
    Stmt.eval (n+1) t c r (decl "twos" (Option_some twos)).value =
      pure (.normal (r.declareLocal "twos" (.word (d &&& -d).toNat))) := by
  have inVal : Expr.eval c r twos.value = pure (.word (d &&& -d).toNat,r) := readTwos c r d un D _ (by omega)
  change Stmt.eval (n+1) t c r (.varDecl .uint256 "twos" (some twos.value))=_
  rw [Stmt.eval];dsimp only;rw [inVal];rfl
theorem ternaryFalse {c r e yes no a} (X : Inv40.Reads c r (e : Pattern Source.Expr).value 0)
    (N : Inv40.Reads c r (no : Pattern Source.Expr).value a) :
    Inv40.Reads c r (Expr_ternary e (yes : Pattern Source.Expr) no).value a := by
  intro n enough;change e.value.orderFuel+yes.value.orderFuel+no.value.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.ternary e.value yes.value no.value)=_
    rw [Expr.evalFuel,X _ (by omega)];exact N _ (by omega)
theorem flip (c : Context) (r : Runtime) (tw : Nat) (T : tw<R) (pos : 0<tw) (un : c.checked=false)
    (toTwos : r.lookupLocal? "twos"=some (.word tw)) :
    let g := v "twos"
    let rhs := twice (op BinaryOp_add (Expr_ternary (equalZero g) zero (div (sub zero g) g)) one)
    Inv40.Reads c r rhs.value (((R-tw)/tw+1)%R) := by
  have G := wordVar c r _ _ T toTwos
  have Z : Inv40.Reads c r (equalZero (v "twos")).value 0 := by simpa only [if_neg (Nat.ne_of_gt pos)] using eqZero G T
  have S := diffRead (l:=zero) (Inv08.Authority.literal c r 0 (by decide)) G (by decide) T un
  have ne : R-tw<R := by omega
  rw [Nat.zero_add,Nat.mod_eq_of_lt ne] at S
  have D := divRead S G ne T pos
  have I := ternaryFalse (yes:=zero) Z D
  have next := Inv08.ReleaseQuote.binary I (Inv08.Authority.literal c r 1 (by decide)) .add
    (by intro h;cases h) (by intro h;cases h) (by rw [un];exact Inv32CompareValues.addWord _ _ (lt_of_le_of_lt (Nat.div_le_self _ _) ne) (by decide))
  exact twiceReads next (Nat.mod_lt _ (by decide))
end Inv45.MulDiv
