import Inv48MinimaOracle
open SolidCore.Solidity.Source
namespace Inv48.CloneRead
/-- Big-endian accumulator, exactly one base-256 step per byte. -/
def decode : List Nat → Nat
  | [] => 0
  | b :: bs => b * 256 ^ bs.length + decode bs

theorem decode_bound (bs : List Nat) (clean : ∀ b ∈ bs, b < 256) :
    decode bs < 256 ^ bs.length := by
  induction bs with
  | nil => simp [decode]
  | cons b bs ih =>
    have hb := clean b (by simp)
    have ht := ih (by intro x hx; exact clean x (by simp [hx]))
    simp only [decode, List.length_cons, pow_succ]
    nlinarith

theorem decode_append (a b : List Nat) :
    decode (a ++ b) = decode a * 256 ^ b.length + decode b := by
  induction a with
  | nil => simp [decode]
  | cons x xs ih => simp [decode, ih, pow_add]; ring

def forwarderPrefix : List Nat := [0x36,0x3d,0x3d,0x37,0x3d,0x3d,0x3d,0x36,0x3d,0x73]
def suffix : List Nat := [0x5a,0xf4,0x3d,0x82,0x80,0x3e,0x90,0x3d,0x91,0x60,0x2b,0x57,0xfd,0x5b,0xf3]
def runtimeCode (implementation universeBytes token : List Nat) :=
  forwarderPrefix ++ implementation ++ suffix ++ universeBytes ++ token

theorem canonical_length (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) (ht : token.length = 20) :
    (runtimeCode implementation universeBytes token).length = 45 + 51 := by
  simp [runtimeCode, forwarderPrefix, suffix, hi, hu, ht]

theorem length_guard (code : List Nat) :
    (code.length = 45 + 51) ↔ code.length = 96 := by rfl

theorem loop_bounds (i : Nat) (h : i < 51) :
    45 < 96 ∧ i < 96 - 45 ∧ 45 + i < 96 ∧ i + 1 ≤ 51 := by omega

theorem universe_bounds (universeBytes : List Nat) (hu : universeBytes.length = 31)
    (clean : ∀ b ∈ universeBytes, b < 256) : decode universeBytes < 2 ^ 248 := by
  have h := decode_bound universeBytes clean
  rw [hu] at h
  exact h

theorem token_bounds (token : List Nat) (ht : token.length = 20)
    (clean : ∀ b ∈ token, b < 256) : decode token < 2 ^ 160 := by
  have h := decode_bound token clean
  rw [ht] at h
  exact h

/-- The accumulator invariant: appending a byte multiplies by 256 and adds it. -/
theorem loop_step (seen : List Nat) (b : Nat) :
    decode (seen ++ [b]) = decode seen * 256 + b := by
  simpa [decode] using decode_append seen [b]

/-- Connects the decoded universeBytes, with no truncation, to the existing oracle encoder. -/
theorem oracle_argument (c : Context) (r : Runtime) (selector : Nat) (name : String)
    (universeBytes : List Nat) (hu : universeBytes.length = 31)
    (clean : ∀ b ∈ universeBytes, b < 256) (sel : selector < Inv32Division.R)
    (lookup : r.lookupLocal? name = some (.word (decode universeBytes))) :
    (Inv48.Minima.oracleData selector name).evalWithRuntimeByContext c r =
      .ok (.bytes (Inv12.wireBytes selector [decode universeBytes]), r) :=
  Inv48.Minima.oracleCalldata c r selector (decode universeBytes) name sel
    (universe_bounds universeBytes hu clean) lookup
theorem bitwise_step (acc b : Nat) (hb : b < 256) :
    (acc <<< 8) ||| b = acc * 256 + b := by
  rw [← Nat.shiftLeft_add_eq_or_of_lt (show b < 2^8 from hb), Nat.shiftLeft_eq]

theorem loop_invariant (bs : List Nat) (acc : Nat) :
    bs.foldl (fun a b => a * 256 + b) acc = acc * 256 ^ bs.length + decode bs := by
  induction bs generalizing acc with
  | nil => simp [decode]
  | cons b bs ih => simp [List.foldl, ih, decode, pow_succ]; ring

theorem canonical_payload (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) :
    (runtimeCode implementation universeBytes token).drop 45 = universeBytes ++ token := by
  simp [runtimeCode, forwarderPrefix, suffix, List.drop_append, hi]

theorem bitwise_loop (bs : List Nat) (acc : Nat) (clean : ∀ b ∈ bs, b < 256) :
    bs.foldl (fun a b => (a <<< 8) ||| b) acc = acc * 256 ^ bs.length + decode bs := by
  have eq : bs.foldl (fun a b => (a <<< 8) ||| b) acc =
      bs.foldl (fun a b => a * 256 + b) acc := by
    induction bs generalizing acc with
    | nil => rfl
    | cons b bs ih =>
      simp only [List.foldl_cons]
      rw [bitwise_step acc b (clean b (by simp))]
      exact ih _ (by intro x hx; exact clean x (by simp [hx]))
  rw [eq, loop_invariant]

theorem canonical_slices (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31) :
    ((runtimeCode implementation universeBytes token).drop 45).take 31 = universeBytes ∧
    ((runtimeCode implementation universeBytes token).drop 45).drop 31 = token := by
  rw [canonical_payload implementation universeBytes token hi]
  constructor
  · simp [← hu]
  · simp [hu]

theorem accumulator_fits (bs : List Nat) (size : bs.length ≤ 31)
    (clean : ∀ b ∈ bs, b < 256) : decode bs < 2 ^ 256 := by
  have h := decode_bound bs clean
  have le : 256 ^ bs.length ≤ 256 ^ 31 := Nat.pow_le_pow_right (by decide) size
  exact lt_trans (lt_of_lt_of_le h le) (by decide)

/-- Both loop results for every packed binding payload. The second fold starts at zero. -/
theorem both_decoding_loops (implementation universeBytes token : List Nat)
    (hi : implementation.length = 20) (hu : universeBytes.length = 31)
    (cu : ∀ b ∈ universeBytes, b < 256) (ct : ∀ b ∈ token, b < 256) :
    (((runtimeCode implementation universeBytes token).drop 45).take 31).foldl
      (fun a b => (a <<< 8) ||| b) 0 = decode universeBytes ∧
    (((runtimeCode implementation universeBytes token).drop 45).drop 31).foldl
      (fun a b => (a <<< 8) ||| b) 0 = decode token := by
  obtain ⟨a,b⟩ := canonical_slices implementation universeBytes token hi hu
  rw [a,b]
  constructor
  · simpa using bitwise_loop universeBytes 0 cu
  · simpa using bitwise_loop token 0 ct

#print axioms both_decoding_loops
#print axioms bitwise_loop
#print axioms canonical_slices
#print axioms accumulator_fits
#print axioms bitwise_step
#print axioms loop_invariant
#print axioms canonical_payload
#print axioms decode_bound
#print axioms decode_append
#print axioms canonical_length
#print axioms loop_step
#print axioms oracle_argument
end Inv48.CloneRead
