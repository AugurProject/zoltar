import Inv48EscrowJoinCreate
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowJoin
open Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

/-- Assignment inversion includes the actual creation expression and its saved
    caller locals. The assigned address is selected by the actual response. -/
theorem creationAssignment (n : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (sponsor oracle collateral rep gas old : Nat)
    (S : r.lookupLocal? "sponsor" = some (.word sponsor))
    (O : r.loadImmutableField c "openOracle" = .ok (.word oracle))
    (C : r.loadImmutableField c "collateralToken" = .ok (.word collateral))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (G : r.lookupLocal? "callbackGasLimit" = some (.word gas))
    (E : r.lookupLocal? "escrow" = some (.word old))
    (trace : Interaction.Transcript)
    (run : ExecutesOK (Stmt.eval (n+1) t c r (.assign (.var "escrow") creationExpr))
      trace (.normal final)) :
    ∃ (created : Runtime) (bytes : List Byte) (response : CreateResponse),
      trace = [⟨.external (snapshotWorld c r.state)
        (.create (buildCreateRequest c "SharedPoolReportEscrow" bytes 0 none)), response⟩] ∧
      (decodeCreateResponse response "SharedPoolReportEscrow" bytes 0 none).success = true ∧
      created.locals = r.locals ∧
      created.assignLocal? "escrow" (.word (u256ToWord response.address)) = some final := by
  have notMem : (LValue.var "escrow").wantsMemoryRefRhs r = false := by
    simp [LValue.wantsMemoryRefRhs,Runtime.lookupMemoryRef?,E]
  rw [Stmt.eval] at run
  dsimp only at run
  rw [notMem] at run
  simp only [Bool.false_eq_true,if_false] at run
  obtain ⟨out,before,after,joined,expr,rest⟩ := bindSuccessful _ _ _ _ run
  cases out with
  | error err => have h := pureResult _ _ _ rest; cases h.2
  | ok pair =>
    obtain ⟨value,created⟩ := pair
    have exprOK := caughtSuccessful _ _ _ expr
    change ExecutesOK (Expr.evalFuel (6+9) c r creationExpr) before (value,created) at exprOK
    obtain ⟨bytes,response,creation,success,val,locals⟩ :=
      creationFromOriginalLocals 6 c r created sponsor oracle collateral rep gas value S O C R G before exprOK
    have oldCreated : created.lookupLocal? "escrow" = some (.word old) := by
      simpa only [Runtime.lookupLocal?,locals] using E
    change ExecutesOK (do
      match ← ((LValue.var "escrow").resolveWithRuntime c created).caught with
      | .ok (target,next) => match target.write c next value with
        | .ok updated => pure (Result.normal updated)
        | .error err => pure (Result.reverted r err)
      | .error err => pure (Result.reverted r err)) after (.normal final) at rest
    rw [Inv32Writes.resolve c created "escrow" old oldCreated] at rest
    change ExecutesOK
      (match (ResolvedLValue.local "escrow").write c created value with
       | .ok updated => (pure (Result.normal updated) : SolI Result)
       | .error err => pure (Result.reverted r err)) after (.normal final) at rest
    cases stored : created.assignLocal? "escrow" value with
    | none => simp only [ResolvedLValue.write,stored] at rest; have h := pureResult _ _ _ rest; cases h.2
    | some updated =>
      simp only [ResolvedLValue.write,stored] at rest
      have h := pureResult _ _ _ rest
      cases h.2
      refine ⟨created,bytes,response,?_,success,locals,?_⟩
      · simpa only [h.1,List.append_nil,creation] using joined
      · simpa only [val] using stored

#print axioms creationAssignment
end Inv48.EscrowJoin
