import Inv48OperationsWrapperArgsGas
open SolidCore.Solidity.Source EvmCompiler.Simulation
namespace Inv48.OperationsWrapperArgs
set_option maxRecDepth 65536
set_option maxHeartbeats 12000000
private theorem pb {α β : Type} (v : α) (k : α → SolI β) : pure v >>= k = k v := rfl

def gasArg : Expr := .castOp .uintCast 32
  (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "callbackGas")))
def requestPrefix : List Stmt := [
  .varDecl .address "_ic_arg_0" (some .caller),
  .varDecl .uint256 "_ic_arg_1" (some (.castOp .uintCleanup 256 (.var "proposedRepPerEthPrice"))),
  .varDecl .uint256 "_ic_arg_2" (some (.castOp .uintCleanup 256 (.var "requestedInitialAttoWeth"))),
  .varDecl .uint256 "_ic_arg_3" (some (.castOp .uintCleanup 256 (.var "bountyAttoEth"))),
  .varDecl .uint256 "_ic_arg_4" (some gasArg),
  .varDecl .uint256 "_ret__requestPrice_0" none]

theorem actualRequestPrefix : requestP.value = .block (requestPrefix ++
    [.captureReturn ["_ret__requestPrice_0"] Inv48.SimpleWrapperArgs.call,
     .assign (.var "_sol_hoist_0") (.var "_ret__requestPrice_0")]) := by rfl

theorem gasArgRead (c : Context) (r : Runtime) (g : Nat)
    (hg : g < 2^32) (look : r.lookupLocal? "callbackGas" = some (.word g)) :
    Expr.eval c r gasArg = pure (.word g,r) := by
  have wide : g < 2^256 := hg.trans_le (by decide)
  have cast256 : uintCast? 256 (.word g) = .ok (.word g) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
      SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,Bind.bind,Except.bind,
      ]
    simpa using wide
  have cast32 : uintCast? 32 (.word g) = .ok (.word g) := by
    simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
      SolidCore.Solidity.Shared.wordModulus,EvmYul.UInt256.size,Bind.bind,Except.bind,
      ]
    simpa using hg
  have clean := Inv48.EscrowEntry.cleanWidth c.checked 256 g (by decide) (by decide) wide wide
  let f := Inv32Scalar.cast .uint 32
    (Inv32Scalar.cast .cleanup 256 (Inv32Scalar.cast .uint 256 (Inv32Scalar.localWord "callbackGas")))
  change Expr.eval c r f.core = _
  apply Inv32Actions.evalFormula f c r g
  · decide
  · simp [f,Inv32Scalar.cast,Inv32Scalar.localWord,Inv32Actions.locals,look,
      cast256,cast32,clean,Inv32Scalar.projectWord]

def temps (c : Context) (r : Runtime) (p a b g : Nat) : Runtime :=
  ((((((r.declareLocal "_ic_arg_0" (.word c.sender)).declareLocal
    "_ic_arg_1" (.word p)).declareLocal "_ic_arg_2" (.word a)).declareLocal
    "_ic_arg_3" (.word b)).declareLocal "_ic_arg_4" (.word g)).declareLocal
    "_ret__requestPrice_0" (.word 0))

theorem tempsValues (c : Context) (r : Runtime) (p a b g : Nat) :
    Inv48.WrapperArgs.TempValues (temps c r p a b g) c.sender p a b g := by
  simp [Inv48.WrapperArgs.TempValues,temps]

theorem requestPrefixExecution (n : Nat) (c : Context) (r : Runtime) (p a b g : Nat)
    (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word b))
    (G : r.lookupLocal? "callbackGas" = some (.word g)) :
    Stmt.evalList (n+1) Inv48.Source.model.core.table c r requestPrefix =
      pure (.normal (temps c r p a b g)) := by
  let r1 := r.declareLocal "_ic_arg_0" (.word c.sender)
  let r2 := r1.declareLocal "_ic_arg_1" (.word p)
  let r3 := r2.declareLocal "_ic_arg_2" (.word a)
  let r4 := r3.declareLocal "_ic_arg_3" (.word b)
  let r5 := r4.declareLocal "_ic_arg_4" (.word g)
  have s := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r
    "_ic_arg_0" .address .caller c.sender (by rfl) (by rfl)
  have ps := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r1
    "_ic_arg_1" .uint256 _ p
    (Inv48.SimpleWrapperArgs.cleanRead c r1 256 p "proposedRepPerEthPrice" (by decide) (by decide) hp hp
      (by simpa [r1] using P)) (by rfl)
  have ast := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r2
    "_ic_arg_2" .uint256 _ a
    (Inv48.SimpleWrapperArgs.cleanRead c r2 256 a "requestedInitialAttoWeth" (by decide) (by decide) ha ha
      (by simpa [r2,r1] using A)) (by rfl)
  have bs := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r3
    "_ic_arg_3" .uint256 _ b
    (Inv48.SimpleWrapperArgs.cleanRead c r3 256 b "bountyAttoEth" (by decide) (by decide) hb hb
      (by simpa [r3,r2,r1] using B)) (by rfl)
  have gs := Inv48.PositiveHoist.declEval n Inv48.Source.model.core.table c r4
    "_ic_arg_4" .uint256 _ g
    (gasArgRead c r4 g hg (by simpa [r4,r3,r2,r1] using G)) (by rfl)
  have last := Inv48.CloneGetters.decl_none n Inv48.Source.model.core.table c r5
    .uint256 "_ret__requestPrice_0"
  simp only [Ty.defaultValue] at last
  unfold requestPrefix
  rw [Inv32FloorStart.seqStep _ _ _ _ _ _ _ s,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ ps,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ ast,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ bs,
    Inv32FloorStart.seqStep _ _ _ _ _ _ _ gs,
    Inv48.WholeQuote.singleList,last]
  rfl

/-- This local suffix theorem derives all argument temporaries. Its remaining
premises are original-source lookups, not preassembled shared arguments. It
is not a raw-ABI theorem: prefix reachability and loop preservation remain. -/
theorem prefixToActualEntry (n : Nat) (c : Context) (r final : Runtime)
    (p a b g : Nat) (hp : p < 2^256) (ha : a < 2^256) (hb : b < 2^256) (hg : g < 2^32)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (A : r.lookupLocal? "requestedInitialAttoWeth" = some (.word a))
    (B : r.lookupLocal? "bountyAttoEth" = some (.word b))
    (G : r.lookupLocal? "callbackGas" = some (.word g))
    (fn : InternalFunction)
    (registered : Inv48.Source.model.core.table.lookup? Inv48.RequestQuote.requestKey = some fn)
    (trace : Interaction.Transcript)
    (run : Interaction.Executes
      (Stmt.evalList (n+1) Inv48.Source.model.core.table c r requestPrefix >>= fun out =>
        match out with
        | .normal mid => Stmt.eval (n+1) Inv48.Source.model.core.table c mid Inv48.SimpleWrapperArgs.call
        | other => pure other) trace (.ok (.normal final))) :
    ∃ result bt ft,
      trace = bt ++ ft ∧
      Interaction.Executes (Stmt.eval n Inv48.Source.model.core.table {c with checked := true}
        (Inv48.GuardArgsFrame.entry (temps c r p a b g) c.sender p a b g) fn.body) bt (.ok result) ∧
      Interaction.Executes (internalCallFinish fn ["_ret__requestPrice_0"]
        (temps c r p a b g).locals result) ft (.ok (.normal final)) ∧
      Inv48.GuardArgsFrame.Lookups
        (Inv48.GuardArgsFrame.entry (temps c r p a b g) c.sender p a b g) p a b := by
  rw [requestPrefixExecution n c r p a b g hp ha hb hg P A B G,pb] at run
  exact Inv48.WrapperArgs.actualEntry n c (temps c r p a b g) final ["_ret__requestPrice_0"]
    fn registered c.sender p a b g (tempsValues c r p a b g) trace run
end Inv48.OperationsWrapperArgs
