import Inv48EscrowJoinCore
open SolidCore.Solidity.Source
namespace Inv48.EscrowJoin
set_option maxRecDepth 65536
set_option maxHeartbeats 2000000

theorem frameAssigned (frame next : Frame) (dst query : String) (value : Value)
    (assigned : frame.assign? dst value = some next) :
    next.lookup? query = if dst = query then some value else frame.lookup? query := by
  induction frame generalizing next with
  | nil => simp [Frame.assign?] at assigned
  | cons entry rest ih =>
    obtain ⟨name,old⟩ := entry
    simp only [Frame.assign?] at assigned
    split at assigned
    next equal =>
      cases assigned
      subst name
      simp only [Frame.lookup?]
      split <;> rfl
    next different =>
      cases tail : Frame.assign? rest dst value with
      | none => simp [tail] at assigned
      | some updated =>
        simp only [tail] at assigned
        cases assigned
        have h := ih updated tail
        simp only [Frame.lookup?]
        by_cases nq : name = query
        · subst query
          simp only [if_pos rfl]
          simp only [if_neg (Ne.symm different),if_true]
        · simp only [nq,if_false,h]

theorem localsAssigned (locals next : LocalEnv) (dst query : String) (value : Value)
    (assigned : locals.assign? dst value = some next) :
    next.lookup? query = if dst = query then some value else locals.lookup? query := by
  induction locals generalizing next with
  | nil => simp [LocalEnv.assign?] at assigned
  | cons frame rest ih =>
    simp only [LocalEnv.assign?] at assigned
    cases head : frame.assign? dst value with
    | some updated =>
      simp only [head] at assigned
      cases assigned
      rw [LocalEnv.lookup?,frameAssigned frame updated dst query value head]
      by_cases dq : dst = query
      · simp only [dq,if_true]
      · simp only [dq,if_false,LocalEnv.lookup?]
    | none =>
      simp only [head] at assigned
      cases tail : LocalEnv.assign? rest dst value with
      | none => simp [tail] at assigned
      | some updated =>
        simp only [tail] at assigned
        cases assigned
        have h := ih updated tail
        simp only [LocalEnv.lookup?,h]
        by_cases dq : dst = query
        · subst query
          have absent : frame.lookup? dst = none := by
            clear h tail
            induction frame with
            | nil => rfl
            | cons entry rest ih =>
              obtain ⟨name,old⟩ := entry
              simp only [Frame.assign?] at head
              split at head
              next equal => contradiction
              next different =>
                cases a : Frame.assign? rest dst value <;> simp_all [Frame.lookup?]
          simp only [absent,if_pos rfl]
        · simp only [dq,if_false]

theorem runtimeAssignedWord (r next : Runtime) (dst query : String) (old value : Nat)
    (bound : r.lookupLocal? dst = some (.word old))
    (assigned : r.assignLocal? dst (.word value) = some next) :
    next.lookupLocal? query = if dst = query then some (.word value) else r.lookupLocal? query := by
  simp only [Runtime.assignLocal?,bound,Value.coerceLike?] at assigned
  cases stored : LocalEnv.assign? r.locals dst (.word value) with
  | none => simp [stored] at assigned
  | some locals =>
    simp only [stored] at assigned
    cases assigned
    exact localsAssigned r.locals locals dst query (.word value) stored

theorem declaredOther (r : Runtime) (name query : String) (value : Value)
    (different : name ≠ query) :
    (r.declareLocal name value).lookupLocal? query = r.lookupLocal? query := by
  cases h : r.locals <;>
    simp [Runtime.declareLocal,Runtime.lookupLocal?,LocalEnv.declare,LocalEnv.lookup?,Frame.lookup?,h,different]

#print axioms declaredOther
#print axioms frameAssigned
#print axioms localsAssigned
#print axioms runtimeAssignedWord
end Inv48.EscrowJoin
