import Inv48GuardArgsFrameReadOnly
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Shapes
namespace Inv48.GuardArgsFrame
open Inv48.RequestPrologue Inv48.EscrowJoin Inv48.EscrowPrefix
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000

def neP : Pattern BinaryOp where
  value := .ne
  test | .ne => true | _ => false
  sound v h := by cases v <;> simp_all

def geP : Pattern BinaryOp where
  value := .ge
  test | .ge => true | _ => false
  sound v h := by cases v <;> simp_all

def sponsorP := Stmt_requireStmt
  (Expr_binary neP (Expr_var (lit "sponsor")) (Expr_word (lit 0)))
  (Option_some (lit "Report sponsor zero"))
def priceP := Stmt_requireStmt
  (Expr_binary BinaryOp_gt
    (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "proposedRepPerEthPrice")))
    (Expr_word (lit 0))) (Option_some (lit "Initial oracle price zero"))
def callValueP : Pattern Expr where
  value := .callValue
  test | .callValue => true | _ => false
  sound v h := by cases v <;> simp_all

def valueP := Stmt_requireStmt
  (Expr_binary geP
    (Expr_castOp CastKind_uintCleanup (lit 256) callValueP)
    (Expr_castOp CastKind_uintCleanup (lit 256) (Expr_var (lit "bountyAttoEth"))))
  (Option_some (lit "Not enough ETH for oracle bounty"))

def guard (i : Nat) := Inv48.RequestQuote.actual[i]?.getD .skip
def guards : List Stmt := [guard 0,guard 1,guard 2,guard 3,guard 4]

def guardsCheck :=
  (Inv48.RequestQuote.actual[1]?).map sponsorP.test == some true &&
  (Inv48.RequestQuote.actual[2]?).map priceP.test == some true &&
  (Inv48.RequestQuote.actual[4]?).map valueP.test == some true &&
  (Inv48.RequestQuote.actual.take 5).length == 5

theorem checkedGuards : guardsCheck = true := by native_decide

theorem guardShapes : guard 1 = sponsorP.value ∧ guard 2 = priceP.value ∧ guard 4 = valueP.value := by
  have h := checkedGuards
  simp only [guardsCheck,Bool.and_eq_true,beq_iff_eq] at h
  have atSome (i : Nat) (p : Pattern Stmt)
      (test : (Inv48.RequestQuote.actual[i]?).map p.test = some true) : guard i = p.value := by
    cases eq : Inv48.RequestQuote.actual[i]? with
    | none => simp [eq] at test
    | some stmt =>
      simp only [eq,Option.map_some,Option.some.injEq] at test
      simpa only [guard,eq,Option.getD_some] using p.sound stmt test
  exact ⟨atSome 1 sponsorP h.1.1.1,atSome 2 priceP h.1.1.2,atSome 4 valueP h.1.2⟩

theorem plainFrames (n : Nat) (t : FunctionTable) (c : Context) :
    StatementFrame (n+1) t c (guard 1) ∧ StatementFrame (n+1) t c (guard 2) ∧
    StatementFrame (n+1) t c (guard 4) := by
  rw [guardShapes.1,guardShapes.2.1,guardShapes.2.2]
  refine ⟨requireFrame n t c _ _ ?_,requireFrame n t c _ _ ?_,requireFrame n t c _ _ ?_⟩
  · exact .binary .ne (by intro h; cases h) (by intro h; cases h) (.var _) (.word _)
  · exact .binary .gt (by intro h; cases h) (by intro h; cases h) (.cleanup 256 (.var _)) (.word _)
  · exact .binary .ge (by intro h; cases h) (by intro h; cases h) (.cleanup 256 .value) (.cleanup 256 (.var _))

/-- Conditional assembly. The two nested-call frames remain explicit proof
obligations; the three plain guards and the shared-call bindings are derived.
This is NOT a completed arbitrary-prefix bridge. -/
theorem localPrefix (n : Nat) (c : Context) (raw initialRuntime savedRuntime final : Runtime)
    (fn : InternalFunction) (saved : LocalEnv) (s p a b g : Nat)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (callEntry : internalCallEnter? fn (args s p a b g) raw = some (initialRuntime,saved))
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (oracleFrame : StatementFrame (n+1) Inv48.Source.model.core.table c (guard 0))
    (helperFrame : StatementFrame (n+1) Inv48.Source.model.core.table c (guard 3))
    (cleanupTrace guardTrace : Interaction.Transcript)
    (cleanupRun : ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      initialRuntime.pushScope cleanup) cleanupTrace (.normal savedRuntime))
    (guardRun : ExecutesOK (Stmt.evalList (n+1) Inv48.Source.model.core.table c
      savedRuntime.pushScope guards) guardTrace (.normal final)) :
    saved = raw.locals ∧ final.locals = []::[]::requestFrame s p a b g::[] ∧
      Lookups final p a b := by
  rw [entered fn registered raw s p a b g] at callEntry
  obtain ⟨rfl,rfl⟩ := Prod.mk.inj (Option.some.inj callEntry)
  rw [cleanupExecution n _ c raw s p a b g hp ha hb hg] at cleanupRun
  have cleaned := pureResult _ _ _ cleanupRun
  cases cleaned.2
  have plain := plainFrames n Inv48.Source.model.core.table c
  have frames : ∀ st ∈ guards, StatementFrame (n+1) Inv48.Source.model.core.table c st := by
    intro st mem
    simp only [guards,List.mem_cons,List.mem_singleton,List.not_mem_nil,or_false] at mem
    rcases mem with eq | eq | eq | eq | eq <;> subst st
    · exact oracleFrame
    · exact plain.1
    · exact plain.2.1
    · exact helperFrame
    · exact plain.2.2
  have eq := sequenceFrame (n+1) _ c guards frames _ final guardTrace guardRun
  refine ⟨rfl,eq,?_⟩
  simpa [Lookups,Runtime.lookupLocal?,eq,Runtime.pushScope,entry,requestFrame,
    LocalEnv.lookup?,Frame.lookup?]

end Inv48.GuardArgsFrame

namespace Inv48.GuardArgsFrame
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv48.RequestPrologue
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000

/-- Once the surviving request frame is known from execution, the real memory
hoist reaches the beginning of the quote block and preserves all three words.
This lemma has no quote-site lookup premises. -/
theorem hoistToQuoteBlock (n : Nat) (c : Context) (r final : Runtime)
    (s p a b g : Nat) (frame : r.locals = []::[]::requestFrame s p a b g::[])
    (trace : Interaction.Transcript)
    (run : Inv48.EscrowPrefix.ExecutesOK
      (Stmt.eval (n+1) Inv48.Source.model.core.table c r
        (guard 5)) trace (.normal final)) : Lookups final p a b := by
  have source : guard 5 = (memoryDeclP Inv48.QuoteTransport.hoist).value := by
    simp only [guard,actualHoist,Option.getD_some]
  have same : ({r with locals := []::[]::requestFrame s p a b g::[]} : Runtime) = r := by
    rw [← frame]
  have tree := hoistDefault n Inv48.Source.model.core.table c r [] s p a b g
  rw [same] at tree
  rw [source] at run
  change Inv48.EscrowPrefix.ExecutesOK
    (Stmt.eval (n+1) Inv48.Source.model.core.table c r
      (.memoryVarDecl Inv48.WholeQuote.quoteTy Inv48.QuoteTransport.hoist none))
    trace (.normal final) at run
  rw [tree] at run
  have h := Inv48.EscrowPrefix.pureResult _ _ _ run
  cases h.2
  simp [Lookups,Inv48.RequestPrologue.source,Runtime.lookupLocal?,LocalEnv.lookup?,
    Frame.lookup?,requestFrame,Inv48.QuoteTransport.hoist]

end Inv48.GuardArgsFrame
