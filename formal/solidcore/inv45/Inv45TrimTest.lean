import Inv45PadCall
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Trim
open Bytes
def prior := MulDiv.sub (wvar "trimIndex") (num 1)
def endByte := index (varP "fractionalBytes") prior
def positive := Expr_binary BinaryOp_gt (wvar "trimIndex") (num 0)
def zeroByte := Expr_binary BinaryOp_eq endByte (num 48)
def test := Inv08.Authority.both positive zeroByte
def work := block [Decimal.adjust false "trimIndex"]
def loop := Stmt_whileLoop test work
def prefixCopy := Bytes.loop (wvar "trimIndex") (store "trimmed" (varP "index") (index (varP "fractionalBytes") (varP "index")))
theorem positiveRead {c r count} (ptr : r.lookupLocal? "trimIndex"=some (.word count)) (word : count<R) :
    Inv40.Reads c r positive.value (if 0<count then 1 else 0) :=
  Inv08.ReleaseQuote.binary (MulDiv.wordVar c r _ _ word ptr) (Inv08.Authority.literal _ _ 0 (by decide))
    .gt (by intro h;cases h) (by intro h;cases h) (Inv32QuoteExpr.gt _ _ _ word (by decide))
theorem finished {c r} (ptr : r.lookupLocal? "trimIndex"=some (.word 0)) : Inv40.Reads c r test.value 0 := by
  have lhs := positiveRead (c:=c) ptr (by decide)
  intro fuel enough
  have space : positive.value.orderFuel+zeroByte.value.orderFuel+1≤fuel := enough
  cases fuel with
  | zero => omega
  | succ fuel =>
    change Expr.evalFuel (fuel+1) c r (.binary .boolAnd positive.value zeroByte.value)=_
    rw [Expr.evalFuel,lhs fuel (by omega)];rfl
theorem testAt {c r src xs count byte} (ptr : r.lookupLocal? "trimIndex"=some (.word (count+1)))
    (fit : count+1<R) (buf : Ref r "fractionalBytes" src xs) (sane : ∀v∈xs,v<256) (here : xs[count]?=some byte) :
    Inv40.Reads c r test.value (if byte=48 then 1 else 0) := by
  have left := positiveRead (c:=c) ptr fit
  rw [if_pos (by omega)] at left
  have prev : Inv40.Reads c r prior.value count := by
    have h := Add.subRead (l:=wvar "trimIndex") (m:=num 1) (MulDiv.wordVar c r _ _ fit ptr)
      (Inv08.Authority.literal c r 1 (by decide)) fit (by decide) (by omega)
    simpa only [Nat.add_sub_cancel] using h
  have inside : byte∈xs := List.mem_of_getElem? here
  have byteWord : byte<R := lt_trans (sane byte inside) (by decide)
  intro fuel enough
  have room : positive.value.orderFuel+zeroByte.value.orderFuel+1≤fuel := enough
  obtain ⟨f,rfl⟩ := Nat.exists_eq_add_of_le (le_trans (by decide : 2≤test.value.orderFuel) enough)
  rw [Nat.add_comm]
  change Expr.evalFuel (f+1+1) c r (.binary .boolAnd positive.value zeroByte.value)=_
  rw [Expr.evalFuel,left _ (by omega)];simp only [Inv08.Authority.bindPure]
  change (do let (v,z) ← Expr.evalFuel (f+1) c r zeroByte.value
             let w ← liftM v.expectWord
             pure (Value.word (boolWord (wordTruthy w)),z))=_
  have room' : prior.value.orderFuel+4≤f := by
    have ord : prior.value.orderFuel+6≤positive.value.orderFuel+zeroByte.value.orderFuel+1 := by decide
    omega
  have ix := indexedEval (f-(prior.value.orderFuel+4)) buf (by omega) prev sane here
  rw [show f-(prior.value.orderFuel+4)+prior.value.orderFuel+4=f by omega] at ix
  have sz : (num 48).value.orderFuel≤f := by change 1≤f;omega
  have eq := Inv32Eval.binary f c r .eq (by intro h;cases h) (by intro h;cases h) _ _ _ _ _
    ix (Inv08.Authority.literal c r 48 (by decide) f sz) (Inv32WideGuards.eqWord _ _ _ byteWord (by decide))
  change Expr.evalFuel (f+1) c r zeroByte.value=_ at eq
  rw [eq];by_cases h : byte=48 <;> simp only [h,if_true,if_false] <;> rfl
end Inv45.Trim
