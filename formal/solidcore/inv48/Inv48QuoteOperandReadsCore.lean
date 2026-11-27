import Inv48FundingMathTailScopes
import Inv48QuoteEntryTailCore
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32CeilFlags
namespace Inv48.QuoteOperandReads
open Inv48.QuoteMemory Inv48.FundingMathTail Inv48.QuoteEntryTail
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

structure PhysicalWord (c : Context) (physical : Runtime) (name : String) (v : Nat) where
  field : ImmutableField
  found : c.immutableField? name = some field
  type : field.ty = .uint256
  stored : physical.state.immutable? name = some (.word v)
  fits : v<R

theorem physicalRead {c : Context} {physical r : Runtime} {name : String} {v : Nat} (h : PhysicalWord c physical name v)
    (same : r.state.immutable? name = physical.state.immutable? name) :
    r.loadImmutableField c name = .ok (.word v) := by
  rw [Runtime.loadImmutableField,h.found,same,h.stored]
  simp [h.type,Ty.coerceValue?]

theorem immutableReads (read : r.loadImmutableField c name = .ok (.word v)) :
    Reads c r (.immutable name) v := by
  intro fuel enough
  change 2≤fuel at enough
  cases fuel with
  | zero => omega
  | succ n => rw [Expr.evalFuel,read]; rfl

theorem denominator (c : Context) (r : Runtime) :
    Expr.eval c r denom = pure (.word 10000,r) := by
  change Expr.evalFuel 5 c r (.ternary (.word 1) (.word 10000) (.word 10000)) = _
  rw [Expr.evalFuel]
  rfl

theorem haltInputs (c : Context) (r : Runtime) (id a b h e s multiplier : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s)) (ha : a<R)
    (mulRead : r.loadImmutableField c "escalationHaltMultiplierBps" = .ok (.word multiplier))
    (hm : multiplier<R) : Inputs c r h0 haltX haltY denom a multiplier 10000 := by
  have ref' : (Inv32FloorHoist.start r h0 0).lookupLocal? "quote" = some (.memoryRef id) := by
    cases H : r.locals <;> simp_all [Inv32FloorHoist.start,Inv32OneArg.store,h0,Runtime.pushScope,
      Runtime.declareLocal,LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  refine ⟨?_,?_,denominator c _⟩
  · change Expr.evalFuel _ c _ haltX = _
    exact (Inv08.MemoryMember.clean (Inv08.MemoryMember.fromMemory c
      (Inv32FloorHoist.start r h0 0) "quote" id 0 a
      [.word a,.word b,.word h,.word e,.word s] ref' mem (by decide) rfl) ha) _ (by decide)
  · change Expr.evalFuel _ c _ haltY = _
    exact (Inv08.MemoryMember.clean (immutableReads (r := st1 r h0 0 a) mulRead) hm) _ (by decide)

end Inv48.QuoteOperandReads
