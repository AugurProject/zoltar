import Inv45DecimalActions
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division Inv32Shapes Inv03.Bodies
namespace Inv45.Decimal
theorem clean8 {c r e x} (E : Inv40.Reads c r (e : Pattern Source.Expr).value x) (small : x<256) :
    Inv40.Reads c r (c8 e).value x := by
  have fit : x<R := lt_trans small (by decide)
  have norm : Shared.norm x=x := Nat.mod_eq_of_lt fit
  have C : uintCleanup? c.checked 8 (.word x)=.ok (.word x) := by
    simp [uintCleanup?,uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Bind.bind,Except.bind,norm,small,Nat.mod_eq_of_lt small]
  intro n enough;change e.value.orderFuel+1≤n at enough;cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.castOp .uintCleanup 8 e.value)=_
    rw [Expr.evalFuel,E n (by omega)];simp only [Inv08.Authority.bindPure,C];rfl
theorem fixed {c r e x} (E : Inv40.Reads c r (e : Pattern Source.Expr).value x) (small : x<256) :
    Reads c r (digitCast e).value (.fixedBytes 1 x) := by
  have word : x<R := lt_trans small (by decide)
  have norm : Shared.norm x=x := Nat.mod_eq_of_lt word
  have byte : normByte x=x := Nat.mod_eq_of_lt small
  have operation : fixedBytesCast? 1 1 x=.ok (.fixedBytes 1 x) := by
    simp [fixedBytesCast?,wordBytes,bytesToWordBE,bytesPrefixRightPadded,wordToBytesBE,byte,norm]
  have expect : (Value.word x).expectWord=.ok x := congrArg (Except.ok (ε:=RevertData)) norm
  intro n enough;change e.value.orderFuel+1≤n at enough;cases n with
  | zero => omega
  | succ n =>
    change Expr.evalFuel (n+1) c r (.castOp (.fixedBytes 1) 1 e.value)=_
    rw [Expr.evalFuel,E n (by omega)];simp only [Inv08.Authority.bindPure,expect,operation,Inv08.Authority.liftPure]
theorem digitRead (c : Context) (r : Runtime) (n : Nat) (word : n<R) (N : r.lookupLocal? number=some (.word n)) :
    Reads c r encodedDigit.value (.fixedBytes 1 (48+n%10)) := by
  have q : n%10<10 := Nat.mod_lt _ (by decide)
  have fit : n%10<R := lt_trans q (by decide)
  have M : Source.BinaryOp.apply c.checked .mod (.word n) (.word 10)=.ok (.word (n%10)) := by
    have h := Inv32Rounding.remainder n 1 10 word (by decide) (by decide) (by decide)
    have raw : Shared.modWord n 10=n%10 := by
      unfold Shared.modWord Shared.liftEvmBinary
      rw [Signed.evm n word,Signed.evm 10 (by decide)]
      change (n%10)%R=n%10;exact Nat.mod_eq_of_lt fit
    simp [Source.BinaryOp.apply,Source.BinaryOp.applyWord,Source.BinaryOp.preservesFixedBytesWidth,
      Value.forceAbiLazy,checkedMod,Bind.bind,Except.bind,raw,show Shared.norm 10=10 from rfl]
  have rem := Inv08.ReleaseQuote.binary (MulDiv.wordVar c r _ n word N) (Inv08.Authority.literal c r 10 (by decide)) .mod
    (by intro h;cases h) (by intro h;cases h) M
  have rem' := MulDiv.twiceReads (e:=Expr_binary BinaryOp_mod (wvar number) (num 10)) rem fit
  have rr := MulDiv.twiceReads rem' fit
  have rhs := Inv08.Authority.castBits rr 8 (by decide) (by decide) (by change n%10<256;omega)
  have lhs := Inv08.Authority.castBits (Inv08.Authority.literal c r 48 (by decide)) 8 (by decide) (by decide) (by decide)
  have sum := Inv08.ReleaseQuote.binary lhs rhs .add (by intro h;cases h) (by intro h;cases h)
    (Inv40.addWords _ _ _ (lt_of_lt_of_le (by omega : 48+n%10<58) (by decide)))
  have sum8 : 48+n%10<256 := by omega
  apply fixed _ sum8
  exact Inv08.Authority.castBits (clean8 (clean8 sum sum8) sum8) 8 (by decide) (by decide) sum8
end Inv45.Decimal
