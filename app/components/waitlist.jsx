import { Waitlist } from "@clerk/nextjs";

export default function WaitlistButton() {
  return (
    <>
      <div
        className="btn btn-secondary uppercase"
        onClick={() => document.getElementById("modal_waitlist").showModal()}
      >
        Waitlist
      </div>
      <dialog id="modal_waitlist" className="modal">
        <div className="modal-box">
          <h3 className="font-bold text-lg">Join The Watlist</h3>
          <Waitlist />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </>
  );
}
