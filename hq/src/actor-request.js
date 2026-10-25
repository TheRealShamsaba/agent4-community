import { getActiveActor } from './room-actor.js';

// Async workflows can outlive sign-out. Never continue them using the next
// account's cookie, or consume a response after their originating actor left.
export function requestForActor(actorId, request) {
  return async (...args) => {
    const assertActor = () => {
      if (!actorId || getActiveActor().id !== actorId) throw new Error('Your account changed. Reopen this screen to continue.');
    };
    assertActor();
    const result = await request(...args);
    assertActor();
    return result;
  };
}
