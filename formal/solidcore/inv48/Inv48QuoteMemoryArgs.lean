import Inv48QuoteMemoryCeil
open SolidCore.Solidity.Source Inv32Division Inv32FloorHoist Inv32FloorStart Inv32CeilFlags
namespace Inv48.QuoteMemory
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

def collateralArg : Expr := .castOp .uintCleanup 256 (.index (.var "quote") (.word 0))
def priceArg : Expr := .castOp .uintCleanup 256 (.var "proposedRepPerEthPrice")
def precisionArg : Expr := .ternary (.word 1) (.word (10^18)) (.word (10^18))

/-- Argument preparation for the actual rounded call, derived from the current
memory tuple and price local, including the literal precision ternary. -/
theorem ceilInputs (c : Context) (r : Runtime) (id a b h e s price : Nat)
    (ref : r.lookupLocal? "quote" = some (.memoryRef id))
    (mem : r.loadMemory? id = some (tuple a b h e s))
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word price))
    (ha : a<R) (hp : price<R) :
    Inputs c r h0 collateralArg priceArg precisionArg a price (10^18) := by
  have ref' : (Inv32FloorHoist.start r h0 0).lookupLocal? "quote" = some (.memoryRef id) := by
    cases H : r.locals <;> simp_all [Inv32FloorHoist.start,Inv32OneArg.store,h0,Runtime.pushScope,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  have P' : (st1 r h0 0 a).lookupLocal? "proposedRepPerEthPrice" = some (.word price) := by
    cases H : r.locals <;> simp_all [st1,Inv32FloorHoist.start,Inv32OneArg.store,h0,a0,Runtime.pushScope,Runtime.declareLocal,
      LocalEnv.declare,Runtime.lookupLocal?,LocalEnv.lookup?,Frame.lookup?]
  refine ⟨?_,?_,?_⟩
  · have read := Inv08.MemoryMember.clean
      (Inv08.MemoryMember.fromMemory c (Inv32FloorHoist.start r h0 0) "quote" id 0 a
        [.word a,.word b,.word h,.word e,.word s] ref' mem (by decide) rfl) ha
    exact read _ (by decide)
  · exact readClean c (st1 r h0 0 a) _ price hp P'
  · change Expr.evalFuel 5 c (st2 r h0 0 a price) precisionArg = _
    rw [precisionArg,Expr.evalFuel]
    rfl

#print axioms ceilInputs
end Inv48.QuoteMemory
