import Inv48LiquidationVerifiedAdapterBody
import Inv48LiquidationSourceLinkedGetter
import Inv48LiquidationGuardRead
open SolidCore.Solidity.Source EvmCompiler.Simulation Inv32Division
namespace GuardRecovery
set_option maxRecDepth 65536
set_option maxHeartbeats 20000000
private theorem pb {α β : Type} (a : α) (k : α → SolI β) : pure a >>= k = k a := rfl
private theorem pureResult {α : Type} (a b : α) (tr : Interaction.Transcript)
    (run : Interaction.Executes (pure a : SolI α) tr (.ok b)) : tr=[] ∧ b=a := by
  cases run
  exact ⟨rfl,rfl⟩

/-- The physical immutable read and price belong to this observed guard's
caller. All scopes and the actual library return assignment are discharged. -/
theorem observed (g : GuardPassage n c r final tr)
    (h : HoistPath n c r.pushScope g.computed g.prefixTrace)
    (p u : Nat) (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (value : Value)
    (U : r.loadImmutableField c "targetPriceErrorForDispute" = .ok value)
    (cleanup : uintCleanup? c.checked 256 value = .ok (.word u)) :
    u<10000000 ∧ 0<LiquidationLibrary.quotient p u ∧
    10000000+u ≤ p*10000000 ∧ tr=[] ∧ final=r := by
  have decl := Inv32FloorStart.zero (n+1) LiquidationLibrary.table c r.pushScope "_sol_hoist_0"
  have run := h.declareRun
  rw [decl] at run
  obtain ⟨dt,de⟩ := pureResult _ _ _ run
  have de := Result.normal.inj de
  have price : h.declared.pushScope.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
    rw [de]
    simpa [Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,
      LocalEnv.lookup?,Frame.lookup?] using P
  have uncertainty : h.declared.pushScope.loadImmutableField c "targetPriceErrorForDispute" = .ok value := by
    rw [de]
    exact U
  have args := LiquidationLibrary.normalizedArgumentEvaluation n c h.declared.pushScope p u hp hu price value uncertainty cleanup
  have ar := h.argsRun
  rw [args] at ar
  obtain ⟨at_,caller⟩ := pureResult _ _ _ ar
  have caller := Result.normal.inj caller
  have cp : h.caller.lookupLocal? "_ic_arg_0" = some (.word p) := by
    rw [caller]
    cases H : h.declared.locals <;>
      simp [LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
        Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,
        LocalEnv.lookup?,Frame.lookup?,H,libraryRet]
  have cu : h.caller.lookupLocal? "_ic_arg_1" = some (.word u) := by
    rw [caller]
    cases H : h.declared.locals <;>
      simp [LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
        Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,
        LocalEnv.lookup?,Frame.lookup?,H,libraryRet]
  obtain ⟨good,ct,assigned,frame⟩ := LiquidationBody.callObserved n c h.caller h.callFinal p u hp hu cp cu h.callTrace h.callRun
  let q := LiquidationLibrary.quotient p u
  have qfit : q<R := LiquidationLibrary.quotientFits p u hp
  let called := h.caller.assignLocal? libraryRet (.word q)
  have assignedExact : h.callFinal =
      ((LiquidationLibrary.argsReady h.declared.pushScope p u).assignLocal? libraryRet (.word q)).getD h.caller := by
    rw [← caller,assigned]
    rfl
  have ret : h.callFinal.lookupLocal? libraryRet = some (.word q) := by
    rw [assignedExact]
    simp [LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
      libraryRet,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]
  have old : h.callFinal.lookupLocal? "_sol_hoist_0" = some (.word 0) := by
    rw [assignedExact,de]
    simp [LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
      libraryRet,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]
  let copied := (r.pushScope.declareLocal "_sol_hoist_0" (.word q)).pushScope
  have put : h.callFinal.assignLocal? "_sol_hoist_0" (.word q) =
      some (LiquidationLibrary.argsReady copied p u |>.assignLocal? libraryRet (.word q) |>.getD h.caller) := by
    rw [assignedExact,de]
    simp [copied,LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
      libraryRet,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare]
  have copy : Stmt.evalList (n+1) LiquidationLibrary.table c h.callFinal hoistCopy =
      pure (.normal _) :=
    (Inv32FloorStart.seqStep _ _ _ _ _ _ _ (Inv32Temps.copy n LiquidationLibrary.table c h.callFinal _
      "_sol_hoist_0" libraryRet 0 q old ret put)).trans (by rw [Stmt.evalList])
  have run := h.copyRun
  rw [copy] at run
  obtain ⟨xt,ce⟩ := pureResult _ _ _ run
  have ce := Result.normal.inj ce
  have computed : g.computed = r.pushScope.declareLocal "_sol_hoist_0" (.word q) := by
    rw [h.frame,ce]
    simp [copied,LiquidationLibrary.argsReady,LiquidationLibrary.arg1,LiquidationLibrary.arg0,
      libraryRet,Runtime.assignLocal?,Runtime.lookupLocal?,Runtime.assignLocalRaw?,
      LocalEnv.assign?,LocalEnv.lookup?,Frame.lookup?,Frame.assign?,Value.coerceLike?,
      Runtime.declareLocal,Runtime.pushScope,Runtime.popScope,LocalEnv.declare]
  have read : g.computed.lookupLocal? "_sol_hoist_0" = some (.word q) := by
    rw [computed]
    simp [Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have view : Expr.eval c g.computed (.castOp .uintCleanup 256 (.var "_sol_hoist_0")) = pure (.word q,g.computed) :=
    Inv32Guards.clean _ _ _ _ _ qfit (Inv32Guards.readWord _ _ _ _ _ read)
  have cast : Expr.eval c g.computed (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0"))) = pure (.word q,g.computed) := by
    have value : uintCast? 256 (.word q) = .ok (.word q) := by
      simp [uintCast?,Value.forceAbiLazy,Value.asStorageWord?,SolidCore.Solidity.Shared.norm,
        Nat.mod_eq_of_lt qfit,Bind.bind,Except.bind,Inv32Division.R]
      change q % R % R = q
      simp [Nat.mod_eq_of_lt qfit]
    change Expr.evalFuel 4 c g.computed _ = _
    rw [Expr.evalFuel]
    have inner : Expr.evalFuel 3 c g.computed (.castOp .uintCast 256 (.var "_sol_hoist_0")) = pure (.word q,g.computed) := by
      rw [Expr.evalFuel,Inv32Guards.readWord _ _ _ _ _ read]
      rw [pb]
      try dsimp only
      rw [value]
      rfl
    rw [inner]
    rw [pb]
    try dsimp only
    rw [Inv32Guards.cleanupWord c.checked q qfit]
    rfl
  have vd := Inv32Hoist.declEval (n+1) LiquidationLibrary.table c g.computed "#view47500" .uint256 _ q cast rfl
  have run := g.declarationRun
  change Interaction.Executes (Stmt.eval (n+2) _ c g.computed
    (.varDecl .uint256 "#view47500" (some (.castOp .uintCleanup 256 (.castOp .uintCast 256 (.var "_sol_hoist_0")))))) _ _ at run
  rw [vd] at run
  obtain ⟨vt,ve⟩ := pureResult _ _ _ run
  have ve := Result.normal.inj ve
  have vread : g.declared.lookupLocal? "#view47500" = some (.word q) := by
    rw [ve]
    cases H : g.computed.locals <;> simp [H,Runtime.lookupLocal?,Runtime.declareLocal,Runtime.pushScope,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?]
  have cond : Expr.eval c g.declared guardCondition =
      pure (.word (if q=0 then 0 else 1),g.declared) := by
    have read : Expr.eval c g.declared (.castOp .uintCleanup 256 (.var "#view47500")) = pure (.word q,g.declared) :=
      Inv32Guards.clean _ _ _ _ _ qfit (Inv32Guards.readWord _ _ _ _ _ vread)
    change Expr.evalFuel 5 c g.declared _ = _
    simp only [guardCondition,Expr.evalFuel]
    change (pure (Value.word 0,g.declared) >>= _) = _
    rw [pb]
    change (Expr.eval c g.declared (.castOp .uintCleanup 256 (.var "#view47500")) >>= _) = _
    rw [read,pb,pb]
    dsimp only
    simp [BinaryOp.apply,Value.forceAbiLazy,BinaryOp.preservesFixedBytesWidth,
      Bind.bind,Except.bind,wordEq,boolWord,SolidCore.Solidity.Shared.norm,
      Nat.mod_eq_of_lt qfit,Inv32Division.R]
    have norm : q % SolidCore.Solidity.Shared.wordModulus = q := Nat.mod_eq_of_lt qfit
    rw [norm]
    rfl
  have nz : 0<q := by
    obtain ⟨v,w,ev,word,truth⟩ := g.accepted
    rw [cond] at ev
    have eq : v = .word (if q=0 then 0 else 1) := by
      exact (Prod.mk.inj (Except.ok.inj (Interaction.done.inj ev))).1.symm
    by_contra zero
    have qzero : q=0 := by omega
    simp [eq,qzero,Value.expectWord] at word
    subst w
    contradiction
  refine ⟨good,nz,(liquidationPositiveIff p u).mp nz,?_,?_⟩
  · rw [g.split,h.split,dt,at_,ct,xt,vt]
    rfl
  · rw [g.frame,ve,computed]
    rfl

/-- Recover the physical config read from this guard's successful argument
execution, then derive the guard's arithmetic and complete caller restoration. -/
theorem observedSuccess (g : GuardPassage n c r final tr) (p : Nat) (hp : p<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p)) :
    ∃ value u, r.loadImmutableField c "targetPriceErrorForDispute" = .ok value ∧
      uintCleanup? c.checked 256 value = .ok (.word u) ∧ u<10000000 ∧
      0<LiquidationLibrary.quotient p u ∧ 10000000+u ≤ p*10000000 ∧ tr=[] ∧ final=r := by
  obtain ⟨h⟩ := hoistPath g
  have decl := Inv32FloorStart.zero (n+1) LiquidationLibrary.table c r.pushScope "_sol_hoist_0"
  have run := h.declareRun
  rw [decl] at run
  have de := Result.normal.inj (pureResult _ _ _ run).2
  have price : h.declared.pushScope.lookupLocal? "proposedRepPerEthPrice" = some (.word p) := by
    rw [de]
    simpa [Runtime.pushScope,Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,
      LocalEnv.lookup?,Frame.lookup?] using P
  obtain ⟨value,u,loaded,cleanup,fit⟩ := hoistRead h p hp price
  have loaded : r.loadImmutableField c "targetPriceErrorForDispute" = .ok value := by
    rw [de] at loaded
    exact loaded
  exact ⟨value,u,loaded,cleanup,observed g h p u hp fit P value loaded cleanup⟩
/-- Public getter recovery retains one execution and exposes the complete
physical-read, nonzero, arithmetic, transcript and post-pop runtime certificate. -/
theorem successfulGetterObserved (fn : FunctionDef)
    (found : Inv48.Source.model.core.findFunctionByName? "minimumToken1ReportAttoEthForPrice" = some fn)
    (n : Nat) (c : Context) (r : Runtime) (tr : Interaction.Transcript) (out : Result)
    (ordinary : ¬ Escapes out)
    (run : Interaction.Executes (Stmt.eval (n+5) Inv48.Source.model.core.table c r fn.body) tr (.ok out)) :
    ∃ path : GetterPath n c r tr out, ∀ p, p<R →
      path.positive.lookupLocal? "proposedRepPerEthPrice" = some (.word p) →
      ∃ value u, path.positive.loadImmutableField c "targetPriceErrorForDispute" = .ok value ∧
        uintCleanup? c.checked 256 value = .ok (.word u) ∧ u<10000000 ∧
        0<LiquidationLibrary.quotient p u ∧ 10000000+u ≤ p*10000000 ∧
        path.guardTrace=[] ∧ path.guarded=path.positive := by
  obtain ⟨path,g,h,entered,body,ordinary,frame⟩ := successfulGetter fn found n c r tr out ordinary run
  exact ⟨path,fun p hp P => observedSuccess g p hp P⟩

/-- A physically stored clean uint256 is the exact uncertainty in the same
observed guard, rather than an independently supplied helper result. -/
theorem physicalObserved (g : GuardPassage n c r final tr)
    (h : HoistPath n c r.pushScope g.computed g.prefixTrace)
    (p u : Nat) (hp : p<R) (hu : u<R)
    (P : r.lookupLocal? "proposedRepPerEthPrice" = some (.word p))
    (field : ImmutableField)
    (found : c.immutableField? "targetPriceErrorForDispute" = some field)
    (ty : field.ty = .uint256)
    (stored : r.state.immutable? "targetPriceErrorForDispute" = some (.word u)) :
    u<10000000 ∧ 0<LiquidationLibrary.quotient p u ∧
      10000000+u ≤ p*10000000 ∧ tr=[] ∧ final=r :=
  observed g h p u hp hu P (.word u)
    (LiquidationLibrary.physicalUncertainty c r field u found ty stored)
    (Inv32Guards.cleanupWord c.checked u hu)
#print axioms successfulGetterObserved
#print axioms physicalObserved
#print axioms observed
#print axioms observedSuccess
end GuardRecovery
