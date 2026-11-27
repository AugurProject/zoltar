import Inv48ObservedMinimumHeapFrame
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.ObservedMinimumHeap
open Inv48.WholeQuote Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
/-- The actual prologue allocation, shared with QuoteEntryTail. -/
theorem initialQuoteCell (physical : Runtime) (p a bounty : Nat) :
    (Inv48.QuoteEntryTail.start physical p a bounty).lookupLocal? "quote" =
      some (.memoryRef physical.nextMemory) ∧
    (Inv48.QuoteEntryTail.start physical p a bounty).loadMemory? physical.nextMemory =
      some (tuple 0 0 0 0 0) ∧
    physical.nextMemory < (Inv48.QuoteEntryTail.start physical p a bounty).nextMemory := by
  exact ⟨by rfl,allocated_memory physical p a bounty,Nat.lt_succ_self _⟩

theorem quoteCell (physical : Runtime) (p a bounty : Nat)
    (s : Body n c {Inv48.QuoteMinimumJoin.callSite
      (Inv48.WholeQuote.prepared physical p a bounty).pushScope p with locals := []} p trace out) (hp : p<Inv32Division.R)
    (dC : Inv48.CollateralCloneStage.Deployment s.observed.collateral.joined.context s.observed.collateral.joined.caller)
    (b : Inv48.CollateralReturnedMinimum.BaseDeployment s.observed.collateral.joined)
    (envC : Inv48.MinimumSuccessWords.CanonicalOracle s.observed.collateral.joined.context s.observed.collateral.joined.start dC.root
      (Inv48.CollateralCloneStage.bytes dC) s.observed.collateral.joined.during)
    (dR : Inv48.RepReturnedMinimum.Deployment s.observed.rep.joined.context s.observed.rep.joined.caller)
    (envR : Inv48.MinimumSuccessWords.CanonicalOracle s.observed.rep.joined.context s.observed.rep.joined.start dR.root
      (Inv48.RepReturnedMinimum.bytes dR) s.observed.rep.joined.during)
    (getter : Runtime) (words : List Value) (returned : out = .returned getter words) :
    let actual := Inv48.ObservedMinimumGuard.afterBase (prepared physical p a bounty) getter
    actual.lookupLocal? "quote" = some (.memoryRef physical.nextMemory) ∧
    actual.loadMemory? physical.nextMemory = some (tuple 0 0 0 0 0) ∧
    actual.nextMemory = physical.nextMemory+3 := by
  obtain ⟨final,values,value,h⟩ := bodyHeap s hp dC b envC dR envR
  have same : final = getter := (Result.returned.inj (value.symm.trans returned)).1
  rw [same] at h
  let input := {Inv48.QuoteMinimumJoin.callSite (prepared physical p a bounty).pushScope p with locals := []}
  let codeC := Inv48.CloneRead.runtimeCode dC.implementation dC.universeBytes dC.token
  let codeR := Inv48.CloneRead.runtimeCode dR.implementation dR.universeBytes dR.token
  have mem : getter.memory = (cache (cache input codeC) codeR).memory := congrArg Prod.fst h
  have next : getter.nextMemory = physical.nextMemory+3 := by
    have bound := congrArg Prod.snd h
    exact bound
  refine ⟨?_,?_,next⟩
  · rfl
  · change getter.loadMemory? physical.nextMemory = _
    change MemoryMap.lookup? getter.memory physical.nextMemory = _
    rw [mem]
    change (cache (cache input codeC) codeR).loadMemory? physical.nextMemory = _
    dsimp only [cache]
    rw [Inv48.ExposureHeap.allocation_before _ _ _ (by
      change physical.nextMemory < physical.nextMemory+1+1; omega)]
    rw [Inv48.ExposureHeap.allocation_before _ _ _ (by
      change physical.nextMemory < physical.nextMemory+1; omega)]
    exact (initialQuoteCell physical p a bounty).2.1

end Inv48.ObservedMinimumHeap
