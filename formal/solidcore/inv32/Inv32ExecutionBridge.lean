import Inv32Source
import SolidCore.Solidity.Checked
import Mathlib.Data.BitVec
import Mathlib.Tactic.Ring
import Std.Tactic.BVDecide


namespace Inv32Newton
set_option maxRecDepth 32768
abbrev W := BitVec 256
def seed (d : W) : W := (3 * d) ^^^ 2
def iterate (d : W) : Nat → W
  | 0 => seed d
  | n+1 => let i := iterate d n; i * (2 - d*i)

theorem initial (d : W) (odd : d &&& 1 = 1) :
    ∃ k : W, 1 - d * seed d = 16 * k := by
  refine ⟨(1 - d * seed d) >>> 4, ?_⟩
  unfold seed
  unfold W at *
  bv_decide

theorem errorSquared (d : W) (n : Nat) :
    1 - d * iterate d (n+1) = (1 - d * iterate d n)^2 := by
  simp only [iterate]
  ring

theorem precision (d : W) (odd : d &&& 1 = 1) (n : Nat) :
    ∃ k : W, 1 - d * iterate d n = (16 : W)^(2^n) * k := by
  induction n with
  | zero => simpa [iterate] using initial d odd
  | succ n ih =>
    obtain ⟨k,h⟩ := ih
    refine ⟨k^2, ?_⟩
    rw [errorSquared, h, mul_pow, pow_succ (2 : Nat), pow_mul]

theorem inverse (d : W) (odd : d &&& 1 = 1) : d * iterate d 6 = 1 := by
  obtain ⟨k,h⟩ := precision d odd 6
  have vanishes : (16 : W)^(2^(6 : Nat) : Nat) = 0 := by decide
  rw [vanishes, zero_mul, sub_eq_zero] at h
  exact h.symm

open SolidCore.Solidity
private def isUpdate : Stmt → Bool
  | .expr (.assign (.ident "inverse") .mulAssign
      (.binary .sub (.literal (.number "2"))
        (.binary .mul (.ident "denominator") (.ident "inverse")))) => true
  | _ => false

private def fromSeed : List Stmt → Option Nat
  | [] => none
  | .varDecl [b] (some (.binary .bitXor (.binary .mul (.literal (.number "3"))
        (.ident "denominator")) (.literal (.number "2")))) :: rest =>
    if b.name != some "inverse" then none else
    match rest.dropWhile isUpdate with
    | [.expr (.assign (.ident "result") .assign
          (.binary .mul (.ident "low") (.ident "inverse"))),
       .returnValues (some (.ident "result"))] => some (rest.takeWhile isUpdate).length
    | _ => none
  | _ :: rest => fromSeed rest

def importedUpdates : Option Nat := do
  let [f] := Inv32Generated.importedContractDecl2.items.filterMap (fun
    | .function f => if f.name == some "mulDiv" && f.params.length == 3 then some f else none
    | _ => none) | none
  let some (.block [.unchecked (.block body)]) := f.body | none
  fromSeed body

theorem generatedInverse (d : W) (odd : d &&& 1 = 1) :
    importedUpdates.map (fun n => d * iterate d n) = some 1 := by
  have parsed : importedUpdates = some 6 := by rfl
  rw [parsed]
  exact congrArg some (inverse d odd)

/-- Removing the remainder gives an exact multiple of the denominator.
    After removing its power-of-two factor, modular multiplication by the
    recovered inverse returns the full quotient whenever it fits one word. -/
theorem recoverQuotient (product factor oddPart : Nat)
    (positive : 0 < factor)
    (odd : BitVec.ofNat 256 oddPart &&& 1 = 1)
    (fits : product / (oddPart * factor) < 2^256) :
    let denominator := oddPart * factor
    let reduced := (product - product % denominator) / factor
    ((BitVec.ofNat 256 reduced) * iterate (BitVec.ofNat 256 oddPart) 6).toNat
      = product / denominator := by
  dsimp only
  let q := product / (oddPart * factor)
  have h := Nat.div_add_mod product (oddPart * factor)
  have exactProduct : product - product % (oddPart * factor) = (q * oddPart) * factor := by
    rw [Nat.mul_assoc, Nat.mul_comm q]
    dsimp [q]
    omega
  rw [exactProduct, Nat.mul_div_cancel _ positive, BitVec.ofNat_mul, mul_assoc,
      inverse _ odd, mul_one, BitVec.toNat_ofNat, Nat.mod_eq_of_lt fits]

/-- With k low zero bits stripped, fold the high limb into the low limb.
    This also covers k = 0, where the wrapped multiplier is zero. -/
theorem joinShift (hi lo k : Nat) (hk : k ≤ 256) (hl : lo < 2^256) :
    ((2^(256-k) * hi) % 2^256 ||| lo / 2^k) =
      ((2^256 * hi + lo) / 2^k) % 2^256 := by
  have radix : 2^256 = 2^k * 2^(256-k) := by rw [← Nat.pow_add]; congr 1; omega
  have positive : 0 < 2^k := Nat.two_pow_pos k
  have small : lo / 2^k < 2^(256-k) := by
    apply (Nat.div_lt_iff_lt_mul positive).mpr
    rw [Nat.mul_comm, ← radix]
    exact hl
  have fits : lo / 2^k < 2^256 := lt_of_le_of_lt (Nat.div_le_self _ _) hl
  conv_rhs => rw [radix, Nat.mul_assoc, Nat.add_comm, Nat.add_mul_div_left _ _ positive,
    Nat.add_comm, Nat.two_pow_add_eq_or_of_lt small, ← radix, Nat.or_mod_two_pow,
    Nat.mod_eq_of_lt fits]

theorem lowbitOfOdd (o : W) (odd : o &&& 1 = 1) : o &&& (-o) = 1 := by
  unfold W at *
  bv_decide

theorem lowbitOfShift (o : W) (odd : o &&& 1 = 1) (k : Nat) :
    (o <<< k) &&& (-(o <<< k)) = (1 : W) <<< k := by
  rw [← BitVec.shiftLeft_neg, ← BitVec.shiftLeft_and_distrib, lowbitOfOdd o odd]

/-- Subtract a word-sized remainder from a two-word numerator exactly. -/
theorem subtractRemainder (p r : Nat) (hr : r < 2^256) (hp : r ≤ p) :
    let w := 2^256
    let hi := p / w
    let lo := p % w
    (hi - (if r > lo then 1 else 0)) * w + (lo + w - r) % w = p - r := by
  dsimp only
  have h := Nat.div_add_mod p (2^256)
  rw [Nat.mul_comm] at h
  have bound := Nat.mod_lt p (Nat.two_pow_pos 256)
  split
  · have small : p % 2^256 + 2^256 - r < 2^256 := by omega
    rw [Nat.mod_eq_of_lt small, Nat.sub_mul]
    omega
  · have small : p % 2^256 - r < 2^256 := by omega
    have hshift : p % 2^256 + 2^256 - r = (p % 2^256 - r) + 2^256 := by omega
    rw [hshift, Nat.add_mod_right, Nat.mod_eq_of_lt small]
    omega

end Inv32Newton

namespace Inv32Execution

open SolidCore.Solidity
abbrev W := BitVec 256
private theorem toEvm (a : W) : Shared.toEvmWord a.toNat = ⟨a.toFin⟩ := by
  apply congrArg EvmYul.UInt256.mk
  apply Fin.ext
  change (a.toNat % 2^256) % 2^256 = a.toNat
  simp [Nat.mod_eq_of_lt a.isLt]

private theorem fromEvm (a : Fin (2^256)) : Shared.ofEvmWord ⟨a⟩ = a.val := by
  exact Nat.mod_eq_of_lt a.isLt

theorem mul (a b : W) : Source.BinaryOp.applyWord false .mul a.toNat b.toNat =
    .ok (a*b).toNat := by
  change Except.ok (Shared.ofEvmWord (EvmYul.UInt256.mul (Shared.toEvmWord _) (Shared.toEvmWord _))) = _
  rw [toEvm, toEvm]
  exact congrArg Except.ok (fromEvm _)

theorem sub (a b : W) : Source.BinaryOp.applyWord false .sub a.toNat b.toNat =
    .ok (a-b).toNat := by
  change Except.ok (Shared.ofEvmWord (EvmYul.UInt256.sub (Shared.toEvmWord _) (Shared.toEvmWord _))) = _
  rw [toEvm, toEvm]
  exact congrArg Except.ok (fromEvm _)

theorem xorWord (a b : W) : Source.BinaryOp.applyWord false .bitXor a.toNat b.toNat =
    .ok (a ^^^ b).toNat := by
  change Except.ok (Shared.ofEvmWord (EvmYul.UInt256.xor (Shared.toEvmWord _) (Shared.toEvmWord _))) = _
  rw [toEvm, toEvm]
  rw [fromEvm]
  change Except.ok ((a.toNat ^^^ b.toNat) % 2^256) = _
  rw [Nat.mod_eq_of_lt (Nat.xor_lt_two_pow a.isLt b.isLt)]
  simp
def newtonStep (d i : Nat) : Except Source.RevertData Nat := do
  let prod ← Source.BinaryOp.applyWord false .mul d i
  let diff ← Source.BinaryOp.applyWord false .sub 2 prod
  Source.BinaryOp.applyWord false .mul i diff

theorem newtonStep_correct (d i : W) :
    newtonStep d.toNat i.toNat = .ok (i * (2 - d*i)).toNat := by
  unfold newtonStep
  rw [mul]
  change (do
    let diff ← Source.BinaryOp.applyWord false .sub (2 : W).toNat (d*i).toNat
    Source.BinaryOp.applyWord false .mul i.toNat diff) = _
  rw [sub]
  exact mul _ _

def inverseOps (d : Nat) : Nat → Except Source.RevertData Nat
  | 0 => do
    let triple ← Source.BinaryOp.applyWord false .mul 3 d
    Source.BinaryOp.applyWord false .bitXor triple 2
  | n + 1 => do newtonStep d (← inverseOps d n)

theorem inverseOps_correct (d : W) (n : Nat) :
    inverseOps d.toNat n = .ok (Inv32Newton.iterate d n).toNat := by
  induction n with
  | zero =>
    simp only [inverseOps, Inv32Newton.iterate, Inv32Newton.seed]
    change (do
      let triple ← Source.BinaryOp.applyWord false .mul (3 : W).toNat d.toNat
      Source.BinaryOp.applyWord false .bitXor triple (2 : W).toNat) = _
    rw [mul]
    exact xorWord _ _
  | succ n ih =>
    simp only [inverseOps, ih]
    exact newtonStep_correct _ _

theorem actualWordInverse (d : W) (odd : d &&& 1 = 1) :
    (do let i ← inverseOps d.toNat 6
        Source.BinaryOp.applyWord false .mul d.toNat i) = .ok 1 := by
  rw [inverseOps_correct]
  change Source.BinaryOp.applyWord false .mul d.toNat (Inv32Newton.iterate d 6).toNat = _
  rw [mul, Inv32Newton.inverse d odd]
  rfl

end Inv32Execution
