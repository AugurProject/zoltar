import Inv08InitializePublic
import Inv08FundingDomain
import Inv08PublicSubdivision
open SolidCore.Solidity SolidCore.Solidity.Source Inv32Division
namespace Inv08.FundingHistory

/-- Accounting at the last processed time, with exactly one record per distinct funding second. -/
structure Funded (s : State) (d : Nat) (fs : List Funding) : Prop where
  accounts : Accounts s d fs (vested d (stored s .through) fs)
  count : CountBound fs

theorem emptyFunded (s : State) (d : Nat) (A : Accounts s d [] (fun _ => 0)) : Funded s d [] := by
  have V : vested d (stored s .through) [] = fun _ => 0 := by
    funext eth; simp [vested,streams,integral,baseline]
  refine ⟨?_,Nat.le_refl 0⟩
  rw [V]; exact A

theorem initializedFunded (s out : State) (tm d : Nat) (tf : tm<Packed.B) (df : d<Packed.B) (pos : 0<d)
    (zero : ∀ i,s.loadSlot i=0) (sep : Separated 0) (same : out.storage=(initializeStorage s tm d).storage) :
    Funded out d [] :=
  emptyFunded out d (transport _ out same (genesis s tm d zero sep tf df pos).1)

theorem fundedGenesis (c : Context) (tm d : Nat) (tf : tm<Packed.B) (df : d<Packed.B) (pos : 0<d) (sep : Separated 0) :
    Funded (Initialize.output c (Initialize.fresh c.sender) tm d) d [] :=
  initializedFunded (Release.entryState c (Initialize.fresh c.sender)) _ tm d tf df pos (Initialize.freshSlot c) sep rfl

theorem fundedRelease (F : Funded s d fs) (c : Context) (tm : Nat) (tf : tm<Packed.B) (fwd : stored s .through≤tm)
    (sep : Separated fs.length) : Funded (Release.outputState c s tm) d fs := by
  let out := Release.outputState c s tm
  let paid := vested d (stored s .through) fs
  have A := transport _ out (Release.outputStorage c s tm) (afterRelease F.accounts tm tf fwd sep)
  have clock := (Release.clock s tm tf (ready F.accounts tm tf fwd).toReady.qFit).1
  have time : stored out .through=tm := (scalarCongr out (Release.post s tm) .through (by
    simp [State.loadSlot,out,Release.outputStorage])).trans clock
  have total : (fun eth => paid eth + Preview.payout s tm eth) = vested d (stored out .through) fs := by
    rw [time]; exact funext (lifetimeAfter F.accounts tm fwd)
  exact ⟨total ▸ A,F.count⟩

end Inv08.FundingHistory
