import Inv08AuthorityMemory
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.Authority
theorem literal (c : Context) (r : Runtime) (v : Nat) (fit : v<R) : Inv40.Reads c r (.word v) v := by
  intro n enough
  cases n with
  | zero => change 1≤0 at enough; omega
  | succ n => rw [Expr.evalFuel,show normWord v=v from Nat.mod_eq_of_lt fit]
theorem double {c : Context} {r : Runtime} {e : Source.Expr} {v : Nat}
    (x : Inv40.Reads c r e v) (fit : v<R) :
    Inv40.Reads c r (.castOp .uintCleanup 256 (.castOp .uintCleanup 256 e)) v :=
  ReleaseQuote.readClean (ReleaseQuote.readClean x fit) fit
theorem castBits {c : Context} {r : Runtime} {e : Source.Expr} {v : Nat}
    (x : Inv40.Reads c r e v) (bits : Nat) (pos : 0<bits) (width : bits≤256) (fit : v<2^bits) :
    Inv40.Reads c r (.castOp .uintCast bits e) v := by
  have bound : v<R := lt_of_lt_of_le fit (Nat.pow_le_pow_right (by decide) width)
  have casted : uintCast? bits (.word v) = .ok (.word v) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,pos,width,show Shared.norm v=v from Nat.mod_eq_of_lt bound,
      Nat.mod_eq_of_lt fit,Bind.bind,Except.bind]
  intro n enough
  change e.orderFuel+1≤n at enough
  cases n with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,x n (by omega)]
    simp only [bindPure]
    change (do let w ← liftM (uintCast? bits (.word v)); pure (w,r)) = _
    rw [casted]; rfl

theorem andTrue {c : Context} {r : Runtime} {a b : Source.Expr} (A : Inv40.Reads c r a 1) (B : Inv40.Reads c r b 1) :
    Inv40.Reads c r (.binary .boolAnd a b) 1 := by
  intro fuel enough
  change a.orderFuel + b.orderFuel + 1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32QuoteGuard.both n c r a b true true (A n (by omega)) (B n (by omega))
theorem yes {c : Context} {r : Runtime} {a b other : Source.Expr} {v : Nat} (A : Inv40.Reads c r a 1) (B : Inv40.Reads c r b v) :
    Inv40.Reads c r (.ternary a b other) v := by
  intro fuel enough
  change a.orderFuel+b.orderFuel+other.orderFuel+1≤fuel at enough
  cases fuel with
  | zero => omega
  | succ n =>
    rw [Expr.evalFuel,A _ (by omega)]
    exact B n (by omega)

theorem readIndexOK (c : Context) (r : Runtime) (code : List Nat) (i : Nat) (mem : MemoryCode r code)
    (size : code.length=65) (hi : i<20) (off : r.lookupLocal? "offset"=some (.word 45))
    (ix : r.lookupLocal? "#extindex"=some (.word i)) : Inv40.Reads c r indexOK.value 1 := by
  have iw : i<R := lt_trans hi (by decide)
  have O := ReleaseQuote.readClean (localReads c r _ _ off) (by decide : 45<R)
  have I := ReleaseQuote.readClean (localReads c r _ _ ix) iw
  have len := localSize c r code mem
  rw [size] at len
  have S := ReleaseQuote.readClean len (by decide : 65<R)
  have A := ReleaseQuote.binary O S .lt (by intro h; cases h) (by intro h; cases h)
    (Inv32QuoteExpr.lt _ 45 65 (by decide) (by decide))
  have diff := ReleaseQuote.binary S O .sub (by intro h; cases h) (by intro h; cases h)
    (Inv32QuoteExpr.subWord _ 65 45 (by decide) (by decide) (by decide))
  have B := ReleaseQuote.binary I (double diff (by decide)) .lt (by intro h; cases h) (by intro h; cases h)
    (Inv32QuoteExpr.lt _ i 20 iw (by decide))
  rw [if_pos hi] at B
  exact andTrue A B
theorem readNextWord (c : Context) (r : Runtime) (code : List Nat) (i : Nat) (mem : MemoryCode r code)
    (size : code.length=65) (hi : i<20) (off : r.lookupLocal? "offset"=some (.word 45))
    (ix : r.lookupLocal? "#extindex"=some (.word i)) (w : r.lookupLocal? "#extword"=some (.word (prefixWord code i))) :
    Inv40.Reads c r nextWord.value (prefixWord code (i+1)) := by
  let v := prefixWord code i
  let b := byteAt code i
  have finalFit := prefixWordBound code (i+1) (by omega)
  change v*256+b<R at finalFit
  have shfit : v*256<R := lt_of_le_of_lt (Nat.le_add_right _ _) finalFit
  have bytesFit := byteBound code i
  have read := double (castBits (readByte c r code i mem size hi off ix) 8 (by decide) (by decide) bytesFit)
    (lt_trans bytesFit (by decide))
  have selected := yes (other:=Source.Expr.word 0) (readIndexOK _ _ _ _ mem size hi off ix) read
  have shift := ReleaseQuote.binary (localReads c r _ _ w) (literal c r 8 (by decide)) .shl
    (by intro h; cases h) (by intro h; cases h) (shiftEight c.checked v shfit)
  exact ReleaseQuote.readClean (ReleaseQuote.binary (castBits shift 256 (by decide) (by decide) shfit) selected .bitOr
    (by intro h; cases h) (by intro h; cases h) (combine c.checked v b shfit bytesFit)) finalFit
end Inv08.Authority
