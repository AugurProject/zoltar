import Inv48QuoteMemoryGuards
import Inv32Eval
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace Inv48.QuoteRangeFromSuccess
open Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 8000000

theorem leFailure (checked : Bool) (a b : Nat) (ha : a<R) (hb : b<R) (lt : b<a) :
    BinaryOp.apply checked .le (.word a) (.word b) = .ok (.word 0) := by
  have val (v : Nat) (h : v<R) : (SolidCore.Solidity.Shared.toEvmWord v).val.val = v := by
    change (v%R)%R = v
    simp [Nat.mod_eq_of_lt h]
  have cmp : SolidCore.Solidity.Shared.toEvmWord a > SolidCore.Solidity.Shared.toEvmWord b := by
    change (SolidCore.Solidity.Shared.toEvmWord b).val.val < (SolidCore.Solidity.Shared.toEvmWord a).val.val
    rw [val a ha,val b hb]
    exact lt
  simp [BinaryOp.apply,BinaryOp.applyWord,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
    SolidCore.Solidity.Shared.gtWord,SolidCore.Solidity.Shared.liftEvmBinary,
    EvmYul.UInt256.gt,cmp,Bind.bind,Except.bind]
  rfl

theorem upperFailure (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id i value bound : Nat) (values : List Value) (message : String)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (.tuple values))
    (item : listGet? values i = some (.word value))
    (hi : i<R) (hv : value<R) (hb : bound<R) (bad : bound<value) :
    Stmt.eval (n+1) t c r (upperGuard i bound message) =
      pure (.reverted r (.error message)) := by
  have read := Inv08.MemoryMember.clean
    (Inv08.MemoryMember.fromMemory c r "quote" id i value values ref mem hi item) hv
  have expr : Expr.eval c r (.binary .le (clean (field i)) (clean (.word bound))) = pure (.word 0,r) := by
    change Expr.evalFuel 8 c r (.binary .le (clean (field i)) (clean (.word bound))) = _
    apply Inv32Eval.binary 7 _ _ .le (by intro h; cases h) (by intro h; cases h) _ _ (.word value) (.word bound)
    · exact read _ (by simp [Inv08.Integral.member,Expr.orderFuel])
    · change Expr.evalFuel 7 c r (.castOp .uintCleanup 256 (.word bound)) = _
      apply Inv32Guards.clean 6 _ _ _ _ hb
      rw [Expr.evalFuel,show normWord bound = bound from Nat.mod_eq_of_lt hb]
    · exact leFailure c.checked value bound hv hb bad
  rw [upperGuard,Stmt.eval]
  change (Expr.eval c r (.binary .le (clean (field i)) (clean (.word bound)))).caught >>= _ = _
  rw [expr]
  rfl

theorem bountyFailure (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (v : Nat)
    (read : r.lookupLocal? "bountyAttoEth" = some (.word v)) (hv : v<R) (bad : 2^96-1<v) :
    Stmt.eval (n+1) t c r bountyGuard =
      pure (.reverted r (.error "Oracle settler reward exceeds uint96 maximum")) := by
  have expr : Expr.eval c r (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1)))) =
      pure (.word 0,r) := by
    change Expr.evalFuel 6 c r (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1)))) = _
    apply Inv32Eval.binary 5 c r .le (by intro h; cases h) (by intro h; cases h) _ _ (.word v) (.word (2^96-1))
    · exact Inv32Guards.clean 4 c r _ v hv (Inv32Guards.readWord 3 c r _ v read)
    · apply Inv32Guards.clean 4 c r _ (2^96-1) (by decide)
      rw [Expr.evalFuel]
      rfl
    · exact leFailure c.checked v (2^96-1) hv (by decide) bad
  rw [bountyGuard,Stmt.eval]
  change (Expr.eval c r (.binary .le (clean (.var "bountyAttoEth")) (clean (.word (2^96-1))))).caught >>= _ = _
  rw [expr]
  rfl

#print axioms upperFailure
#print axioms bountyFailure
end Inv48.QuoteRangeFromSuccess
