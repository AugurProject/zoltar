import Inv48QuoteMemoryCore
import Inv32QuoteGuard
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (v : α) (f : α → SolI β) : (pure v >>= f) = f v := rfl

theorem readClean (c : Context) (r : Runtime) (name : String) (v : Nat)
    (fit : v<R) (read : r.lookupLocal? name = some (.word v)) :
    Expr.eval c r (.castOp .uintCleanup 256 (.var name)) = pure (.word v,r) :=
  Inv32Guards.clean _ _ _ _ _ fit (Inv32Guards.readWord _ _ _ _ _ read)

theorem readHoist (c : Context) (r : Runtime) (v : Nat)
    (fit : v<R) (read : r.lookupLocal? "_sol_hoist_0" = some (.word v)) :
    Expr.eval c r (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0"))) = pure (.word v,r) := by
  change Expr.evalFuel 4 c r (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0"))) = _
  apply Inv32Guards.clean 3 _ _ _ _ fit
  rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ read]
  have fit' : v<115792089237316195423570985008687907853269984665640564039457584007913129639936 := fit
  have cast : uintCast? 256 (.word v) = .ok (.word v) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,Bind.bind,Except.bind,
      SolidCore.Solidity.Shared.norm,SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,
      Nat.mod_eq_of_lt fit']
  simp only [pb,cast]
  rfl

theorem collateral (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (fit : v<R) (read : r.lookupLocal? "requestedInitialAttoWeth" = some (.word v)) :
    Stmt.eval (n+1) t c r
      (.assign (.index (.var "quote") (.word 0))
        (.castOp .uintCleanup 256 (.var "requestedInitialAttoWeth"))) =
      pure (.normal (put r id v b h e s)) :=
  assign n t c r _ id 0 v _ _ _ ref (by decide) (readClean c r _ v fit read)
    (write0 c r id a b h e s v mem)

theorem rep (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (fit : v<R) (read : r.lookupLocal? "_sol_hoist_0" = some (.word v)) :
    Stmt.eval (n+1) t c r
      (.assign (.index (.var "quote") (.word 1))
        (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0")))) =
      pure (.normal (put r id a v h e s)) :=
  assign n t c r _ id 1 v _ _ _ ref (by decide) (readHoist c r v fit read)
    (write1 c r id a b h e s v mem)

theorem halt (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (fit : v<R) (read : r.lookupLocal? "_sol_hoist_0" = some (.word v)) :
    Stmt.eval (n+1) t c r
      (.assign (.index (.var "quote") (.word 2))
        (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0")))) =
      pure (.normal (put r id a b v e s)) :=
  assign n t c r _ id 2 v _ _ _ ref (by decide) (readHoist c r v fit read)
    (write2 c r id a b h e s v mem)

theorem settlement (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (fit : v<R) (read : r.lookupLocal? "_sol_hoist_0" = some (.word v)) :
    Stmt.eval (n+1) t c r
      (.assign (.index (.var "quote") (.word 4))
        (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0")))) =
      pure (.normal (put r id a b h e v)) :=
  assign n t c r _ id 4 v _ _ _ ref (by decide) (readHoist c r v fit read)
    (write4 c r id a b h e s v mem)

/-- exposureLimit's scalar arithmetic is deliberately isolated from the memory store. -/
theorem exposure (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat) (rhs : Expr)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (scalar : Expr.eval c r (.castOp .uintCleanup 256 rhs) = pure (.word v,r)) :
    Stmt.eval (n+1) t c r
      (.assign (.index (.var "quote") (.word 3)) (.castOp .uintCleanup 256 rhs)) =
      pure (.normal (put r id a b h v s)) :=
  assign n t c r _ id 3 v _ _ _ ref (by decide) scalar
    (write3 c r id a b h e s v mem)

/-- A successful require preserves the entire runtime, hence both funding fields. -/
theorem requirePreserves (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (cond : Expr) (message : String)
    (scalar : Expr.eval c r cond = pure (.word 1,r)) :
    Stmt.eval (n+1) t c r (.requireStmt cond (some message)) = pure (.normal r) :=
  Inv32QuoteGuard.requireEval n t c r cond true message scalar

/-- The named memory-struct return retains its pointer; internal calls do not
silently copy it to a stale pre-write tuple. -/
theorem collectQuote (r : Runtime) (id : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) :
    collectReturnBindingsRef [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩] r =
      .ok [.memoryRef id] := by
  simp [collectReturnBindingsRef,collectReturnBindingsRef.collect,ref,Bind.bind,Except.bind]

theorem finishQuote (fn : InternalFunction) (r : Runtime) (saved : LocalEnv)
    (targets : List String) (id : Nat)
    (returns : fn.returns = [⟨"quote",.tuple [.uint256,.uint256,.uint256,.uint256,.uint256],false⟩])
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) :
    internalCallFinish fn targets saved (.normal r) =
      internalCallAssign {r with locals := saved} targets [.memoryRef id] := by
  simp only [internalCallFinish,returns,collectQuote r id ref]

/-- Conditional halt replacement changes only quote[2], on either branch. -/
theorem haltUpdate (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (id a b h e s v : Nat) (cond : Expr) (take : Bool)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (fit : v<R) (read : r.lookupLocal? "exposureEscalationHaltAttoEth" = some (.word v))
    (scalar : Expr.eval c r cond = pure (.word (boolWord take),r)) :
    Stmt.eval (n+2) t c r
      (.ifElse cond (.assign (.index (.var "quote") (.word 2))
        (.castOp .uintCleanup 256 (.var "exposureEscalationHaltAttoEth"))) .skip) =
      pure (.normal (if take then put r id a b v e s else r)) := by
  have store := assign n t c r _ id 2 v .uintCleanup 256 (.var "exposureEscalationHaltAttoEth")
    ref (by decide) (readClean c r _ v fit read) (write2 c r id a b h e s v mem)
  rw [Stmt.eval]
  dsimp only
  rw [scalar]
  cases take
  · change Stmt.eval (n+1) t c r .skip = _
    rw [Stmt.eval]
    rfl
  · exact store

/-- Reading the returned memory pointer sees the post-write five-field struct. -/
theorem quoteValue (c : Context) (r : Runtime) (id a b h e s : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    Expr.eval c r (.var "quote") = pure (tuple a b h e s,r) := by
  have noBase : r.lookupStorageBase? "quote" = none := by simp [Runtime.lookupStorageBase?,ref]
  simp [Expr.eval,Expr.evalFuel,noBase,ref,Runtime.derefMemoryValue,mem]
  rfl

theorem returnedFundingFields (c : Context) (r : Runtime) (id a b h e s : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s)) :
    Expr.eval c r (.index (.var "quote") (.word 0)) = pure (.word a,r) ∧
    Expr.eval c r (.index (.var "quote") (.word 1)) = pure (.word b,r) := by
  constructor
  · exact Inv08.MemoryMember.fromMemory c r "quote" id 0 a
      [.word a,.word b,.word h,.word e,.word s] ref mem (by decide) rfl _ (by decide)
  · exact Inv08.MemoryMember.fromMemory c r "quote" id 1 b
      [.word a,.word b,.word h,.word e,.word s] ref mem (by decide) rfl _ (by decide)

#print axioms quoteValue
#print axioms returnedFundingFields

#print axioms haltUpdate

#print axioms collateral
#print axioms rep
#print axioms halt
#print axioms exposure
#print axioms settlement
#print axioms requirePreserves
#print axioms collectQuote
#print axioms finishQuote
end Inv48.QuoteMemory
