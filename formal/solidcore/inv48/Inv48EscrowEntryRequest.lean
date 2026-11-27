import Inv48EscrowEntryJoin
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.EscrowEntry
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem openDispatchRequest {α : Type} (c : Context) (state : State)
    (rep : Nat) (data : List Byte) (k : LowLevelCallResult × State → SolI α)
    (openWorld : c.selfDispatch? = none) :
    (selfDispatchCall c state .call rep data 0 none >>= k) =
      Interaction.request (.external (snapshotWorld c state)
        (.call (buildCallRequest c .call rep data 0 none)))
        (fun answer => k (decodeCallResponse answer .call rep data 0 none,
          adoptWorld answer.postWorld c state)) := by
  simp only [selfDispatchCall,openWorld,ite_self]
  rw [emitLowLevelCall]
  simp only [Bind.bind,Interaction.bind]

/-- The real open CALL request, including its world snapshot and response
adoption, with no successful REP reply or decoded Boolean assumed. -/
theorem openTransferRequest (n : Nat) (t : FunctionTable) (c : Context) (r : Runtime)
    (rep payer escrow amount : Nat)
    (P : r.lookupLocal? "payer" = some (.word payer))
    (E : r.lookupLocal? "escrow" = some (.word escrow))
    (A : r.lookupLocal? "repAmount" = some (.word amount))
    (R : r.lookupLocal? "rep" = some (.word rep))
    (hp : payer < 2^160) (he : escrow < 2^160) (ha : amount < 2^256)
    (hr : rep < 2^256) (notConstruction : c.construction = false)
    (openWorld : c.selfDispatch? = none) :
    Stmt.eval (n+2) t c r EscrowTrace.transferStmt =
      Interaction.request (.external (snapshotWorld c r.state)
        (.call (buildCallRequest c .call rep (EscrowTrace.calldata payer escrow amount) 0 none)))
        (fun answer => EscrowTrace.transferReply (n+1) t c r
          (decodeCallResponse answer .call rep (EscrowTrace.calldata payer escrow amount) 0 none,
            adoptWorld answer.postWorld c r.state)) := by
  rw [EscrowTrace.transferTree n t c r rep payer escrow amount P E A R hp he ha hr notConstruction]
  simp only [selfDispatchCall,openWorld,ite_self]
  rw [emitLowLevelCall]
  simp only [Bind.bind,Interaction.bind]

#print axioms openDispatchRequest
#print axioms openTransferRequest
end Inv48.EscrowEntry
