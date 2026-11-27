import Inv48QuoteMemoryOps
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def clean (e : Expr) := Expr.castOp .uintCleanup 256 e
def field (i : Nat) := Expr.index (.var "quote") (.word i)
def upperGuard (i bound : Nat) (message : String) : Stmt :=
  .requireStmt (.binary .le (clean (field i)) (clean (.word bound))) (some message)

theorem leSuccess (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (le : a≤b) :
    BinaryOp.apply checked .le (.word a) (.word b) = .ok (.word 1) := by
  have val (v : Nat) (h : v<R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have cmp : ¬ SolidCore.Solidity.Shared.toEvmWord a > SolidCore.Solidity.Shared.toEvmWord b := by
    change ¬ (SolidCore.Solidity.Shared.toEvmWord b).val.val < (SolidCore.Solidity.Shared.toEvmWord a).val.val
    rw [val a ha,val b hb]
    omega
  simp [BinaryOp.apply, BinaryOp.applyWord, Value.forceAbiLazy, BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.gtWord, SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.gt, cmp, Bind.bind, Except.bind]
  rfl

/-- Proves the actual upper-bound check from a tuple read and a numeric bound;
no successful-require premise is needed. -/
theorem upperPreserves (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id i value bound : Nat) (values : List Value) (message : String)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (.tuple values))
    (item : listGet? values i = some (.word value))
    (hi : i<R) (hb : bound<R) (le : value≤bound) :
    Stmt.eval (n+1) t c r (upperGuard i bound message) = pure (.normal r) := by
  have hv : value<R := lt_of_le_of_lt le hb
  have read := Inv08.MemoryMember.clean
    (Inv08.MemoryMember.fromMemory c r "quote" id i value values ref mem hi item) hv
  have expr : Expr.eval c r (.binary .le (clean (field i)) (clean (.word bound))) = pure (.word 1,r) := by
    change Expr.evalFuel 8 c r (.binary .le (clean (field i)) (clean (.word bound))) = _
    apply Inv32Eval.binary 7 _ _ .le (by intro h; cases h) (by intro h; cases h) _ _ (.word value) (.word bound)
    · exact read _ (by simp [Inv08.Integral.member,Expr.orderFuel])
    · change Expr.evalFuel 7 c r (.castOp .uintCleanup 256 (.word bound)) = _
      apply Inv32Guards.clean 6 _ _ _ _ hb
      rw [Expr.evalFuel,show normWord bound = bound from Nat.mod_eq_of_lt hb]
    · exact leSuccess c.checked value bound hv hb le
  exact requirePreserves n t c r _ message expr

def bountyGuard : Stmt := .requireStmt
  (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1))))
  (some "Oracle settler reward exceeds uint96 maximum")

theorem bountyPreserves (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat)
    (read : r.lookupLocal? "bountyAttoEth" = some (.word v)) (le : v≤2^96-1) :
    Stmt.eval (n+1) t c r bountyGuard = pure (.normal r) := by
  have hv : v<R := lt_of_le_of_lt le (by decide)
  have expr : Expr.eval c r (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1)))) =
      pure (.word 1,r) := by
    change Expr.evalFuel 6 c r (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1)))) = _
    apply Inv32Eval.binary 5 c r .le (by intro h; cases h) (by intro h; cases h) _ _ (.word v) (.word (2^96-1))
    · exact Inv32Guards.clean 4 c r _ v hv (Inv32Guards.readWord 3 c r _ v read)
    · apply Inv32Guards.clean 4 c r _ (2^96-1) (by decide)
      rw [Expr.evalFuel]
      rfl
    · exact leSuccess c.checked v (2^96-1) hv (by decide) le
  exact requirePreserves n t c r _ _ expr

def upperGuards : List Stmt := [
  upperGuard 0 (2^128-1) "WETH report exceeds uint128",
  upperGuard 1 (2^128-1) "REP report exceeds uint128",
  upperGuard 2 (2^128-1) "Oracle escalation halt amount exceeds uint128 maximum",
  bountyGuard]

theorem allUpperPreserve (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s bounty : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (read : r.lookupLocal? "bountyAttoEth" = some (.word bounty))
    (ha : a≤2^128-1) (hb : b≤2^128-1) (hh : h≤2^128-1) (hbounty : bounty≤2^96-1) :
    Stmt.evalList (n+1) t c r upperGuards = pure (.normal r) := by
  have g0 := upperPreserves n t c r id 0 a (2^128-1)
    [.word a,.word b,.word h,.word e,.word s] "WETH report exceeds uint128"
    ref mem rfl (by decide) (by decide) ha
  have g1 := upperPreserves n t c r id 1 b (2^128-1)
    [.word a,.word b,.word h,.word e,.word s] "REP report exceeds uint128"
    ref mem rfl (by decide) (by decide) hb
  have g2 := upperPreserves n t c r id 2 h (2^128-1)
    [.word a,.word b,.word h,.word e,.word s] "Oracle escalation halt amount exceeds uint128 maximum"
    ref mem rfl (by decide) (by decide) hh
  have g3 := bountyPreserves n t c r bounty read hbounty
  unfold upperGuards
  exact (Inv32FloorStart.seqStep _ _ _ _ _ _ _ g0).trans
    ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ g1).trans
      ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ g2).trans
        ((Inv32FloorStart.seqStep _ _ _ _ _ _ _ g3).trans (by rw [Stmt.evalList]))))

#print axioms bountyPreserves
#print axioms allUpperPreserve

#print axioms leSuccess
#print axioms upperPreserves
end Inv48.QuoteMemory
