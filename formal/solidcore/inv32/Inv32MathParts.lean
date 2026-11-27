import Inv32WideEntry
open Inv32Division
namespace Inv32WideMath
def productQuotient (x y d : Nat) :=
  let p := x*y
  let h := p/R
  let l := p%R
  let rem := p%d
  let carry : Nat := if l<rem then 1 else 0
  let h' := h-carry
  let l' := (l+R-rem)%R
  let m := (bv d &&& -(bv d)).toNat
  let flip := ((R-m)/m+1)%R
  let qd := d/m
  let ql := l'/m
  let merged := (bv ql ||| (bv h')*(bv flip))
  let inv := Inv32Newton.iterate (bv qd) 6
  (merged*inv).toNat

theorem fromDivide (p d : Nat) (hp : 0<d) (hd : d<R) (wide : 0<p/R) (fits : p/R<d) :
    let h := p/R
    let l := p%R
    let rem := p%d
    let hi := h-(if l<rem then 1 else 0)
    let lo := (l+R-rem)%R
    let tw := (bv d &&& -(bv d)).toNat
    let flip := ((R-tw)/tw+1)%R
    (bv (lo/tw ||| (hi*flip)%R) * Inv32Newton.iterate (bv (d/tw)) 6).toNat = p/d := by
  have quotBound : p/d<R := (Nat.div_lt_iff_lt_mul hp).mpr (by
    rw [Nat.mul_comm]; exact (Nat.div_lt_iff_lt_mul (Nat.two_pow_pos 256)).mp fits)
  have cert : divideLimbs p d = _ := divideLimbs_correct p d hd
  simp only [if_neg (not_or_intro (Nat.ne_of_gt hp) (Nat.not_le_of_gt quotBound))] at cert
  have highPos : p/R ≠ 0 := Nat.ne_of_gt wide
  have fitsHigh : ¬ d ≤ p/R := Nat.not_le_of_gt fits
  unfold divideLimbs at cert
  dsimp only at cert
  simp only [Nat.ne_of_gt hp,highPos,fitsHigh,if_false] at cert
  exact Option.some.inj cert

theorem mergedWord (l h f : Nat) (hl : l<R) (hh : h<R) (hf : f<R) :
    bv l ||| bv h*bv f = bv (l ||| ((h*f)%R)) := by
  apply BitVec.eq_of_toNat_eq
  simp only [BitVec.toNat_or,BitVec.toNat_mul,BitVec.toNat_ofNat,Nat.mod_eq_of_lt hl,
    Nat.mod_eq_of_lt hh,Nat.mod_eq_of_lt hf,Nat.mod_eq_of_lt (Nat.or_lt_two_pow hl (Nat.mod_lt _ (Nat.two_pow_pos 256)))]
theorem result (x y d : Nat) (hd : d<R) (wide : 0<x*y/R) (fits : x*y/R<d) :
    productQuotient x y d = x*y/d := by
  let p := x*y
  let h := p/R
  let l := p%R
  let rem := p%d
  let carry : Nat := if l<rem then 1 else 0
  let h' := h-carry
  let l' := (l+R-rem)%R
  let m := (bv d &&& -(bv d)).toNat
  let flip := ((R-m)/m+1)%R
  let qd := d/m
  let ql := l'/m
  let merged := (bv ql ||| (bv h')*(bv flip))
  let inv := Inv32Newton.iterate (bv qd) 6
  have hp : 0<d := lt_trans wide fits
  have hr : h<R := lt_trans fits hd
  have lr : l<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have hr' : h'<R := lt_of_le_of_lt (Nat.sub_le _ _) hr
  have lr' : l'<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have flipR : flip<R := Nat.mod_lt _ (Nat.two_pow_pos 256)
  have eqn : merged = bv (ql ||| ((h'*flip)%R)) := mergedWord _ _ _
    (lt_of_le_of_lt (Nat.div_le_self _ _) lr') hr' flipR
  change (merged*inv).toNat = _
  exact (congrArg (fun w : BitVec 256 => (w*inv).toNat) eqn).trans (fromDivide p d hp hd wide fits)
end Inv32WideMath
