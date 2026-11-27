import Inv48EscrowTrace
import Inv32QuoteGuard
import Inv32Assign
open SolidCore.Solidity.Source
namespace Inv48.EscrowTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl

 theorem encodeFold (c : Context) (r : Runtime) (payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (hp : payer < 2^160) (he : escrow < 2^160) (ha : amount < 2^256) :
    calldataExpr.evalWithRuntimeByContext c r = .ok (.bytes (calldata payer escrow amount),r) := by
  unfold Expr.evalWithRuntimeByContext
  rw [encodeExecution c r payer escrow amount P E A hp he ha]
  rfl

def transferResult (rep payer escrow amount : Nat) (output : List Byte) : LowLevelCallResult :=
  {kind := .call, target := rep, calldata := calldata payer escrow amount, value := 0, gas? := none, success := true, output := output}

def recorded (r : Runtime) (s : State) (rep payer escrow amount : Nat) (output : List Byte) :=
  ({r with state := s}).recordExternalInteraction
    (.lowLevelCall (transferResult rep payer escrow amount output))

private theorem scalarVar (fuel : Nat) (t : FunctionTable) (c : Context) (r next : Runtime)
    (name source : String) (old v : Nat)
    (bound : r.lookupLocal? name = some (.word old))
    (read : r.lookupLocal? source = some (.word v))
    (store : r.assignLocal? name (.word v) = some next) :
    Stmt.eval (fuel+1) t c r (.assign (.var name) (.var source)) = pure (.normal next) := by
  have notMem : (LValue.var name).wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs, Runtime.lookupMemoryRef?, bound]
  have noMem : r.lookupMemoryRef? name = none := by simp [Runtime.lookupMemoryRef?,bound]
  have rhs : Expr.eval c r (.var source) = pure (.word v,r) := Inv32Guards.readWord _ _ _ _ _ read
  rw [Stmt.eval]
  dsimp only
  have noStorage : r.lookupStorageBase? source = none := by simp [Runtime.lookupStorageBase?,read]
  rw [noMem,notMem,noStorage]
  simp only [Bool.false_eq_true,if_false,rhs]
  change (do
    match ← ((LValue.var name).resolveWithRuntime c r).caught with
    | .ok (target,r') => match target.write c r' (.word v) with
      | .ok updated => pure (Result.normal updated)
      | .error err => pure (Result.reverted r err)
    | .error err => pure (Result.reverted r err)) = _
  rw [Inv32Writes.resolve c r name old bound]
  have stored : (ResolvedLValue.local name).write c r (.word v) = .ok next := by simp [ResolvedLValue.write,store]
  change (match (ResolvedLValue.local name).write c r (.word v) with
    | .ok updated => (pure (Result.normal updated) : SolI Result)
    | .error err => pure (Result.reverted r err)) = _
  rw [stored]

 theorem pureDispatchTransferExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (s : State) (rep payer escrow amount old : Nat) (output : List Byte) (bit : Bool)
    (updated : Runtime)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (B : r.lookupLocal? "_sol_hoist_0" = some (.word old))
    (hp : payer < 2^160) (he : escrow < 2^160) (ha : amount < 2^256)
    (hr : rep < 2^256)
    (notConstruction : c.construction = false)
    (call : selfDispatchCall c r.state .call rep (calldata payer escrow amount) 0 none =
      pure (transferResult rep payer escrow amount output,s))
    (decoded : abiDecodeValuesExcept? [.bool] (output.map normByte) = .ok [.word (boolWord bit)])
    (assigned : ((recorded r s rep payer escrow amount output).withFrame
      [("__ext0",.word (boolWord bit))]).assignLocal? "_sol_hoist_0" (.word (boolWord bit)) = some updated) :
    Stmt.eval (n+2) t c r transferStmt = pure (.normal updated.popScope) := by
  have read : (.var "rep" : Expr).evalWithRuntimeByContext c r = .ok (.word rep,r) := by
    unfold Expr.evalWithRuntimeByContext Expr.eval
    rw [Inv32Guards.readWord _ _ _ _ _ R]
    rfl
  have enc := encodeFold c r payer escrow amount P E A hp he ha
  have zero : (.word 0 : Expr).evalWithRuntimeByContext c r = .ok (.word 0,r) := rfl
  unfold transferStmt
  rw [Stmt.eval]
  simp only [read,Value.expectWord,zero,enc,Value.asBytes?,notConstruction,
    Bool.and_false,Bool.false_and,Bool.or_false,Bool.false_eq_true,if_false]
  have nr : SolidCore.Solidity.Shared.norm rep = rep := Nat.mod_eq_of_lt hr
  have nb (v : Nat) : normByte (normByte v) = normByte v := by
    simp [normByte,SolidCore.Solidity.Shared.Account.byte]
  have wb (n v : Nat) : (wordToBytesBE n v).map normByte = wordToBytesBE n v := by
    induction n generalizing v with
    | zero => rfl
    | succ n ih => simp [wordToBytesBE,List.map_append,ih,nb]
  have nc : (calldata payer escrow amount).map normByte = calldata payer escrow amount := by
    simp [calldata,Inv48.Escrow.payload,List.map_append,List.flatMap_cons,List.flatMap_nil,wb]
  rw [nr,nc]
  change (do let result ← selfDispatchCall c r.state .call rep (calldata payer escrow amount) 0 none
             _) = _
  rw [call]
  simp only [pb,transferResult,if_true,List.map_cons,List.map_nil]
  rw [decoded]
  dsimp only
  have clean : AbiCleanups.acceptOrUnspecified [.none] [.word (boolWord bit)] = true := by simp [AbiCleanups.acceptOrUnspecified,AbiCleanups.accept,AbiCleanup.accepts]
  have binding : BindingDecl.bindArgs? [⟨"__ext0",.bool,false⟩] [.word (boolWord bit)] =
      some [("__ext0",.word (boolWord bit))] := by
    cases bit <;> simp [BindingDecl.bindArgs?,BindingDecl.bindArg?,Ty.coerceValue?,boolWord,
      Bind.bind,Option.bind,SolidCore.Solidity.Shared.norm,
      SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,wordEq]
  rw [clean,binding]
  simp only [if_true]
  let work := (recorded r s rep payer escrow amount output).withFrame [("__ext0",.word (boolWord bit))]
  have bound : work.lookupLocal? "_sol_hoist_0" = some (.word old) := by
    simpa [work,recorded,Runtime.withFrame,Runtime.recordExternalInteraction,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?] using B
  have source : work.lookupLocal? "__ext0" = some (.word (boolWord bit)) := rfl
  have write := scalarVar n t c work updated "_sol_hoist_0" "__ext0" old (boolWord bit) bound source assigned
  change (do let result ← Stmt.eval (n+1) t c work (.assign (.var "_sol_hoist_0") (.var "__ext0"))
             pure (result.mapRuntime Runtime.popScope)) = _
  rw [write]
  rfl

theorem recordedInteraction (r : Runtime) (s : State) (rep payer escrow amount : Nat) (output : List Byte) :
    (recorded r s rep payer escrow amount output).state.externalInteractions =
      s.externalInteractions ++ [.lowLevelCall (transferResult rep payer escrow amount output)] := rfl

theorem recordedLocal (r : Runtime) (s : State) (rep payer escrow amount : Nat) (output : List Byte) (name : String) :
    (recorded r s rep payer escrow amount output).lookupLocal? name = r.lookupLocal? name := rfl

theorem guardExecution (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime) (bit : Bool)
    (B : r.lookupLocal? "_sol_hoist_0" = some (.word (boolWord bit))) :
    Stmt.eval (n+1) t c r guardStmt =
      pure (if bit then .normal r else .reverted r (.error "REP transfer for initial report failed")) := by
  exact Inv32QuoteGuard.requireEval n t c r _ bit _ (Inv32Guards.readWord _ _ _ _ _ B)

theorem guardSuccessful (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime) (bit : Bool)
    (B : r.lookupLocal? "_sol_hoist_0" = some (.word (boolWord bit)))
    (success : Stmt.eval (n+1) t c r guardStmt = pure (.normal final)) : bit = true := by
  rw [guardExecution n t c r bit B] at success
  cases bit
  · cases success
  · rfl

/-- A framed internal return with no assignment targets restores all caller locals.
    This is a finish-boundary lemma, not an inversion of the preceding call. -/
theorem internalReturnLocals (fn : InternalFunction) (saved : LocalEnv) (r : Runtime)
    (values coerced : List Value)
    (coercion : (if values.isEmpty then collectReturnBindingsRef fn.returns r
      else coerceReturnBindingsRef fn.returns r values) = .ok coerced) :
    internalCallFinish fn [] saved (.returned r values) = pure (.normal {r with locals := saved}) := by
  unfold internalCallFinish
  dsimp only
  rw [coercion]
  rfl

#print axioms encodeFold
#print axioms guardExecution
#print axioms guardSuccessful
#print axioms recordedInteraction
#print axioms internalReturnLocals
#print axioms pureDispatchTransferExecution
end Inv48.EscrowTrace
