import Inv48RoundedMinimumReturnPublic
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.RawPriceMonotone
open Inv48.MinimumSuccessWords
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

/-- Exactly one retained public execution, with its own dependent helper cuts. -/
structure Run where
  n : Nat
  context : Context
  state : State
  price : Nat
  trace : Interaction.Transcript
  out : ABI.AbiCallResult
  observation : Inv48.MinimumRepOperand.Observation n context state price trace out
  collateral : Inv48.CollateralCloneStage.Deployment observation.source.collateral.joined.context observation.source.collateral.joined.caller
  base : Inv48.CollateralReturnedMinimum.BaseDeployment observation.source.collateral.joined
  rep : Inv48.RepReturnedMinimum.Deployment observation.rep.joined.context observation.rep.joined.caller
  collateralOracle : CanonicalOracle observation.source.collateral.joined.context observation.source.collateral.joined.start collateral.root
    (Inv48.CollateralCloneStage.bytes collateral) observation.source.collateral.joined.during
  repOracle : CanonicalOracle observation.rep.joined.context observation.rep.joined.start rep.root
    (Inv48.RepReturnedMinimum.bytes rep) observation.rep.joined.during

def collateralEvent (r : Run) (response : CallResponse) := OracleEvent
  r.observation.source.collateral.joined.context r.observation.source.collateral.joined.start
  r.collateral.root (Inv48.CollateralCloneStage.bytes r.collateral) r.observation.source.collateral.joined.during response
def repEvent (r : Run) (response : CallResponse) := OracleEvent
  r.observation.rep.joined.context r.observation.rep.joined.start
  r.rep.root (Inv48.RepReturnedMinimum.bytes r.rep) r.observation.rep.joined.during response

def collateralWorld (r : Run) := snapshotWorld r.observation.source.collateral.joined.context r.observation.source.collateral.joined.start.state
def repWorld (r : Run) := snapshotWorld r.observation.rep.joined.context r.observation.rep.joined.start.state

/-- Valuations use the real query world, feed, security pool and universe. -/
structure StableExposure (low high : Run) where
  collateralAt : SolidCore.Solidity.Shared.OpenWorld → Nat → Nat → Nat → Nat
  repAt : SolidCore.Solidity.Shared.OpenWorld → Nat → Nat → Nat → Nat
  collateralFidelity : ∀ r ∈ [low, high], ∀ response, collateralEvent r response →
    Inv48.ExposureComparison.decoded response (collateralAt (collateralWorld r)
      r.observation.source.collateral.joined.context.self r.collateral.root (Inv48.CloneRead.decode r.collateral.universeBytes))
  repFidelity : ∀ r ∈ [low, high], ∀ response, repEvent r response →
    Inv48.ExposureComparison.decoded response (repAt (repWorld r)
      r.observation.rep.joined.context.self r.rep.root (Inv48.CloneRead.decode r.rep.universeBytes))
  collateralFrozen : collateralAt (collateralWorld low) low.observation.source.collateral.joined.context.self low.collateral.root (Inv48.CloneRead.decode low.collateral.universeBytes) =
    collateralAt (collateralWorld high) high.observation.source.collateral.joined.context.self high.collateral.root (Inv48.CloneRead.decode high.collateral.universeBytes)
  repFrozen : repAt (repWorld low) low.observation.rep.joined.context.self low.rep.root (Inv48.CloneRead.decode low.rep.universeBytes) =
    repAt (repWorld high) high.observation.rep.joined.context.self high.rep.root (Inv48.CloneRead.decode high.rep.universeBytes)

structure Certificate (r : Run) where
  collateralResponse : CallResponse
  repResponse : CallResponse
  x : Nat
  y : Nat
  C : Nat
  R : Nat
  collateralRead : collateralEvent r collateralResponse
  collateralSuccess : collateralResponse.success = true
  collateralFit : x < Inv32Division.R
  collateralDecoded : Inv48.ExposureComparison.decoded collateralResponse x
  collateralFormula : C = r.base.base + Inv03.ceilQuot x 100
  Cfit : C < Inv32Division.R
  repRead : repEvent r repResponse
  repSuccess : repResponse.success = true
  repFit : y < Inv32Division.R
  repDecoded : Inv48.ExposureComparison.decoded repResponse y
  repFormula : R = Inv03.ceilQuot y 100
  Rfit : R < Inv32Division.R
  quotientFit : Inv03.ceilQuot (R*10^18) r.price < Inv32Division.R
  bytes : r.out.output = ABI.encodeWord (max C (Inv03.ceilQuot (R*10^18) r.price))
  least : ∀ amount, max C (Inv03.ceilQuot (R*10^18) r.price) ≤ amount ↔ C ≤ amount ∧ R*10^18 ≤ amount*r.price

def value (s : Certificate r) := max s.C (Inv03.ceilQuot (s.R*10^18) r.price)

theorem recover (r : Run) : Nonempty (Certificate r) := by
  obtain ⟨cr,x,C,rr,y,R,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,qf,bytes,least⟩ :=
    Inv48.RoundedMinimumReturn.transport r.observation r.collateral r.base r.collateralOracle r.rep r.repOracle
  exact ⟨⟨cr,rr,x,y,C,R,ce,cs,xf,xd,cf,Cf,re,rs,yf,yd,rf,Rf,qf,bytes,least⟩⟩

/-- No equality of C/R or comparison of results is supplied. -/
theorem comparison (low high : Run) (sameBase : low.base.base = high.base.base)
    (stable : StableExposure low high) (rise : low.price ≤ high.price) :
    ∃ l : Certificate low, ∃ h : Certificate high, value h ≤ value l := by
  obtain ⟨l⟩ := recover low
  obtain ⟨h⟩ := recover high
  have lx := Inv48.ExposureComparison.decoded_unique l.collateralDecoded
    (stable.collateralFidelity low (by simp) _ l.collateralRead)
  have hx := Inv48.ExposureComparison.decoded_unique h.collateralDecoded
    (stable.collateralFidelity high (by simp) _ h.collateralRead)
  have ly := Inv48.ExposureComparison.decoded_unique l.repDecoded
    (stable.repFidelity low (by simp) _ l.repRead)
  have hy := Inv48.ExposureComparison.decoded_unique h.repDecoded
    (stable.repFidelity high (by simp) _ h.repRead)
  have ex : l.x = h.x := lx.trans (stable.collateralFrozen.trans hx.symm)
  have ey : l.y = h.y := ly.trans (stable.repFrozen.trans hy.symm)
  refine ⟨l,h,?_⟩
  unfold value
  rw [h.collateralFormula,h.repFormula,l.collateralFormula,l.repFormula,← sameBase,← ex,← ey]
  exact Inv48.monotonePrice _ _ _ _ low.observation.source.suffix.original.positive rise
end Inv48.RawPriceMonotone
