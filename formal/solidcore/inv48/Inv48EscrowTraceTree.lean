import Inv48EscrowTraceCall
open SolidCore.Solidity.Source
namespace Inv48.EscrowTrace
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def transferReply (fuel : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (response : LowLevelCallResult × State) : SolI Result :=
  let rr := ({r with state := response.2}).recordExternalInteraction (.lowLevelCall response.1)
  if response.1.success then
    match abiDecodeValuesExcept? [.bool] (response.1.output.map normByte) with
    | .ok decoded =>
      if AbiCleanups.acceptOrUnspecified [.none] decoded then
        match BindingDecl.bindArgs? [⟨"__ext0",.bool,false⟩] decoded with
        | some frame => do
          let result ← Stmt.eval fuel t c (rr.withFrame frame)
            (.assign (.var "_sol_hoist_0") (.var "__ext0"))
          pure (result.mapRuntime Runtime.popScope)
        | none => pure (.reverted rr RevertData.typeMismatch)
      else pure (.reverted rr RevertData.empty)
    | .error err => pure (.reverted rr err)
  else pure (.reverted rr (.fromRawBytes (response.1.output.map normByte)))

 theorem transferTree (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (rep payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (hp : payer < 2^160) (he : escrow < 2^160) (ha : amount < 2^256)
    (hr : rep < 2^256) (notConstruction : c.construction = false) :
    Stmt.eval (n+2) t c r transferStmt =
      (selfDispatchCall c r.state .call rep (calldata payer escrow amount) 0 none >>=
        transferReply (n+1) t c r) := by
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
  have zeroNorm : SolidCore.Solidity.Shared.norm 0 = 0 := by decide
  rw [zeroNorm]
  apply congrArg (fun k => selfDispatchCall c r.state .call rep (calldata payer escrow amount) 0 none >>= k)
  funext response
  have noCatch (raw : List Byte) : TryCatchClause.findMatch? raw [] = none := by
    unfold TryCatchClause.findMatch?
    cases revertClassify raw <;> rfl
  simp only [noCatch,List.map_cons,List.map_nil]
  rfl

theorem replySuccessful (fuel : Nat) (t : FunctionTable) (c : Context) (r final : Runtime)
    (response : LowLevelCallResult × State)
    (normal : transferReply fuel t c r response = pure (.normal final)) : response.1.success = true := by
  by_cases h : response.1.success = true
  · exact h
  · simp only [transferReply,h] at normal
    cases normal

theorem decodedCallPayload (response : EvmCompiler.Simulation.CallResponse)
    (rep payer escrow amount : Nat) :
    (decodeCallResponse response .call rep (calldata payer escrow amount) 0 none).calldata =
      calldata payer escrow amount := rfl

theorem decodedCallSuccess (response : EvmCompiler.Simulation.CallResponse)
    (rep payer escrow amount : Nat) :
    (decodeCallResponse response .call rep (calldata payer escrow amount) 0 none).success =
      response.success := rfl

theorem adoptionPreservesTrace (world : SolidCore.Solidity.Shared.OpenWorld) (c : Context) (s : State) :
    (adoptWorld world c s).externalInteractions = s.externalInteractions := rfl

#print axioms decodedCallPayload
#print axioms decodedCallSuccess
#print axioms adoptionPreservesTrace
#print axioms replySuccessful
#print axioms transferTree
end Inv48.EscrowTrace
