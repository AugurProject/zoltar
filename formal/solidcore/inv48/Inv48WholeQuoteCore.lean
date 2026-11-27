import Inv48QuoteFieldsBound
import Inv48QuoteMemoryShape
import Inv48QuoteMemoryExposure
import Inv48QuoteMemoryFloor
import Inv48QuoteMemoryHalt
open SolidCore.Solidity.Source Inv32Division
namespace Inv48.WholeQuote
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000
open QuoteMemory

def quoteTy : Ty := .tuple [.uint256,.uint256,.uint256,.uint256,.uint256]
def entry (r : Runtime) (price collateral bounty : Nat) := r.withFrame
  [("proposedRepPerEthPrice",.word price),("requestedInitialAttoWeth",.word collateral),
   ("bountyAttoEth",.word bounty),("quote",tuple 0 0 0 0 0)]
def allocated (r : Runtime) (price collateral bounty : Nat) : Runtime :=
  {entry r price collateral bounty with
    locals := [[("proposedRepPerEthPrice",.word price),
      ("requestedInitialAttoWeth",.word collateral),("bountyAttoEth",.word bounty),
      ("quote",.memoryRef r.nextMemory)]] ++ r.locals
    memory := MemoryMap.insertLoop r.memory r.nextMemory (tuple 0 0 0 0 0)
    nextMemory := r.nextMemory+1
    nextMemoryByte := r.nextMemoryByte+(tuple 0 0 0 0 0).memoryAllocationBytes}

theorem localization (r : Runtime) (p a b : Nat) :
    (entry r p a b).pushScope.localizeMemoryLocal quoteTy "quote" =
      some (allocated r p a b).pushScope := by
  simp [entry,allocated,quoteTy,Runtime.localizeMemoryLocal,Runtime.lookupLocal?,
    Runtime.pushScope,Runtime.withFrame,LocalEnv.lookup?,Frame.lookup?,Ty.coerceValue?,
    Ty.coerceTupleValues?,Runtime.memoryStoredValue,Runtime.memoryStoredValues,
    Value.isMemoryObject,Runtime.allocMemory,Runtime.assignLocalRaw?,
    LocalEnv.assign?,Frame.assign?,tuple]

theorem allocated_ref (r : Runtime) (p a b : Nat) :
    (allocated r p a b).pushScope.pushScope.lookupLocal? "quote" =
      some (.memoryRef r.nextMemory) := rfl

theorem allocated_memory (r : Runtime) (p a b : Nat) :
    (allocated r p a b).pushScope.pushScope.loadMemory? r.nextMemory =
      some (tuple 0 0 0 0 0) := by
  simp [allocated,Runtime.pushScope,Runtime.loadMemory?,MemoryMap.lookup?,MemoryMap.insertLoop]

/-- Only the two funding fields are observed; the remaining fields may change. -/
def HasFunding (r : Runtime) (id collateral price : Nat) : Prop :=
  r.lookupLocal? "quote" = some (.memoryRef id) ∧
  ∃ halt exposure settlement,
    r.loadMemory? id = some (tuple collateral (QuoteExec.repAmount collateral price)
      halt exposure settlement)

/-- A three-field write frame never needs the old halt/exposure/settlement values. -/
theorem funding_frame (r : Runtime) (id a p h e s : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id)) :
    HasFunding (put r id a (QuoteExec.repAmount a p) h e s) id a p :=
  ⟨ref,h,e,s,put_load _ _ _ _ _ _ _⟩

#print axioms localization
#print axioms allocated_memory
#print axioms funding_frame
end Inv48.WholeQuote
