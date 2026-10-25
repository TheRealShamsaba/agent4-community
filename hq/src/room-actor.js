/* Who is making a change. The room writes attribution onto every object and
   stroke, and the value has to be readable from plain helpers that are not
   inside a React tree — so it is a module singleton that App keeps current. */

export const LOCAL_ACTOR = { id: "local-owner", name: "You" };

export const AGENT4_ACTOR = { id: "agent4", name: "Agent4" };

let activeActor = LOCAL_ACTOR;

/* App calls this once per render with whoever is signed in, so the helpers
   above attribute to the real person rather than to the local placeholder. */
export function setActiveActor(actor) {
  activeActor = actor || LOCAL_ACTOR;
}

export function getActiveActor() { return activeActor; }
