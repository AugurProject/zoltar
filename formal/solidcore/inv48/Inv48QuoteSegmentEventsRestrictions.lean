import Inv48QuoteSegmentEventsAggregate
open SolidCore.Solidity SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.QuoteSegmentEvents
open Inv48.CollateralMinimum

/-- Only the two allowed semantic query constructors; worlds are unrestricted. -/
inductive ResourceOrStatic : Query → Prop where
  | resource (q) : ResourceOrStatic (.resource q)
  | staticcall (world request) (kind : request.kind = .staticcall) :
      ResourceOrStatic (.external world (.call request))

theorem excludes (c : Context) (state : State) (data : List Source.Byte) (q : Query)
    (allowed : ResourceOrStatic q) :
    q ≠ Inv48.ObservedEscrowResponder.query c state data := by
  cases allowed with
  | resource => intro eq; cases eq
  | staticcall world request kind =>
    apply Inv48.QuoteQueryClass.different c state data
    apply Inv48.QuoteQueryClass.Class.kind
    simp [buildCallRequest,lowLevelKindToCallKind,kind]

theorem aggregateCallRestricted (escrowContext : Context) (escrowState : State) (escrowData : List Source.Byte)
    (n : Nat) (c : Context) (r inner : Runtime) (saved : LocalEnv) (targets : List String) (final : Runtime)
    (entry : internalCallEnter? aggregateFn [] r = some (inner,saved))
    (implementation universeBytes token : List Nat)
    (hi : implementation.length=20) (hu : universeBytes.length=31) (ht : token.length=20)
    (cu : ∀ b ∈ universeBytes, b<256) (ct : ∀ b ∈ token, b<256)
    (selfWord : c.self<Inv32Division.R)
    (boundary : inner.pushScope.pushScope.pushScope.state.envAccountCode c c.self=Inv48.CloneRead.runtimeCode implementation universeBytes token)
    (d : Inv48.CollateralReadDecoded.Deployment {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)))
    (tr : Interaction.Transcript)
    (env : Inv48.MinimumSuccessWords.CanonicalOracle {c with checked := true}
      (oracleStage inner.pushScope.pushScope.pushScope (Inv48.CloneRead.runtimeCode implementation universeBytes token)
        (Inv48.CloneRead.decode universeBytes)) d.root (Inv48.CollateralReadDecoded.bytes d) tr)
    (run : Interaction.Executes (Stmt.eval (n+50) table c r (.internalCall targets aggregateKey [])) tr (.ok (.normal final))) :
    ∀ event ∈ tr, ResourceOrStatic event.query ∧
      event.query ≠ Inv48.ObservedEscrowResponder.query escrowContext escrowState escrowData := by
  obtain ⟨response,eq⟩ := aggregateCallEvents n c r inner saved targets final entry
    implementation universeBytes token hi hu ht cu ct selfWord boundary d tr env run
  intro event member
  rw [eq] at member
  have same := List.mem_singleton.mp member
  subst event
  have allowed : ResourceOrStatic (.external
      (snapshotWorld {c with checked := true}
        (oracleStage inner.pushScope.pushScope.pushScope
          (Inv48.CloneRead.runtimeCode implementation universeBytes token)
          (Inv48.CloneRead.decode universeBytes)).state)
      (.call (buildCallRequest {c with checked := true} .staticcall d.root
        (Inv48.CollateralReadDecoded.bytes d) 0 none))) :=
    .staticcall _ _ rfl
  exact ⟨allowed,excludes escrowContext escrowState escrowData _ allowed⟩
end Inv48.QuoteSegmentEvents
