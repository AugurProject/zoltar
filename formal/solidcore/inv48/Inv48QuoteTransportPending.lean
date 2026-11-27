import Inv48QuoteTransportCore
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.EscrowPrefix
namespace Inv48.QuoteTransport
set_option maxRecDepth 65536
set_option maxHeartbeats 4000000

def storageSource (r : Runtime) : Expr → Bool
  | .storageRead _ _ _ => true
  | .var name => (r.lookupStorageBase? name).isSome
  | _ => false

theorem deepWordFrame (c : Context) (r next : Runtime) (name : String) (value : Nat)
    (sign : Bool) (success : r.storeStorageFieldWithDeepClear c name (.word value) sign = .ok next) :
    ∃ state, next = {r with state := state} := by
  unfold Runtime.storeStorageFieldWithDeepClear at success
  cases hf : c.storageField? name with
  | none => simp [hf,Bind.bind,Except.bind] at success
  | some field =>
    have material : r.storageMaterializedValue (.word value) = .ok (.word value) := by
      simp [Runtime.storageMaterializedValue,Runtime.derefMemoryValueDeep,Runtime.derefMemoryValueWithFuel]
    simp only [hf,material,Bind.bind,Except.bind] at success
    cases hl : field.layout? with
    | none =>
      simp only [hl] at success
      exact storeFrame c r next name (.word value) success
    | some layout =>
      cases layout <;> simp only [hl] at success
      all_goals exact storeFrame c r next name (.word value) success

theorem storageTree (n : Nat) (table : FunctionTable) (c : Context) (r : Runtime)
    (name : String) (expr : Expr) (v : Nat)
    (rhs : Expr.eval c r expr = pure (.word v,r)) :
    Stmt.eval (n+1) table c r (.assign (.storage name) expr) =
      match r.storeStorageFieldWithDeepClear c name (.word v) (!(storageSource r expr)) with
      | .ok next => pure (.normal next)
      | .error err => pure (.reverted r err) := by
  have resolve : (LValue.storage name).resolveWithRuntime c r = pure (.storageField name,r) := rfl
  rw [Stmt.eval]
  dsimp only
  simp only [LValue.wantsMemoryRefRhs,Bool.false_eq_true,if_false,rhs]
  change (match (if storageSource r expr then
      r.storeStorageFieldWithDeepClear c name (.word v) false
    else r.storeStorageFieldWithDeepClear c name (.word v) true) with
    | .ok next => (pure (.normal next) : SolI Result)
    | .error err => pure (.reverted r err)) = _
  cases storageSource r expr <;> rfl

/-- Invert the real successful assignment, including its evaluated store result. -/
theorem storageRecovered (n : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (name : String) (expr : Expr) (v : Nat) (trace : Interaction.Transcript)
    (rhs : Expr.eval c r expr = pure (.word v,r))
    (run : ExecutesOK (Stmt.eval (n+1) table c r (.assign (.storage name) expr)) trace (.normal next)) :
    ∃ state, next = {r with state := state} := by
  rw [storageTree n table c r name expr v rhs] at run
  cases store : r.storeStorageFieldWithDeepClear c name (.word v) (!(storageSource r expr)) with
  | error err => simp only [store] at run; cases run
  | ok updated =>
    simp only [store] at run
    cases run
    exact deepWordFrame c r _ name v _ store

theorem normalCons (fuel : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (stmt : Stmt) (stmts : List Stmt) (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.evalList fuel table c r (stmt::stmts)) trace (.normal next)) :
    ∃ mid first tail, trace = first ++ tail ∧
      ExecutesOK (Stmt.eval fuel table c r stmt) first (.normal mid) ∧
      ExecutesOK (Stmt.evalList fuel table c mid stmts) tail (.normal next) := by
  rw [Stmt.evalList] at run
  rcases Interaction.Executes.bind_cases run with bad | good
  · rcases bad with ⟨err,eq,_⟩
    cases eq
  · rcases good with ⟨result,first,tail,eq,head,rest⟩
    cases result with
    | normal mid => exact ⟨mid,first,tail,eq,head,rest⟩
    | returned _ _ => cases rest
    | constructorReturned _ _ => cases rest
    | reverted _ _ => cases rest
    | selfdestructed _ => cases rest
    | broke _ => cases rest
    | continued _ => cases rest

def pendingStatements : List Stmt := [
  .assign (.storage "pendingExposureLimitAttoEth") (.castOp .uintCleanup 256 (.index (.var "quote") (.word 3))),
  .assign (.storage "pendingReportMaxSettlementBaseFeeAttoEthPerGas") (.castOp .uintCleanup 256 (.index (.var "quote") (.word 4))),
  .assign (.storage "pendingReportSponsor") (.var "sponsor")]

theorem cleanField (c : Context) (r : Runtime) (id a b h e s i v : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (Inv48.QuoteMemory.tuple a b h e s))
    (hi : i<2^256) (hv : v<2^256)
    (item : listGet? [Value.word a,.word b,.word h,.word e,.word s] i = some (.word v)) :
    Expr.eval c r (.castOp .uintCleanup 256 (.index (.var "quote") (.word i))) = pure (.word v,r) := by
  apply Inv32Guards.clean _ _ _ _ _ hv
  exact Inv08.MemoryMember.fromMemory c r "quote" id i v _ ref mem hi item _ (by simp [Inv08.Integral.member,Expr.orderFuel])

/-- Recover the adopted state after all three real pending writes. The quote
pointer, full returned struct and caller frame are preserved by evaluated stores. -/
theorem pendingRecovered (n : Nat) (table : FunctionTable) (c : Context) (r next : Runtime)
    (id a p h e s sponsor : Nat) (trace : Interaction.Transcript)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (Inv48.QuoteMemory.tuple a (Inv48.QuoteExec.repAmount a p) h e s))
    (S : r.lookupLocal? "sponsor" = some (.word sponsor)) (he : e<2^256) (hs : s<2^256)
    (run : ExecutesOK (Stmt.evalList (n+1) table c r pendingStatements) trace (.normal next)) :
    (∃ state, next = {r with state := state}) ∧ Inv48.WholeQuote.HasFunding next id a p := by
  obtain ⟨r1,t1,tail1,_,step1,rest1⟩ := normalCons (n+1) table c r next _ _ trace run
  have write1 := storageRecovered n table c r r1 _ _ e t1
    (cleanField c r id a _ h e s 3 e ref mem (by decide) he rfl) step1
  obtain ⟨state1,rfl⟩ := write1
  obtain ⟨r2,t2,tail2,_,step2,rest2⟩ := normalCons (n+1) table c _ next _ _ tail1 rest1
  have write2 := storageRecovered n table c {r with state := state1} r2 _ _ s t2
    (cleanField c {r with state := state1} id a _ h e s 4 s ref mem (by decide) hs rfl) step2
  obtain ⟨state2,rfl⟩ := write2
  obtain ⟨r3,t3,tail3,_,step3,rest3⟩ := normalCons (n+1) table c _ next _ _ tail2 rest2
  have read : Expr.eval c {r with state := state2} (.var "sponsor") = pure (.word sponsor,{r with state := state2}) := by
    unfold Expr.eval
    exact Inv32Guards.readWord _ _ _ _ _ S
  have write3 := storageRecovered n table c _ r3 _ _ sponsor t3 read step3
  obtain ⟨state3,rfl⟩ := write3
  rw [Stmt.evalList] at rest3
  change ExecutesOK (pure (Result.normal {r with state := state3}) : SolI Result) tail3 (.normal next) at rest3
  cases rest3
  exact ⟨⟨state3,rfl⟩,ref,h,e,s,mem⟩

end Inv48.QuoteTransport
