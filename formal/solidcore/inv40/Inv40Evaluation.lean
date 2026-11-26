import Inv40Thresholds
import Inv32CompareValues

open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv40

private theorem modWords (c : Bool) (a d : Nat) (ha : a < R) (hd : d < R) (pos : 0 < d) :
    Source.BinaryOp.apply c .mod (.word a) (.word d) = .ok (.word (a % d)) := by
  have norm : Shared.norm d = d := Nat.mod_eq_of_lt hd
  have word : Shared.modWord a d = a % d := by
    have nonzero : (Shared.toEvmWord d).val ≠ 0 := by
      intro h
      have hv := congrArg Fin.val h
      change (d%R)%R = 0 at hv
      simp [Nat.mod_eq_of_lt hd] at hv
      omega
    simp only [Shared.modWord, Shared.liftEvmBinary, EvmYul.UInt256.mod,
      beq_iff_eq, if_neg nonzero]
    change (((a%R)%R) % ((d%R)%R)) % R = _
    simp [Nat.mod_eq_of_lt ha,Nat.mod_eq_of_lt hd,Nat.mod_eq_of_lt (lt_trans (Nat.mod_lt a pos) hd)]
  simp [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,
    Source.BinaryOp.applyWord,checkedMod,norm,Nat.ne_of_gt pos,word,Bind.bind,Except.bind]

private theorem addWords (c : Bool) (a b : Nat) (fit : a+b < R) :
    Source.BinaryOp.apply c .add (.word a) (.word b) = .ok (.word (a+b)) := by
  have ha : a < R := by omega
  have hb : b < R := by omega
  have check : checkedAdd c a b = checkedAdd false a b := by
    simp [checkedAdd,show Shared.norm a = a from Nat.mod_eq_of_lt ha,
      show Shared.norm b = b from Nat.mod_eq_of_lt hb,show ¬wordModulus ≤ a+b from Nat.not_le.mpr fit]
  have plain := Inv32CompareValues.addWord a b ha hb
  rw [Nat.mod_eq_of_lt fit] at plain
  simpa [Source.BinaryOp.apply,Value.forceAbiLazy,Source.BinaryOp.preservesFixedBytesWidth,
    Source.BinaryOp.applyWord,check,Bind.bind,Except.bind] using plain

theorem fork_fits (s d : Nat) (hs : s<R) (hd : 0<d) : fork s d < R := by
  have h : s ≤ s*d := by simpa using Nat.mul_le_mul_left s (show 1 ≤ d from hd)
  exact lt_of_le_of_lt ((fork_le _ _ _ hd).mpr h) hs

/-- Evaluation above the interpreter's structural fuel bound, preserving the runtime. -/
def Reads (c : Context) (r : Runtime) (e : Source.Expr) (v : Nat) :=
  ∀ fuel, e.orderFuel ≤ fuel → Source.Expr.evalFuel fuel c r e = pure (.word v,r)

private def clean (e : Source.Expr) := Source.Expr.castOp .uintCleanup 256 e
private def twice (e : Source.Expr) := clean (clean e)

private theorem cleaned (h : Reads c r e v) (hv : v<R) : Reads c r (clean e) v := by
  intro fuel enough
  change e.orderFuel+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Guards.clean _ _ _ _ _ hv (h _ (by omega))

private theorem cleanedTwice (h : Reads c r e v) (hv : v<R) : Reads c r (twice e) v :=
  cleaned (cleaned h hv) hv

private theorem binaryRead (a : Reads c r x u) (b : Reads c r y v)
    (op : Source.BinaryOp) (ha : op ≠ .boolAnd) (ho : op ≠ .boolOr)
    (word : op.apply c.checked (.word u) (.word v) = .ok (.word w)) :
    Reads c r (.binary op x y) w := by
  intro fuel enough
  change x.orderFuel+y.orderFuel+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Eval.binary _ _ _ _ ha ho _ _ _ _ _ (a _ (by omega)) (b _ (by omega)) word

private theorem lit (v : Nat) (fit : v<R) : Reads c r (.word v) v := by
  intro fuel enough
  change 1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => rw [Source.Expr.evalFuel]; rw [show normWord v = v from Nat.mod_eq_of_lt fit]

private theorem localRead (h : r.lookupLocal? name = some (.word v)) : Reads c r (.var name) v := by
  intro fuel enough
  change 1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n => exact Inv32Guards.readWord _ _ _ _ _ h

private def quotient (x d : Source.Expr) := twice (.binary .div x d)
private def remainder (x d : Source.Expr) := twice (.binary .mod x d)
private def add (x y : Source.Expr) := twice (.binary .add x y)

private theorem quotientRead (xv : Reads c r x s) (dv : Reads c r den d)
    (hs : s<R) (hd : d<R) (pos : 0<d) : Reads c r (quotient x den) (s/d) :=
  cleanedTwice (binaryRead xv dv .div (by intro h; cases h) (by intro h; cases h)
    (Inv32Eval.divideWords _ _ _ hs hd pos)) (lt_of_le_of_lt (Nat.div_le_self s d) hs)

private theorem remainderRead (xv : Reads c r x s) (dv : Reads c r den d)
    (hs : s<R) (hd : d<R) (pos : 0<d) : Reads c r (remainder x den) (s%d) :=
  cleanedTwice (binaryRead xv dv .mod (by intro h; cases h) (by intro h; cases h)
    (modWords _ _ _ hs hd pos)) (lt_trans (Nat.mod_lt _ pos) hd)

private theorem addRead (a : Reads c r x u) (b : Reads c r y v) (fit : u+v<R) :
    Reads c r (add x y) (u+v) :=
  cleanedTwice (binaryRead a b .add (by intro h; cases h) (by intro h; cases h) (addWords _ _ _ fit)) fit

private def roundUp (m : Source.Expr) :=
  Source.Expr.ternary (.binary .eq m (.word 0)) (.word 0) (.word 1)

private theorem roundRead (h : Reads c r m v) (hv : v<R) :
    Reads c r (roundUp m) (if v=0 then 0 else 1) := by
  have eq := binaryRead h (lit 0 (by decide)) .eq (by intro h; cases h) (by intro h; cases h)
    (Inv32WideGuards.eqWord _ _ _ hv (by decide))
  intro fuel enough
  change (m.orderFuel+1+1)+1+1+1 ≤ fuel at enough
  cases fuel with
  | zero => omega
  | succ n =>
    have run := eq n (show m.orderFuel+1+1 ≤ n by omega)
    unfold roundUp
    rw [Source.Expr.evalFuel,run]
    by_cases z : v=0
    · simp only [if_pos z]
      exact lit 0 (by decide) n (show 1 ≤ n by omega)
    · simp only [if_neg z]
      exact lit 1 (by decide) n (show 1 ≤ n by omega)

def forkExpr :=
  let x := clean (.var "theoreticalSupplyAttoRep")
  let d := clean (.immutable "forkThresholdDivisor")
  add (quotient x d) (roundUp (remainder x d))

def halfExpr :=
  let x := clean (.var "forkThresholdAttoRep")
  add (quotient x (.word 2)) (remainder x (.word 2))

theorem forkRead (c : Context) (r : Runtime) (s d : Nat) (hs : s<R) (hd : d<R) (pos : 0<d)
    (supply : r.lookupLocal? "theoreticalSupplyAttoRep" = some (.word s))
    (divisor : r.loadImmutableField c "forkThresholdDivisor" = pure (.word d)) :
    Reads c r forkExpr (fork s d) := by
  have imm : Reads c r (.immutable "forkThresholdDivisor") d := by
    intro fuel enough
    change 1 ≤ fuel at enough
    cases fuel with
    | zero => omega
    | succ n => rw [Source.Expr.evalFuel,divisor]; rfl
  have x := cleaned (localRead (c:=c) supply) hs
  have den := cleaned imm hd
  exact addRead (quotientRead x den hs hd pos)
    (roundRead (remainderRead x den hs hd pos) (lt_trans (Nat.mod_lt s pos) hd)) (fork_fits _ _ hs pos)

theorem halfRead (c : Context) (r : Runtime) (t : Nat) (ht : t<R)
    (threshold : r.lookupLocal? "forkThresholdAttoRep" = some (.word t)) :
    Reads c r halfExpr (t/2+t%2) := by
  have x := cleaned (localRead (c:=c) threshold) ht
  exact addRead (quotientRead x (lit 2 (by decide)) ht (by decide) (by decide))
    (remainderRead x (lit 2 (by decide)) ht (by decide) (by decide)) (by omega)

end Inv40
